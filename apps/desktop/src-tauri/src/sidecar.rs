use crate::error::CommandError;
use crate::secrets::CredentialManager;
use crate::types::WorkerStatus;
use base64::Engine as _;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
#[cfg(windows)]
use sysinfo::{Pid, ProcessesToUpdate, System};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const PROTOCOL_VERSION: u32 = 1;
const START_TIMEOUT: Duration = Duration::from_secs(12);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const FORCE_CLEANUP_TIMEOUT: Duration = Duration::from_millis(750);
const CREDENTIAL_BROKER_TIMEOUT: Duration = Duration::from_secs(15);
const CREDENTIAL_BROKER_POLL: Duration = Duration::from_millis(100);
const CREDENTIAL_BROKER_STOP_TIMEOUT: Duration = Duration::from_millis(250);
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

pub(crate) mod worker_method {
    pub const MUSIC_SEARCH: &str = "control.searchMusicCandidates";
    pub const MUSIC_ACCEPT: &str = "control.acceptMusicCandidate";
    pub const MUSIC_REJECT: &str = "control.rejectMusicCandidate";
    pub const PRESENTER_PREVIEW_START: &str = "control.previewPresenterAnimation";
    pub const PRESENTER_PREVIEW_ACCEPT: &str = "control.acceptPresenterAnimationPreview";
    pub const PRESENTER_PREVIEW_REJECT: &str = "control.rejectPresenterAnimationPreview";

    pub const NATIVE_MEDIA_REVIEW: [&str; 6] = [
        MUSIC_SEARCH,
        MUSIC_ACCEPT,
        MUSIC_REJECT,
        PRESENTER_PREVIEW_START,
        PRESENTER_PREVIEW_ACCEPT,
        PRESENTER_PREVIEW_REJECT,
    ];
}

#[derive(Debug, Clone)]
pub struct PortableRuntimeVerification {
    pub root: PathBuf,
    pub manifest_sha256: String,
}

pub trait WorkerTransport: Send + Sync {
    fn call(&self, method: &str, payload: Value) -> Result<Value, CommandError>;
}

#[derive(Debug, Clone)]
pub struct WorkerLaunchConfig {
    pub executable: PathBuf,
    pub working_directory: PathBuf,
    /// None is accepted only for the explicit debug worker override and unit
    /// fixtures. Installed runtime packs always provide a manifest hash.
    pub expected_sha256: Option<String>,
    pub environment: BTreeMap<OsString, OsString>,
    pub runtime_verification: Option<PortableRuntimeVerification>,
}

struct RunningWorker {
    child: Child,
    endpoint: SocketAddr,
    token: Zeroizing<String>,
    _credential_broker: Option<CredentialBroker>,
}

#[derive(Clone)]
struct WorkerConnection {
    endpoint: SocketAddr,
    token: Zeroizing<String>,
}

impl RunningWorker {
    fn connection(&self) -> WorkerConnection {
        WorkerConnection {
            endpoint: self.endpoint,
            token: Zeroizing::new(self.token.to_string()),
        }
    }
}

enum WorkerLifecycle {
    Unavailable(String),
    Stopped,
    Starting,
    Ready(RunningWorker),
    Degraded(String),
    Failed { reason: String, retryable: bool },
    Stopping,
}

pub struct WorkerSupervisor {
    executable: PathBuf,
    working_directory: PathBuf,
    expected_sha256: Option<String>,
    environment: BTreeMap<OsString, OsString>,
    runtime_verification: Option<PortableRuntimeVerification>,
    credentials: Option<Arc<CredentialManager>>,
    lifecycle: Mutex<WorkerLifecycle>,
    shutdown: Mutex<()>,
    closed: AtomicBool,
}

impl std::fmt::Debug for WorkerSupervisor {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorkerSupervisor")
            .field("executable", &self.executable)
            .field("working_directory", &self.working_directory)
            .field("hash_pinned", &self.expected_sha256.is_some())
            .field(
                "runtime_environment_keys",
                &self.environment.keys().collect::<Vec<_>>(),
            )
            .field("lifecycle", &self.status())
            .finish()
    }
}

impl WorkerSupervisor {
    pub fn new(executable: PathBuf, working_directory: PathBuf) -> Self {
        Self::from_launch_config(WorkerLaunchConfig {
            executable,
            working_directory,
            expected_sha256: None,
            environment: BTreeMap::new(),
            runtime_verification: None,
        })
    }

    pub fn from_launch_config(config: WorkerLaunchConfig) -> Self {
        let WorkerLaunchConfig {
            executable,
            working_directory,
            expected_sha256,
            environment,
            runtime_verification,
        } = config;
        let lifecycle = if executable.is_file() {
            WorkerLifecycle::Stopped
        } else {
            WorkerLifecycle::Unavailable(
                "The pipeline worker binary is not installed. Desktop editing remains available."
                    .into(),
            )
        };
        Self {
            executable,
            working_directory,
            expected_sha256,
            environment,
            runtime_verification,
            credentials: None,
            lifecycle: Mutex::new(lifecycle),
            shutdown: Mutex::new(()),
            closed: AtomicBool::new(false),
        }
    }

