use crate::secrets::{OsKeyringSecretStore, SecretStore, SecretStoreError};
use crate::sidecar::WorkerSupervisor;
use crate::types::{
    AppPaths, DiagnosticCheck, DiagnosticLevel, DiagnosticReport, GpuSummary, SystemSummary,
    WorkerStatus,
};
use chrono::Utc;
use std::collections::BTreeMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use sysinfo::System;

const GIB: u64 = 1024 * 1024 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub fn run(paths: &AppPaths, worker: &WorkerSupervisor) -> DiagnosticReport {
    let mut system = System::new_all();
    system.refresh_all();
    let mut checks = vec![
        storage_check(&paths.app_data),
        ffmpeg_check(&paths.runtimes),
        keyring_check(),
        worker_check(worker.status()),
        power_profile_check(),
    ];
    let gpu = gpu_probe();
    checks.push(gpu_check(&gpu));
    let overall = checks
        .iter()
        .map(|check| check.level)
        .max()
        .unwrap_or(DiagnosticLevel::Info);
    let cpu = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Unknown CPU".into());

    DiagnosticReport {
        generated_at: Utc::now(),
        overall,
        checks,
        system: SystemSummary {
            os: System::name().unwrap_or_else(|| std::env::consts::OS.into()),
            os_version: System::os_version(),
            architecture: std::env::consts::ARCH.into(),
            cpu,
            logical_cpu_count: system.cpus().len(),
            total_memory_bytes: system.total_memory(),
            available_memory_bytes: system.available_memory(),
            gpu,
        },
    }
}

fn storage_check(path: &Path) -> DiagnosticCheck {
    let mut details = BTreeMap::new();
    details.insert("path".into(), path.to_string_lossy().into_owned());
    match fs2::available_space(path) {
        Ok(bytes) => {
            details.insert("availableBytes".into(), bytes.to_string());
            let (level, summary, remediation) = if bytes < 5 * GIB {
                (
                    DiagnosticLevel::Failure,
                    "Less than 5 GiB is available for projects and render staging.",
                    Some("Free local disk space before generating or exporting media.".into()),
                )
            } else if bytes < 25 * GIB {
                (
                    DiagnosticLevel::Warning,
                    "Render storage is running low.",
                    Some("Keep at least 25 GiB available for reliable 4K render staging.".into()),
                )
            } else {
                (
                    DiagnosticLevel::Pass,
                    "Local project and render storage is available.",
                    None,
                )
            };
            check(
                "storage",
                "Project storage",
                level,
                summary,
                details,
                remediation,
            )
        }
        Err(_) => check(
            "storage",
            "Project storage",
            DiagnosticLevel::Failure,
            "Available storage could not be measured.",
            details,
            Some("Verify that the Alystria application-data folder is accessible.".into()),
        ),
    }
}

fn ffmpeg_check(runtime_root: &Path) -> DiagnosticCheck {
    let executable_name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let candidates = [
        runtime_root
            .join("ffmpeg")
            .join("current")
            .join("bin")
            .join(executable_name),
        PathBuf::from(executable_name),
    ];
    let mut details = BTreeMap::new();
    for candidate in candidates {
        let result = hidden_command(&candidate)
            .args(["-hide_banner", "-version"])
            .output();
        if let Ok(output) = result
            && output.status.success()
        {
            let first_line = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("FFmpeg detected")
                .trim()
                .to_owned();
            details.insert(
                "executable".into(),
                candidate.to_string_lossy().into_owned(),
            );
            details.insert("version".into(), first_line);
            return check(
                "ffmpeg",
                "FFmpeg runtime",
                DiagnosticLevel::Pass,
                "FFmpeg is available.",
                details,
                None,
            );
        }
    }
    check(
        "ffmpeg",
        "FFmpeg runtime",
        DiagnosticLevel::Warning,
        "FFmpeg is not installed in the managed runtime folder or on PATH.",
        details,
        Some("Install the signed FFmpeg runtime pack from Models & Providers.".into()),
    )
}

