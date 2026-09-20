use std::io;
use std::process::Child;

#[cfg(windows)]
pub const CREATE_SUSPENDED_PROCESS: u32 = 0x0000_0004;

/// Keeps a spawned process and every descendant inside a Windows job that is
/// terminated when the desktop explicitly closes it or the desktop process
/// itself exits. The non-Windows build keeps the same lifecycle API while the
/// direct child remains owned by its caller.
#[cfg(windows)]
pub struct KillOnCloseJob {
    handle: isize,
}

#[cfg(windows)]
impl std::fmt::Debug for KillOnCloseJob {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("KillOnCloseJob")
            .field("active", &(self.handle != 0))
            .finish()
    }
}

#[cfg(windows)]
impl KillOnCloseJob {
    pub fn attach_suspended(child: &Child) -> io::Result<Self> {
        let job = Self::attach(child)?;
        resume_primary_thread(child.id())?;
        Ok(job)
    }

    fn attach(child: &Child) -> io::Result<Self> {
        use std::mem::size_of;
        use std::os::windows::io::AsRawHandle;
        use std::ptr;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };

        // SAFETY: null attributes and name request an unnamed job with default
        // security. The returned handle is closed by Drop on every path.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self {
            handle: handle as isize,
        };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `limits` is the exact structure required by the selected
        // information class and remains alive for the duration of the call.
        let configured = unsafe {
            SetInformationJobObject(
                job.raw_handle(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: std owns a valid process handle for the live Child. The job
        // remains open in `job` after a successful assignment.
        let assigned =
            unsafe { AssignProcessToJobObject(job.raw_handle(), child.as_raw_handle().cast()) };
        if assigned == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    pub fn terminate(&mut self) {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        if self.handle == 0 {
            return;
        }
        // SAFETY: this object exclusively owns the live job handle.
        unsafe {
            let _ = TerminateJobObject(self.raw_handle(), 1);
        }
    }

    fn close(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        if self.handle == 0 {
            return;
        }
        // SAFETY: this object exclusively owns the live job handle. Closing a
        // configured kill-on-close job is the abrupt parent-death guarantee.
        unsafe {
            let _ = CloseHandle(self.raw_handle());
        }
        self.handle = 0;
    }

    fn raw_handle(&self) -> windows_sys::Win32::Foundation::HANDLE {
        self.handle as windows_sys::Win32::Foundation::HANDLE
    }
}

#[cfg(windows)]
fn resume_primary_thread(process_id: u32) -> io::Result<()> {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    // SAFETY: Toolhelp returns a snapshot handle owned and closed in this
    // function. THREADENTRY32 has the exact documented size and layout.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    // SAFETY: `entry` remains writable for the enumeration and `snapshot` is
    // a live Toolhelp handle.
    let mut available = unsafe { Thread32First(snapshot, &raw mut entry) } != 0;
    while available {
        if entry.th32OwnerProcessID == process_id {
            // SAFETY: the enumerated thread belongs to the newly created,
            // suspended child and the returned handle is closed below.
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if thread.is_null() {
                unsafe {
                    let _ = CloseHandle(snapshot);
                }
                return Err(io::Error::last_os_error());
            }
            let resumed = unsafe { ResumeThread(thread) };
            unsafe {
                let _ = CloseHandle(thread);
                let _ = CloseHandle(snapshot);
            }
            if resumed == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            return Ok(());
        }
        available = unsafe { Thread32Next(snapshot, &raw mut entry) } != 0;
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "suspended process thread was not found",
    ))
}

#[cfg(windows)]
impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(not(windows))]
#[derive(Debug)]
pub struct KillOnCloseJob;

#[cfg(not(windows))]
impl KillOnCloseJob {
    pub fn attach_suspended(_child: &Child) -> io::Result<Self> {
        Ok(Self)
    }

    pub fn terminate(&mut self) {}
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};
    use sysinfo::{Pid, ProcessesToUpdate, System};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    #[test]
    fn closing_job_terminates_hidden_child_and_descendant() {
        let directory = tempfile::tempdir().expect("temporary process-tree directory");
        let allow = directory.path().join("allow");
        let descendant_pid = directory.path().join("descendant.pid");
        let quote = |path: &std::path::Path| path.display().to_string().replace('\'', "''");
        let script = format!(
            "$ErrorActionPreference='Stop'; while (-not (Test-Path -LiteralPath '{}')) {{ Start-Sleep -Milliseconds 20 }}; $info=[Diagnostics.ProcessStartInfo]::new(); $info.FileName=$env:ComSpec; $info.Arguments='/d /q /c ping -t 127.0.0.1'; $info.CreateNoWindow=$true; $info.UseShellExecute=$false; $descendant=[Diagnostics.Process]::Start($info); Set-Content -LiteralPath '{}' -Value $descendant.Id -NoNewline; $descendant.WaitForExit()",
            quote(&allow),
            quote(&descendant_pid),
        );
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &script,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED_PROCESS);
        let mut child = command.spawn().expect("hidden parent process");
        let job = KillOnCloseJob::attach_suspended(&child).expect("kill-on-close job");
        fs::write(&allow, b"go").expect("release child gate");

        let deadline = Instant::now() + Duration::from_secs(8);
        while !descendant_pid.is_file() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let descendant = fs::read_to_string(&descendant_pid)
            .expect("descendant pid receipt")
            .parse::<u32>()
            .expect("numeric descendant pid");
        assert!(process_exists(descendant), "descendant should be running");

        drop(job);
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) && !process_exists(descendant) {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            !process_exists(descendant),
            "job close must terminate descendants"
        );
    }

    fn process_exists(pid: u32) -> bool {
        let pid = Pid::from_u32(pid);
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        system.process(pid).is_some()
    }
}