    pub fn with_credential_manager(mut self, credentials: Arc<CredentialManager>) -> Self {
        self.credentials = Some(credentials);
        self
    }

    pub fn status(&self) -> WorkerStatus {
        let mut lifecycle = self.lifecycle.lock();
        if let WorkerLifecycle::Ready(running) = &mut *lifecycle {
            match running.child.try_wait() {
                Ok(Some(_)) => {
                    *lifecycle = WorkerLifecycle::Failed {
                        reason: "The pipeline worker exited unexpectedly.".into(),
                        retryable: true,
                    };
                }
                Err(_) => {
                    *lifecycle = WorkerLifecycle::Degraded(
                        "The pipeline worker process could not be inspected.".into(),
                    );
                }
                Ok(None) => {}
            }
        }
        lifecycle.status()
    }

    pub fn start(&self) -> Result<WorkerStatus, CommandError> {
        {
            let mut lifecycle = self.lifecycle.lock();
            if self.closed.load(Ordering::Acquire) {
                return Err(CommandError::worker("The desktop is shutting down.", false));
            }
            match &*lifecycle {
                WorkerLifecycle::Unavailable(reason) => {
                    return Err(CommandError::worker(reason.clone(), true));
                }
                WorkerLifecycle::Ready(_) => return Ok(lifecycle.status()),
                WorkerLifecycle::Starting | WorkerLifecycle::Stopping => {
                    return Err(CommandError::worker(
                        "The pipeline worker is changing state. Try again shortly.",
                        true,
                    ));
                }
                WorkerLifecycle::Stopped
                | WorkerLifecycle::Degraded(_)
                | WorkerLifecycle::Failed { .. } => {}
            }
            *lifecycle = WorkerLifecycle::Starting;
        }

        // Runtime hashing may touch hundreds of immutable files. It runs
        // without holding the lifecycle lock so the UI can report `Starting`
        // and shutdown can cancel the launch before a child process exists.
        let verification = self
            .runtime_verification
            .as_ref()
            .map(|verification| {
                crate::runtime::verify_portable_debug_pack(
                    &verification.root,
                    &verification.manifest_sha256,
                )
            })
            .unwrap_or(Ok(()))
            .and_then(|_| {
                verify_worker_executable(&self.executable, self.expected_sha256.as_deref())
            });

        let mut lifecycle = self.lifecycle.lock();
        if self.closed.load(Ordering::Acquire) {
            return Err(CommandError::worker("The desktop is shutting down.", false));
        }
        if !matches!(*lifecycle, WorkerLifecycle::Starting) {
            return Ok(lifecycle.status());
        }
        let result = verification.and_then(|_| {
            spawn_worker(
                &self.executable,
                &self.working_directory,
                &self.environment,
                self.credentials.clone(),
            )
        });
        match result {
            Ok(running) => {
                *lifecycle = WorkerLifecycle::Ready(running);
                Ok(lifecycle.status())
            }
            Err(error) => {
                *lifecycle = WorkerLifecycle::Failed {
                    reason: error.message.clone(),
                    retryable: error.retryable,
                };
                Err(error)
            }
        }
    }

    pub fn restart(&self) -> Result<WorkerStatus, CommandError> {
        self.stop();
        self.start()
    }

    pub fn stop(&self) {
        // Serialize stop/restart teardown. A concurrent stop must not publish
        // Stopped while another caller still owns a live child process.
        let _shutdown = self.shutdown.lock();
        let previous = {
            let mut lifecycle = self.lifecycle.lock();
            std::mem::replace(&mut *lifecycle, WorkerLifecycle::Stopping)
        };
        match previous {
            WorkerLifecycle::Ready(mut running) => {
                stop_running_worker(&mut running);
                *self.lifecycle.lock() = WorkerLifecycle::Stopped;
            }
            WorkerLifecycle::Unavailable(reason) => {
                *self.lifecycle.lock() = WorkerLifecycle::Unavailable(reason);
            }
            _ => *self.lifecycle.lock() = WorkerLifecycle::Stopped,
        }
    }

    /// Permanently close this supervisor before desktop exit. Ordinary stop
    /// remains restartable, but late WebView polling must not revive a child
    /// after the application's final teardown has completed.
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.stop();
    }

    pub fn call(&self, method: &str, payload: Value) -> Result<Value, CommandError> {
        if !valid_method(method) {
            return Err(CommandError::invalid(
                "worker method",
                "is not allow-listed",
            ));
        }
        if !matches!(self.status(), WorkerStatus::Ready { .. }) {
            self.start()?;
        }
        let connection = {
            let lifecycle = self.lifecycle.lock();
            let WorkerLifecycle::Ready(running) = &*lifecycle else {
                return Err(CommandError::worker(
                    "The pipeline worker is not ready.",
                    true,
                ));
            };
            running.connection()
        };
        call_connection(&connection, method, payload)
    }
}

impl WorkerTransport for WorkerSupervisor {
    fn call(&self, method: &str, payload: Value) -> Result<Value, CommandError> {
        WorkerSupervisor::call(self, method, payload)
    }
}

impl Drop for WorkerSupervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