fn keyring_check() -> DiagnosticCheck {
    let details = BTreeMap::new();
    match OsKeyringSecretStore.contains("diagnostics/nonexistent") {
        Ok(_) => check(
            "keyring",
            "Credential vault",
            DiagnosticLevel::Pass,
            "The operating-system credential vault is available.",
            details,
            None,
        ),
        Err(SecretStoreError::Unavailable) => check(
            "keyring",
            "Credential vault",
            DiagnosticLevel::Warning,
            "The operating-system credential vault is unavailable.",
            details,
            Some(
                "Unlock or start the platform credential service before adding provider keys."
                    .into(),
            ),
        ),
        Err(_) => check(
            "keyring",
            "Credential vault",
            DiagnosticLevel::Warning,
            "The credential vault denied or failed the diagnostic probe.",
            details,
            Some("Check operating-system credential permissions.".into()),
        ),
    }
}

fn worker_check(status: WorkerStatus) -> DiagnosticCheck {
    let mut details = BTreeMap::new();
    details.insert(
        "state".into(),
        serde_json::to_string(&status).unwrap_or_else(|_| "unknown".into()),
    );
    match status {
        WorkerStatus::Ready { .. } => check(
            "pipeline-worker",
            "Pipeline worker",
            DiagnosticLevel::Pass,
            "The local pipeline worker is ready.",
            details,
            None,
        ),
        WorkerStatus::Unavailable { .. } => check(
            "pipeline-worker",
            "Pipeline worker",
            DiagnosticLevel::Warning,
            "The pipeline worker is not installed; editing remains available but generation is blocked.",
            details,
            Some("Install or package the matching pipeline worker runtime.".into()),
        ),
        WorkerStatus::Failed { .. } | WorkerStatus::Degraded { .. } => check(
            "pipeline-worker",
            "Pipeline worker",
            DiagnosticLevel::Failure,
            "The pipeline worker needs attention.",
            details,
            Some("Restart the worker from Settings & Diagnostics and inspect local logs.".into()),
        ),
        _ => check(
            "pipeline-worker",
            "Pipeline worker",
            DiagnosticLevel::Info,
            "The pipeline worker is not currently running.",
            details,
            None,
        ),
    }
}

fn power_profile_check() -> DiagnosticCheck {
    let mut details = BTreeMap::new();
    #[cfg(windows)]
    {
        if let Ok(output) = hidden_command("powercfg.exe")
            .arg("/getactivescheme")
            .output()
            && output.status.success()
        {
            details.insert(
                "activeScheme".into(),
                String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            );
        }
    }
    check(
        "power-profile",
        "Power profile",
        DiagnosticLevel::Info,
        "Diagnostics do not change the Windows or G-Helper power profile. Quiet-mode results are suitable for functional checks, not release benchmarks.",
        details,
        None,
    )
}

fn gpu_probe() -> Vec<GpuSummary> {
    let output = hidden_command(if cfg!(windows) {
        "nvidia-smi.exe"
    } else {
        "nvidia-smi"
    })
    .args([
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ])
    .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split(',').map(str::trim);
            let name = fields.next()?.to_owned();
            let memory_mib = fields.next()?.parse::<u64>().ok();
            let driver = fields
                .next()
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            Some(GpuSummary {
                name,
                dedicated_memory_bytes: memory_mib.map(|value| value * 1024 * 1024),
                driver_version: driver,
            })
        })
        .collect()
}

fn gpu_check(gpus: &[GpuSummary]) -> DiagnosticCheck {
    let mut details = BTreeMap::new();
    details.insert("detectedCount".into(), gpus.len().to_string());
    if let Some(gpu) = gpus.first() {
        details.insert("primary".into(), gpu.name.clone());
        if let Some(memory) = gpu.dedicated_memory_bytes {
            details.insert("dedicatedMemoryBytes".into(), memory.to_string());
        }
        check(
            "gpu",
            "GPU acceleration",
            DiagnosticLevel::Pass,
            "An NVIDIA GPU was detected. Capability support still depends on per-model functional benchmarks.",
            details,
            None,
        )
    } else {
        check(
            "gpu",
            "GPU acceleration",
            DiagnosticLevel::Info,
            "No NVIDIA GPU was reported by nvidia-smi. CPU and cloud workflows can remain available.",
            details,
            None,
        )
    }
}

fn check(
    id: &str,
    label: &str,
    level: DiagnosticLevel,
    summary: &str,
    details: BTreeMap<String, String>,
    remediation: Option<String>,
) -> DiagnosticCheck {
    DiagnosticCheck {
        id: id.into(),
        label: label.into(),
        level,
        summary: summary.into(),
        details,
        remediation,
    }
}