impl WorkerLifecycle {
    fn status(&self) -> WorkerStatus {
        match self {
            Self::Unavailable(reason) => WorkerStatus::Unavailable {
                reason: reason.clone(),
            },
            Self::Stopped => WorkerStatus::Stopped,
            Self::Starting => WorkerStatus::Starting,
            Self::Ready(running) => WorkerStatus::Ready {
                pid: running.child.id(),
                endpoint: format!("http://{}", running.endpoint),
            },
            Self::Degraded(reason) => WorkerStatus::Degraded {
                reason: reason.clone(),
            },
            Self::Failed { reason, retryable } => WorkerStatus::Failed {
                reason: reason.clone(),
                retryable: *retryable,
            },
            Self::Stopping => WorkerStatus::Stopping,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadyMessage {
    #[serde(rename = "type")]
    kind: String,
    protocol_version: u32,
    endpoint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupMessage<'a> {
    protocol_version: u32,
    authentication_token: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential_broker: Option<CredentialBrokerStartup<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialBrokerStartup<'a> {
    endpoint: String,
    authentication_token: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcRequest<'a> {
    protocol_version: u32,
    id: Uuid,
    authentication_token: &'a str,
    method: &'a str,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcResponse {
    protocol_version: u32,
    id: Uuid,
    ok: bool,
    #[serde(default)]
    result: Value,
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct RpcError {
    code: String,
    message: String,
    #[serde(default)]
    retryable: bool,
}

struct CredentialBroker {
    endpoint: SocketAddr,
    token: Zeroizing<String>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for CredentialBroker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect_timeout(&self.endpoint, Duration::from_millis(100));
        if let Some(thread) = self.thread.take() {
            let deadline = Instant::now() + CREDENTIAL_BROKER_STOP_TIMEOUT;
            while !thread.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(5));
            }
            if thread.is_finished() {
                let _ = thread.join();
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CredentialLeaseRequest {
    protocol_version: u32,
    request_id: Uuid,
    authentication_token: String,
    nonce: String,
    provider_id: String,
    credential_ref: String,
}

impl Drop for CredentialLeaseRequest {
    fn drop(&mut self) {
        self.authentication_token.zeroize();
        self.nonce.zeroize();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialLeaseResponse<'a> {
    protocol_version: u32,
    request_id: Uuid,
    ok: bool,
    credential: Option<&'a str>,
    error: Option<&'a str>,
}

fn spawn_credential_broker(
    credentials: Arc<CredentialManager>,
) -> Result<CredentialBroker, CommandError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| {
        CommandError::worker("The keyring lease broker could not bind loopback.", true)
    })?;
    let endpoint = listener.local_addr().map_err(|_| {
        CommandError::worker("The keyring lease broker endpoint is unavailable.", true)
    })?;
    listener.set_nonblocking(true).map_err(|_| {
        CommandError::worker("The keyring lease broker could not be supervised.", true)
    })?;
    let mut token_bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut token_bytes);
    let token =
        Zeroizing::new(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token_bytes));
    token_bytes.fill(0);
    let thread_token = Zeroizing::new(token.to_string());
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread = std::thread::spawn(move || {
        let mut nonces = HashSet::new();
        while !thread_stop.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, peer)) => {
                    if thread_stop.load(Ordering::Acquire) {
                        break;
                    }
                    if peer.ip().is_loopback() {
                        handle_credential_lease(
                            stream,
                            &credentials,
                            &thread_token,
                            &thread_stop,
                            &mut nonces,
                        );
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });
    Ok(CredentialBroker {
        endpoint,
        token,
        stop,
        thread: Some(thread),
    })
}

fn handle_credential_lease(
    mut stream: TcpStream,
    credentials: &CredentialManager,
    authentication_token: &str,
    stop: &AtomicBool,
    nonces: &mut HashSet<String>,
) {
    // The supervising listener is nonblocking. Accepted sockets can inherit
    // that mode on Windows, which makes an immediate request read race the
    // client's first send and close the connection with WSAECONNABORTED.
    // Each short-lived lease connection must instead block within its bounded
    // read/write timeouts.
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_read_timeout(Some(CREDENTIAL_BROKER_POLL));
    let _ = stream.set_write_timeout(Some(CREDENTIAL_BROKER_TIMEOUT));
    let mut line = Zeroizing::new(String::new());
    // Read and write through the same Winsock handle. A cloned handle can be
    // dropped after the request read while the original writes the response;
    // on Windows that cross-handle lifetime can abort the peer with 10053.
    let deadline = Instant::now() + CREDENTIAL_BROKER_TIMEOUT;
    let mut reader = BufReader::new(&mut stream).take(16 * 1024 + 1);
    loop {
        if stop.load(Ordering::Acquire) || Instant::now() >= deadline {
            return;
        }
        match reader.read_line(&mut line) {
            Ok(_) if line.ends_with('\n') => break,
            Ok(0) => return,
            Ok(_) if line.len() > 16 * 1024 => return,
            Ok(_) => continue,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => return,
        }
    }
    if line.len() > 16 * 1024 {
        return;
    }
    let request: CredentialLeaseRequest = match serde_json::from_str(line.trim_end()) {
        Ok(value) => value,
        Err(_) => return,
    };
    let valid_nonce = request.nonce.len() >= 32
        && request.nonce.len() <= 256
        && request
            .nonce
            .chars()
            .all(|character| !character.is_control())
        && nonces.len() < 4096
        && nonces.insert(request.nonce.clone());
    if request.protocol_version != PROTOCOL_VERSION
        || !constant_time_equal(&request.authentication_token, authentication_token)
        || !valid_nonce
        || !request
            .credential_ref
            .starts_with(&format!("keyring://alystria/{}/", request.provider_id))
    {
        write_credential_response(
            &mut stream,
            CredentialLeaseResponse {
                protocol_version: PROTOCOL_VERSION,
                request_id: request.request_id,
                ok: false,
                credential: None,
                error: Some("Credential lease was not authorized"),
            },
        );
        return;
    }
    match credentials.lease_reference(&request.credential_ref) {
        Ok(secret) => write_credential_response(
            &mut stream,
            CredentialLeaseResponse {
                protocol_version: PROTOCOL_VERSION,
                request_id: request.request_id,
                ok: true,
                credential: Some(secret.as_str()),
                error: None,
            },
        ),
        Err(_) => write_credential_response(
            &mut stream,
            CredentialLeaseResponse {
                protocol_version: PROTOCOL_VERSION,
                request_id: request.request_id,
                ok: false,
                credential: None,
                error: Some("Approved credential is unavailable in the OS keyring"),
            },
        ),
    }
}

fn write_credential_response(stream: &mut TcpStream, response: CredentialLeaseResponse<'_>) {
    if let Ok(encoded) = serde_json::to_vec(&response).map(Zeroizing::new) {
        if stream
            .write_all(&encoded)
            .and_then(|_| stream.write_all(b"\n"))
            .and_then(|_| stream.flush())
            .is_ok()
        {
            let _ = stream.shutdown(Shutdown::Write);
        }
    }
}

fn constant_time_equal(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.as_bytes()
        .iter()
        .zip(right.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn spawn_worker(
    executable: &PathBuf,
    working_directory: &PathBuf,
    environment: &BTreeMap<OsString, OsString>,
    credentials: Option<Arc<CredentialManager>>,
) -> Result<RunningWorker, CommandError> {
    fs::create_dir_all(working_directory)
        .map_err(|_| CommandError::worker("Worker runtime directory is unavailable.", true))?;

    let mut token_bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut token_bytes);
    let token =
        Zeroizing::new(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token_bytes));
    token_bytes.fill(0);

    let credential_broker = credentials.map(spawn_credential_broker).transpose()?;

    let mut command = Command::new(executable);
    command
        .arg("--alystria-desktop-worker")
        .current_dir(working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("ALYSTRIA_WORKER_AUTH", "stdin")
        .env("ALYSTRIA_WORKER_PROTOCOL", PROTOCOL_VERSION.to_string());
    for (key, value) in environment {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .map_err(|_| CommandError::worker("The pipeline worker could not be started.", true))?;
    let mut stdin = child.stdin.take().ok_or_else(|| {
        CommandError::worker(
            "The pipeline worker did not expose its secure startup channel.",
            true,
        )
    })?;
    let startup = Zeroizing::new(
        serde_json::to_vec(&StartupMessage {
            protocol_version: PROTOCOL_VERSION,
            authentication_token: &token,
            credential_broker: credential_broker
                .as_ref()
                .map(|broker| CredentialBrokerStartup {
                    endpoint: broker.endpoint.to_string(),
                    authentication_token: &broker.token,
                }),
        })
        .map_err(|_| CommandError::worker("Worker startup message could not be encoded.", false))?,
    );
    if stdin.write_all(&startup).is_err() || stdin.write_all(b"\n").is_err() {
        let _ = child.kill();
        return Err(CommandError::worker(
            "Worker authentication handshake failed.",
            true,
        ));
    }
    drop(stdin);

    let stdout = child.stdout.take().ok_or_else(|| {
        CommandError::worker(
            "The pipeline worker did not expose its readiness channel.",
            true,
        )
    })?;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = sender.send(result);
    });

    let line = match receiver.recv_timeout(START_TIMEOUT) {
        Ok(Ok(line)) => line,
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CommandError::worker(
                "The pipeline worker did not become ready before the startup deadline.",
                true,
            ));
        }
    };
    let ready: ReadyMessage = serde_json::from_str(line.trim()).map_err(|_| {
        let _ = child.kill();
        CommandError::worker(
            "The pipeline worker returned an invalid readiness message.",
            false,
        )
    })?;
    if ready.kind != "ready" || ready.protocol_version != PROTOCOL_VERSION {
        let _ = child.kill();
        return Err(CommandError::worker(
            "The pipeline worker protocol is incompatible with this desktop build.",
            false,
        ));
    }
    let endpoint: SocketAddr = ready.endpoint.parse().map_err(|_| {
        let _ = child.kill();
        CommandError::worker(
            "The pipeline worker returned an invalid IPC endpoint.",
            false,
        )
    })?;
    if !is_loopback(endpoint.ip()) {
        let _ = child.kill();
        return Err(CommandError::worker(
            "The pipeline worker refused the required loopback-only IPC boundary.",
            false,
        ));
    }

    Ok(RunningWorker {
        child,
        endpoint,
        token,
        _credential_broker: credential_broker,
    })
}

fn verify_worker_executable(
    executable: &Path,
    expected_sha256: Option<&str>,
) -> Result<(), CommandError> {
    let Some(expected) = expected_sha256 else {
        return Ok(());
    };
    if expected.len() != 64
        || !expected
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
    {
        return Err(CommandError::worker(
            "The installed pipeline worker has an invalid manifest hash.",
            false,
        ));
    }
    let metadata = executable
        .symlink_metadata()
        .map_err(|_| CommandError::worker("The installed pipeline worker is unavailable.", true))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() == 0 {
        return Err(CommandError::worker(
            "The installed pipeline worker is not a safe regular file.",
            false,
        ));
    }
    let mut file = fs::File::open(executable).map_err(|_| {
        CommandError::worker(
            "The installed pipeline worker could not be inspected.",
            true,
        )
    })?;
    let mut digest = Sha256::new();
    // Worker launch can be initiated by a Tauri command on Windows' main GUI
    // thread. Keep this streaming buffer on the heap so integrity checking
    // cannot exhaust that thread's small native stack.
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| {
            CommandError::worker(
                "The installed pipeline worker could not be inspected.",
                true,
            )
        })?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    if format!("{:x}", digest.finalize()) != expected {
        return Err(CommandError::worker(
            "The installed pipeline worker failed SHA-256 verification.",
            false,
        ));
    }
    Ok(())
}

#[cfg(windows)]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ProcessSnapshot {
    pid: u32,
    parent_pid: Option<u32>,
    start_time: u64,
    executable: Option<PathBuf>,
    name: OsString,
}

#[cfg(windows)]
#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedProcessIdentity {
    process: ProcessSnapshot,
    depth: usize,
}

#[cfg(windows)]
fn system_process_snapshot() -> Vec<ProcessSnapshot> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system
        .processes()
        .iter()
        .map(|(pid, process)| ProcessSnapshot {
            pid: pid.as_u32(),
            parent_pid: process.parent().map(Pid::as_u32),
            start_time: process.start_time(),
            executable: process.exe().map(Path::to_path_buf),
            name: process.name().to_os_string(),
        })
        .collect()
}

#[cfg(windows)]
fn owned_processes_from_snapshot(
    processes: &[ProcessSnapshot],
    root_pid: u32,
) -> Vec<OwnedProcessIdentity> {
    if !processes.iter().any(|process| process.pid == root_pid) {
        return Vec::new();
    }
    owned_processes_from_seeds(processes, BTreeMap::from([(root_pid, 0_usize)]))
}

#[cfg(windows)]
fn owned_processes_from_seeds(
    processes: &[ProcessSnapshot],
    mut depths: BTreeMap<u32, usize>,
) -> Vec<OwnedProcessIdentity> {
    loop {
        let mut changed = false;
        for process in processes {
            if depths.contains_key(&process.pid) {
                continue;
            }
            let Some(parent_depth) = process
                .parent_pid
                .and_then(|parent_pid| depths.get(&parent_pid).copied())
            else {
                continue;
            };
            depths.insert(process.pid, parent_depth + 1);
            changed = true;
        }
        if !changed {
            break;
        }
    }
    let mut owned = processes
        .iter()
        .filter_map(|process| {
            depths
                .get(&process.pid)
                .copied()
                .map(|depth| OwnedProcessIdentity {
                    process: process.clone(),
                    depth,
                })
        })
        .collect::<Vec<_>>();
    owned.sort_by(|left, right| {
        right
            .depth
            .cmp(&left.depth)
            .then_with(|| right.process.pid.cmp(&left.process.pid))
    });
    owned
}

#[cfg(windows)]
fn snapshot_owned_process_tree(root_pid: u32) -> Vec<OwnedProcessIdentity> {
    owned_processes_from_snapshot(&system_process_snapshot(), root_pid)
}

#[cfg(windows)]
fn snapshot_descendants_of_owned_processes(
    owned: &[OwnedProcessIdentity],
) -> Vec<OwnedProcessIdentity> {
    let processes = system_process_snapshot();
    let seed_depths = owned
        .iter()
        .filter(|identity| {
            processes
                .iter()
                .any(|process| same_process_snapshot(process, &identity.process))
        })
        .map(|identity| (identity.process.pid, identity.depth))
        .collect();
    owned_processes_from_seeds(&processes, seed_depths)
}

#[cfg(windows)]
fn same_process_snapshot(current: &ProcessSnapshot, expected: &ProcessSnapshot) -> bool {
    current.pid == expected.pid
        && current.start_time == expected.start_time
        && current.executable == expected.executable
        && current.name == expected.name
}

#[cfg(windows)]
fn same_process(process: &sysinfo::Process, expected: &ProcessSnapshot) -> bool {
    process.start_time() == expected.start_time
        && process.exe().map(Path::to_path_buf) == expected.executable
        && process.name() == expected.name
}

#[cfg(windows)]
fn owned_processes_are_gone(owned: &[OwnedProcessIdentity]) -> bool {
    let pids = owned
        .iter()
        .map(|identity| Pid::from_u32(identity.process.pid))
        .collect::<Vec<_>>();
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&pids), true);
    owned.iter().all(|identity| {
        system
            .process(Pid::from_u32(identity.process.pid))
            .is_none_or(|process| !same_process(process, &identity.process))
    })
}

#[cfg(windows)]
fn merge_process_snapshots(
    destination: &mut Vec<OwnedProcessIdentity>,
    additional: Vec<OwnedProcessIdentity>,
) {
    for identity in additional {
        if !destination.iter().any(|existing| {
            existing.process.pid == identity.process.pid
                && existing.process.start_time == identity.process.start_time
                && existing.process.executable == identity.process.executable
        }) {
            destination.push(identity);
        }
    }
    destination.sort_by(|left, right| {
        right
            .depth
            .cmp(&left.depth)
            .then_with(|| right.process.pid.cmp(&left.process.pid))
    });
}

#[cfg(windows)]
fn terminate_owned_processes(owned: &[OwnedProcessIdentity]) {
    let pids = owned
        .iter()
        .map(|identity| Pid::from_u32(identity.process.pid))
        .collect::<Vec<_>>();
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&pids), true);
    for identity in owned {
        if let Some(process) = system.process(Pid::from_u32(identity.process.pid))
            && same_process(process, &identity.process)
        {
            let _ = process.kill();
        }
    }
}

fn stop_running_worker(running: &mut RunningWorker) {
    let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    #[cfg(windows)]
    let mut owned_processes = snapshot_owned_process_tree(running.child.id());

    // A generation request can legitimately occupy the worker for minutes.
    // Shutdown gets its own connection and deadline instead of waiting behind
    // that request or extending the deadline with IPC connect/read timeouts.
    let connection = running.connection();
    let (sender, _receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = call_connection_with_timeout(
            &connection,
            "system.shutdown",
            Value::Null,
            SHUTDOWN_TIMEOUT,
        );
        let _ = sender.send(result);
    });
    while Instant::now() < deadline {
        if matches!(running.child.try_wait(), Ok(Some(_))) {
            #[cfg(windows)]
            if owned_processes_are_gone(&owned_processes) {
                return;
            }
            #[cfg(not(windows))]
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    #[cfg(windows)]
    {
        let additional_processes = snapshot_descendants_of_owned_processes(&owned_processes);
        merge_process_snapshots(&mut owned_processes, additional_processes);
        terminate_owned_processes(&owned_processes);
    }
    let _ = running.child.kill();
    let cleanup_deadline = deadline + FORCE_CLEANUP_TIMEOUT;
    while Instant::now() < cleanup_deadline {
        let child_is_gone = matches!(running.child.try_wait(), Ok(Some(_)));
        #[cfg(windows)]
        if child_is_gone && owned_processes_are_gone(&owned_processes) {
            break;
        }
        #[cfg(not(windows))]
        if child_is_gone {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    #[cfg(windows)]
    terminate_owned_processes(&owned_processes);
}

fn call_connection(
    connection: &WorkerConnection,
    method: &str,
    payload: Value,
) -> Result<Value, CommandError> {
    call_connection_with_timeout(connection, method, payload, REQUEST_TIMEOUT)
}

fn call_connection_with_timeout(
    connection: &WorkerConnection,
    method: &str,
    payload: Value,
    timeout: Duration,
) -> Result<Value, CommandError> {
    let id = Uuid::now_v7();
    let request = RpcRequest {
        protocol_version: PROTOCOL_VERSION,
        id,
        authentication_token: &connection.token,
        method,
        payload,
    };
    let bytes = Zeroizing::new(
        serde_json::to_vec(&request)
            .map_err(|_| CommandError::worker("Worker request could not be encoded.", false))?,
    );
    let mut stream =
        TcpStream::connect_timeout(&connection.endpoint, timeout.min(Duration::from_secs(3)))
            .map_err(|_| {
                CommandError::worker("The pipeline worker IPC channel is unavailable.", true)
            })?;
    stream
        .set_read_timeout(Some(timeout))
        .and_then(|_| stream.set_write_timeout(Some(timeout)))
        .map_err(|_| CommandError::worker("Worker IPC timeouts could not be applied.", true))?;
    stream
        .write_all(&bytes)
        .and_then(|_| stream.write_all(b"\n"))
        .map_err(|_| CommandError::worker("The worker request could not be sent.", true))?;

    let mut response_bytes = Vec::new();
    stream
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut response_bytes)
        .map_err(|_| CommandError::worker("The worker response could not be read.", true))?;
    if response_bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(CommandError::worker(
            "The worker response exceeded the IPC safety limit.",
            false,
        ));
    }
    let response: RpcResponse = serde_json::from_slice(&response_bytes)
        .map_err(|_| CommandError::worker("The worker returned invalid JSON.", false))?;
    if response.protocol_version != PROTOCOL_VERSION || response.id != id {
        return Err(CommandError::worker(
            "The worker returned a mismatched response envelope.",
            false,
        ));
    }
    if response.ok {
        Ok(response.result)
    } else {
        let error = response.error.unwrap_or(RpcError {
            code: "UNKNOWN".into(),
            message: "The worker rejected the request.".into(),
            retryable: false,
        });
        let safe_code = sanitize_worker_text(&error.code, 64);
        let safe_message = sanitize_worker_text(&error.message, 500);
        Err(CommandError::worker(
            format!("{safe_code}: {safe_message}"),
            error.retryable,
        ))
    }
}

fn valid_method(method: &str) -> bool {
    matches!(
        method,
        "system.ping"
            | "system.shutdown"
            | "project.initialize"
            | "project.snapshot.get"
            | "project.snapshot.save"
            | "project.customization.save"
            | "project.history.get"
            | "project.history.undo"
            | "project.history.redo"
            | "project.export"
            | "source.import"
            | "asset.import"
            | "asset.resolve"
            | "presenter.profile.select"
            | "provider.routingPolicy.get"
            | "provider.routingPolicy.save"
            | "generation.start"
            | "generation.approve"
            | "generation.cancel"
            | "generation.retry"
            | "control.regenerateScene"
            | "control.searchVisualCandidates"
            | "control.acceptVisualCandidate"
            | "control.acceptSceneEditCandidate"
            | "control.rejectSceneEditCandidate"
            | "control.renderScene"
            | "control.repairQa"
            | "control.exportMaster"
            | "editor.timeline.export"
            | "editor.bindings.get"
            | "editor.waveform.get"
            | "job.status"
    ) || worker_method::NATIVE_MEDIA_REVIEW.contains(&method)
}

fn sanitize_worker_text(value: &str, max: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(max)
        .collect()
}

fn is_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[cfg(windows)]
    fn process_snapshot(pid: u32, parent_pid: Option<u32>) -> ProcessSnapshot {
        ProcessSnapshot {
            pid,
            parent_pid,
            start_time: u64::from(pid),
            executable: Some(PathBuf::from(format!(r"C:\worker\{pid}.exe"))),
            name: OsString::from(format!("{pid}.exe")),
        }
    }

    #[test]
    fn unavailable_binary_is_a_supported_state() {
        let supervisor = WorkerSupervisor::new(
            PathBuf::from("Z:/definitely/missing/alystria-pipeline.exe"),
            PathBuf::from("Z:/definitely/missing"),
        );
        assert!(matches!(
            supervisor.status(),
            WorkerStatus::Unavailable { .. }
        ));
    }

    #[test]
    fn only_narrow_rpc_methods_are_allowed() {
        assert!(valid_method("generation.start"));
        assert!(valid_method("project.snapshot.get"));
        assert!(valid_method("project.snapshot.save"));
        assert!(valid_method("project.customization.save"));
        assert!(valid_method("project.history.undo"));
        assert!(valid_method("control.renderScene"));
        assert!(valid_method("source.import"));
        assert!(valid_method("asset.import"));
        assert!(valid_method("asset.resolve"));
        assert!(valid_method("presenter.profile.select"));
        assert!(valid_method("project.export"));
        assert!(valid_method("provider.routingPolicy.get"));
        assert!(valid_method("provider.routingPolicy.save"));
        assert!(valid_method("editor.timeline.export"));
        assert!(valid_method("editor.bindings.get"));
        assert!(valid_method("editor.waveform.get"));
        assert!(valid_method("control.acceptVisualCandidate"));
        assert!(valid_method("control.acceptSceneEditCandidate"));
        assert!(valid_method("control.rejectSceneEditCandidate"));
        assert!(valid_method("control.searchVisualCandidates"));
        assert!(!valid_method("shell.execute"));
        assert!(!valid_method("filesystem.read"));
    }

    #[test]
    fn native_media_review_bridge_allows_only_the_exact_dispatch_methods() {
        assert_eq!(
            worker_method::NATIVE_MEDIA_REVIEW,
            [
                "control.searchMusicCandidates",
                "control.acceptMusicCandidate",
                "control.rejectMusicCandidate",
                "control.previewPresenterAnimation",
                "control.acceptPresenterAnimationPreview",
                "control.rejectPresenterAnimationPreview",
            ]
        );
        for method in worker_method::NATIVE_MEDIA_REVIEW {
            assert!(valid_method(method), "missing worker method: {method}");
        }
        assert!(!valid_method("control.previewPresenterAnimation.*"));
        assert!(!valid_method("control.acceptPresenterAnimation"));
    }

    #[test]
    fn sanitizes_untrusted_worker_messages() {
        assert_eq!(sanitize_worker_text("bad\nsecret", 20), "badsecret");
        assert_eq!(sanitize_worker_text("123456", 3), "123");
    }

    #[test]
    fn pinned_worker_hash_is_checked_before_spawn() {
        let temp = TempDir::new().unwrap();
        let worker = temp.path().join("worker");
        fs::write(&worker, b"not-the-signed-worker").unwrap();
        let supervisor = WorkerSupervisor::from_launch_config(WorkerLaunchConfig {
            executable: worker,
            working_directory: temp.path().join("work"),
            expected_sha256: Some("0".repeat(64)),
            environment: BTreeMap::new(),
            runtime_verification: None,
        });
        let error = supervisor.start().unwrap_err();
        assert!(error.message.contains("SHA-256"));
        assert!(matches!(
            supervisor.status(),
            WorkerStatus::Failed {
                retryable: false,
                ..
            }
        ));
    }

    #[cfg(windows)]
    #[test]
    fn owned_process_cleanup_selects_only_descendants_and_orders_children_first() {
        let processes = vec![
            process_snapshot(10, Some(1)),
            process_snapshot(11, Some(10)),
            process_snapshot(12, Some(11)),
            process_snapshot(20, Some(1)),
            process_snapshot(21, Some(20)),
        ];

        let owned = owned_processes_from_snapshot(&processes, 10);

        assert_eq!(
            owned
                .iter()
                .map(|identity| identity.process.pid)
                .collect::<Vec<_>>(),
            vec![12, 11, 10]
        );

        let reparented_child = process_snapshot(11, Some(1));
        let late_grandchild = process_snapshot(13, Some(11));
        let refreshed = owned_processes_from_seeds(
            &[reparented_child, late_grandchild],
            BTreeMap::from([(11, 1)]),
        );
        assert_eq!(
            refreshed
                .iter()
                .map(|identity| identity.process.pid)
                .collect::<Vec<_>>(),
            vec![13, 11]
        );
    }

    #[test]
    fn credential_broker_drop_never_waits_for_a_stuck_handler() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let endpoint = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let thread = std::thread::spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(5));
            }
            std::thread::sleep(Duration::from_secs(1));
        });
        let broker = CredentialBroker {
            endpoint,
            token: Zeroizing::new("fixture-token".into()),
            stop,
            thread: Some(thread),
        };

        let started = Instant::now();
        drop(broker);

        assert!(started.elapsed() < Duration::from_millis(600));
        drop(listener);
    }

    #[cfg(windows)]
    #[test]
    fn shutdown_deadline_is_not_blocked_by_an_in_flight_worker_call() {
        use std::os::windows::process::CommandExt;

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let endpoint = listener.local_addr().unwrap();
        let (accepted_sender, accepted_receiver) = mpsc::sync_channel(1);
        let server = std::thread::spawn(move || {
            let (mut request_stream, _) = listener.accept().unwrap();
            let mut request_line = String::new();
            BufReader::new(&mut request_stream)
                .read_line(&mut request_line)
                .unwrap();
            let request: Value = serde_json::from_str(&request_line).unwrap();
            accepted_sender.send(()).unwrap();
            std::thread::sleep(Duration::from_secs(5));
            let response = serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "id": request["id"],
                "ok": true,
                "result": null,
                "error": null
            });
            writeln!(request_stream, "{}", response).unwrap();
            let _ = request_stream.flush();

            listener.set_nonblocking(true).unwrap();
            let deadline = Instant::now() + Duration::from_secs(1);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((_shutdown_stream, _)) => break,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        let mut child_command = Command::new("cmd.exe");
        child_command
            .args(["/D", "/S", "/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000);
        let child = child_command.spawn().unwrap();
        let supervisor = Arc::new(WorkerSupervisor {
            executable: PathBuf::from("fixture-worker.exe"),
            working_directory: PathBuf::from("fixture-work"),
            expected_sha256: None,
            environment: BTreeMap::new(),
            runtime_verification: None,
            credentials: None,
            lifecycle: Mutex::new(WorkerLifecycle::Ready(RunningWorker {
                child,
                endpoint,
                token: Zeroizing::new("fixture-token".into()),
                _credential_broker: None,
            })),
            shutdown: Mutex::new(()),
            closed: AtomicBool::new(false),
        });
        let calling_supervisor = supervisor.clone();
        let call = std::thread::spawn(move || calling_supervisor.call("system.ping", Value::Null));
        accepted_receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let stopping_supervisor = supervisor.clone();
        let first_stop = std::thread::spawn(move || {
            let started = Instant::now();
            stopping_supervisor.close();
            started.elapsed()
        });
        let state_deadline = Instant::now() + Duration::from_secs(1);
        while !matches!(supervisor.status(), WorkerStatus::Stopping)
            && Instant::now() < state_deadline
        {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(matches!(supervisor.status(), WorkerStatus::Stopping));
        let concurrent_supervisor = supervisor.clone();
        let concurrent_stop = std::thread::spawn(move || concurrent_supervisor.stop());
        std::thread::sleep(Duration::from_millis(100));
        assert!(matches!(supervisor.status(), WorkerStatus::Stopping));

        let shutdown_elapsed = first_stop.join().unwrap();
        concurrent_stop.join().unwrap();

        assert!(
            shutdown_elapsed < Duration::from_millis(4_500),
            "shutdown took {shutdown_elapsed:?}"
        );
        assert!(call.join().unwrap().is_ok());
        server.join().unwrap();
        assert!(matches!(supervisor.status(), WorkerStatus::Stopped));
        for result in [
            supervisor.start(),
            supervisor.restart(),
            supervisor
                .call("system.ping", Value::Null)
                .map(|_| supervisor.status()),
        ] {
            let error = result.expect_err("Late polling must not restart a closed desktop worker");
            assert_eq!(error.message, "The desktop is shutting down.");
            assert!(!error.retryable);
        }
    }
}
