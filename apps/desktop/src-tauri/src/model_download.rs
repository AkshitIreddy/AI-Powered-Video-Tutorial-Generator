//! Pinned local model downloads and managed local-image installation.
//!
//! Quarantined presenter packs deliberately stop before activation. The
//! hardware-reviewed SDXL path delegates installation and preflight to the
//! packaged pipeline's `ComfyBundleInstaller`; candidate image bundles remain
//! non-executable after their exact files are installed.

use crate::error::CommandError;
#[cfg(windows)]
use crate::process_tree::CREATE_SUSPENDED_PROCESS;
use crate::process_tree::KillOnCloseJob;
use crate::types::{
    ModelDownloadCatalogEntry, ModelDownloadPhase, ModelDownloadStartRequest, ModelDownloadStatus,
};
use chrono::Utc;
use parking_lot::{Mutex, RwLock};
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_RANGE, RANGE};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const STATUS_FILE: &str = "download-status.json";
const MAX_ARTIFACT_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_INSTALLER_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_MANAGED_MANIFEST_BYTES: u64 = 128 * 1024;
const MANAGED_PROGRESS_POLL_INTERVAL: Duration = Duration::from_millis(250);
const INSTALLER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const COMFYUI_RUNTIME_BYTES: u64 = 1_803_412_624;
const COMFYUI_RUNTIME_REVISION: &str = "8f40b43e0204d5b9780f3e9618e140e929e80594";
const COMFYUI_RUNTIME_ARCHIVE: &str = "ComfyUI-v0.9.2-nvidia.7z";
const COMFYUI_RUNTIME_SHA256: &str =
    "3a0707fbf1cf5dc8b5f1ab3abe8af104deffcb1acc27b8d27c484715dd41f4c5";
const SDXL_RECIPE_ID: &str = "comfy-sdxl-1.0-portrait-v1";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InstallStrategy {
    Quarantine,
    ManagedComfyRuntime,
    ManagedComfy {
        bundle_bytes: u64,
        artifact_count: usize,
        executable: bool,
    },
}

#[derive(Debug, Clone, Copy)]
struct ArtifactSpec {
    relative_path: &'static str,
    repository: &'static str,
    revision: &'static str,
    upstream_path: &'static str,
    size_bytes: u64,
    sha256: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct PackageSpec {
    model_id: &'static str,
    display_name: &'static str,
    immutable_revision: &'static str,
    code_revision: &'static str,
    weight_revision: &'static str,
    license_id: &'static str,
    license_url: &'static str,
    license_sha256: &'static str,
    license_scope: &'static str,
    download_only_reason: &'static str,
    artifacts: &'static [ArtifactSpec],
    managed_files: &'static [ManagedManifestFile],
    strategy: InstallStrategy,
}

#[derive(Debug, Clone, Copy)]
struct ManagedManifestFile {
    relative_path: &'static str,
    source_url: &'static str,
    size_bytes: u64,
    sha256: &'static str,
}

const COMFYUI_RUNTIME_FILE: ManagedManifestFile = ManagedManifestFile {
    relative_path: COMFYUI_RUNTIME_ARCHIVE,
    source_url: "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.9.2/ComfyUI_windows_portable_nvidia.7z",
    size_bytes: COMFYUI_RUNTIME_BYTES,
    sha256: COMFYUI_RUNTIME_SHA256,
};

const COMFYUI_RUNTIME: PackageSpec = PackageSpec {
    model_id: "runtime/comfyui-0.9.2",
    display_name: "ComfyUI 0.9.2 portable runtime",
    immutable_revision: "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594",
    code_revision: COMFYUI_RUNTIME_REVISION,
    weight_revision: "runtime-only",
    license_id: "GPL-3.0",
    license_url: "https://raw.githubusercontent.com/Comfy-Org/ComfyUI/8f40b43e0204d5b9780f3e9618e140e929e80594/LICENSE",
    license_sha256: "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
    license_scope: "Pinned ComfyUI source and portable NVIDIA runtime archive. Bundled Python, PyTorch, CUDA, and other dependencies retain their own upstream terms.",
    download_only_reason: "Standalone shared execution runtime for managed local image packs. It contains no model weights and cannot generate images until a reviewed model recipe is also installed.",
    artifacts: &[],
    managed_files: &[],
    strategy: InstallStrategy::ManagedComfyRuntime,
};

const SDXL_MANIFEST_FILES: &[ManagedManifestFile] = &[
    ManagedManifestFile {
        relative_path: "models/checkpoints/sd_xl_base_1.0.safetensors",
        source_url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/462165984030d82259a11f4367a4eed129e94a7b/sd_xl_base_1.0.safetensors?download=true",
        size_bytes: 6_938_078_334,
        sha256: "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
    },
    ManagedManifestFile {
        relative_path: "models/loras/sd_xl_offset_example-lora_1.0.safetensors",
        source_url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/462165984030d82259a11f4367a4eed129e94a7b/sd_xl_offset_example-lora_1.0.safetensors?download=true",
        size_bytes: 49_553_604,
        sha256: "4852686128f953d0277d0793e2f0335352f96a919c9c16a09787d77f55cbdf6f",
    },
];

const FLUX_KLEIN_MANIFEST_FILES: &[ManagedManifestFile] = &[
    ManagedManifestFile {
        relative_path: "models/diffusion_models/flux-2-klein-4b-fp8.safetensors",
        source_url: "https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/5b4408e59397a4a37ccb46afe426d8ed86379441/flux-2-klein-4b-fp8.safetensors?download=true",
        size_bytes: 4_070_624_520,
        sha256: "97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6",
    },
    ManagedManifestFile {
        relative_path: "models/text_encoders/qwen_3_4b_fp4_flux2.safetensors",
        source_url: "https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/5f526678002e43af5551dadb73ce2e8c91b43afe/split_files/text_encoders/qwen_3_4b_fp4_flux2.safetensors?download=true",
        size_bytes: 3_848_213_998,
        sha256: "3eab03a77adb0ee5304a4e677d5c10ac22f9049c1d7c894adca4f8bb39206ca8",
    },
    ManagedManifestFile {
        relative_path: "models/vae/flux2-vae.safetensors",
        source_url: "https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/5f526678002e43af5551dadb73ce2e8c91b43afe/split_files/vae/flux2-vae.safetensors?download=true",
        size_bytes: 336_211_292,
        sha256: "868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3",
    },
];

const Z_IMAGE_MANIFEST_FILES: &[ManagedManifestFile] = &[
    ManagedManifestFile {
        relative_path: "models/diffusion_models/z_image_turbo_int8_convrot.safetensors",
        source_url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/08d04455279082882deaabc8d0d09fc914c071e1/split_files/diffusion_models/z_image_turbo_int8_convrot.safetensors?download=true",
        size_bytes: 6_201_001_296,
        sha256: "be517ebd47c912a5626a588e1aeea43e6be4a43c0cdcd2b48a2a780d9f358635",
    },
    ManagedManifestFile {
        relative_path: "models/text_encoders/qwen_3_4b_fp4_mixed.safetensors",
        source_url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/08d04455279082882deaabc8d0d09fc914c071e1/split_files/text_encoders/qwen_3_4b_fp4_mixed.safetensors?download=true",
        size_bytes: 3_479_416_193,
        sha256: "7ca32dcf07dfe7692945d80fff86e3a74cb83c6206b9b223ac6836b939bb85d6",
    },
    ManagedManifestFile {
        relative_path: "models/vae/ae.safetensors",
        source_url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/08d04455279082882deaabc8d0d09fc914c071e1/split_files/vae/ae.safetensors?download=true",
        size_bytes: 335_304_388,
        sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
    },
];

// This exact artifact set was hash-verified during the RC MuseTalk spike. Some
// upstream `.pth` files may contain pickle payloads, so this pack remains in a
// quarantine directory and can never be activated by this module.
const MUSETALK_ARTIFACTS: &[ArtifactSpec] = &[
    artifact(
        "musetalkV15/musetalk.json",
        "TMElyralab/MuseTalk",
        "3ef28bc5cff08c90ad8178a25f1b570cd800170f",
        "musetalkV15/musetalk.json",
        748,
        "5b6923aee04d71692e0e9846c471e0a4ea07a4f686d39545e472bd4ba17e1b47",
    ),
    artifact(
        "musetalkV15/unet.pth",
        "TMElyralab/MuseTalk",
        "3ef28bc5cff08c90ad8178a25f1b570cd800170f",
        "musetalkV15/unet.pth",
        3_400_074_924,
        "7ebf6c98c181e20838e4c0054e96e944ac60d5d692cc01db42839fe11b787007",
    ),
    artifact(
        "sd-vae-ft-mse/config.json",
        "stabilityai/sd-vae-ft-mse",
        "31f26fdeee1355a5c34592e401dd41e45d25a493",
        "config.json",
        547,
        "92d3dfb746fca211a2c9e019e285f8597412211728dce3c5bcf4eda0f2d62e7e",
    ),
    artifact(
        "sd-vae-ft-mse/diffusion_pytorch_model.safetensors",
        "stabilityai/sd-vae-ft-mse",
        "31f26fdeee1355a5c34592e401dd41e45d25a493",
        "diffusion_pytorch_model.safetensors",
        334_643_276,
        "a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815",
    ),
    artifact(
        "whisper/config.json",
        "openai/whisper-tiny",
        "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
        "config.json",
        1_983,
        "ffdccec4f3211f4c63310f2b7098f309fe70f3952cedc5e4d11e43f5b2379b98",
    ),
    artifact(
        "whisper/model.safetensors",
        "openai/whisper-tiny",
        "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
        "model.safetensors",
        151_061_672,
        "7ebd0e69e78190ffe1438491fa05cc1f5c1aa3a4c4db3bc1723adbb551ea2395",
    ),
    artifact(
        "whisper/preprocessor_config.json",
        "openai/whisper-tiny",
        "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
        "preprocessor_config.json",
        184_990,
        "9b5cd03a36fbb8a627c64d98a5b5b126ead95a77720723944487311f0110b666",
    ),
    artifact(
        "dwpose/dw-ll_ucoco_384.pth",
        "yzd-v/DWPose",
        "1a7144101628d69ee7a3768d1ee3a094070dc388",
        "dw-ll_ucoco_384.pth",
        406_878_486,
        "0d9408b13cd863c4e95a149dd31232f88f2a12aa6cf8964ed74d7d97748c7a07",
    ),
    artifact(
        "face-parse-bisent/79999_iter.pth",
        "ManyOtherFunctions/face-parse-bisent",
        "0073b233a5a3c4b1377d4dbf49245017938a72b5",
        "79999_iter.pth",
        53_289_463,
        "468e13ca13a9b43cc0881a9f99083a430e9c0a38abd935431d1c28ee94b26567",
    ),
    artifact(
        "face-parse-bisent/resnet18-5c106cde.pth",
        "ManyOtherFunctions/face-parse-bisent",
        "0073b233a5a3c4b1377d4dbf49245017938a72b5",
        "resnet18-5c106cde.pth",
        46_827_520,
        "5c106cde386e87d4033832f2996f5493238eda96ccf559d1d62760c4de0613f8",
    ),
];

const fn artifact(
    relative_path: &'static str,
    repository: &'static str,
    revision: &'static str,
    upstream_path: &'static str,
    size_bytes: u64,
    sha256: &'static str,
) -> ArtifactSpec {
    ArtifactSpec {
        relative_path,
        repository,
        revision,
        upstream_path,
        size_bytes,
        sha256,
    }
}

const MUSETALK: PackageSpec = PackageSpec {
    model_id: "local/musetalk-1.5",
    display_name: "MuseTalk 1.5",
    immutable_revision: "musetalk-hf-3ef28bc5+code-0a89dec4+dependencies-2026-08-29",
    code_revision: "0a89dec45a0192b824e3cf4daf96c239440c5ed8",
    weight_revision: "3ef28bc5cff08c90ad8178a25f1b570cd800170f",
    license_id: "MIT-code-repository",
    license_url: "https://github.com/TMElyralab/MuseTalk/blob/0a89dec45a0192b824e3cf4daf96c239440c5ed8/LICENSE",
    license_sha256: "992ec5fd1dd4964cfa003665196cd0c0c10a7a5aa10109991e964eebd2c7f116",
    license_scope: "MuseTalk source code only; model-card and dependency terms remain separate activation gates.",
    download_only_reason: "Hash-verified quarantine download only. This acknowledgement covers the pinned MuseTalk code license, not a combined pack license. Model-card and dependency terms remain separate, and upstream .pth files are not activated or executed until dependency-license, runtime-trust, and hardware reviews pass.",
    artifacts: MUSETALK_ARTIFACTS,
    managed_files: &[],
    strategy: InstallStrategy::Quarantine,
};

const SDXL: PackageSpec = PackageSpec {
    model_id: "local/sdxl-base-1.0",
    display_name: "Stable Diffusion XL Base 1.0 + optional offset LoRA",
    immutable_revision: "comfyui-8f40b43e+sdxl-46216598",
    code_revision: COMFYUI_RUNTIME_REVISION,
    weight_revision: "462165984030d82259a11f4367a4eed129e94a7b",
    license_id: "CreativeML Open RAIL++-M",
    license_url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/462165984030d82259a11f4367a4eed129e94a7b/LICENSE.md",
    license_sha256: "19b6998b569b53ac1fc2158a8a3202c8699a9a4605b47075715d9c96be7fb6d0",
    license_scope: "Pinned SDXL base and official offset-example LoRA weights. The pinned ComfyUI runtime and its bundled dependencies retain their own upstream terms.",
    download_only_reason: "One-click managed install. The packaged installer verifies the ComfyUI v0.9.2 archive, SDXL base, and optional official offset LoRA by exact byte count and SHA-256, then runs the hardware-reviewed SDXL preflight. The LoRA stays optional in generation because the reference proof showed a minor out-of-crop artifact.",
    artifacts: &[],
    managed_files: SDXL_MANIFEST_FILES,
    strategy: InstallStrategy::ManagedComfy {
        bundle_bytes: 6_987_631_938,
        artifact_count: 3,
        executable: true,
    },
};

const FLUX_KLEIN: PackageSpec = PackageSpec {
    model_id: "local/flux.2-klein-4b-fp8",
    display_name: "FLUX.2 Klein 4B FP8 bundle",
    immutable_revision: "comfyui-8f40b43e+flux-5b4408e5+assets-5f526678",
    code_revision: COMFYUI_RUNTIME_REVISION,
    weight_revision: "5b4408e59397a4a37ccb46afe426d8ed86379441",
    license_id: "Apache-2.0",
    license_url: "https://www.apache.org/licenses/LICENSE-2.0.txt",
    license_sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    license_scope: "Pinned BFL diffusion weight plus the pinned Comfy companion text encoder and VAE, each published as Apache-2.0. The ComfyUI runtime and bundled dependencies retain their own upstream terms.",
    download_only_reason: "Advanced download candidate. Exact FP8 diffusion, FP4 text encoder, VAE, and ComfyUI v0.9.2 files are installed and verified, but this roughly 13 GB workflow has not passed the reference 12 GB Windows preflight. It remains unavailable for generation until a reviewed CPU-offload recipe passes.",
    artifacts: &[],
    managed_files: FLUX_KLEIN_MANIFEST_FILES,
    strategy: InstallStrategy::ManagedComfy {
        bundle_bytes: 8_255_049_810,
        artifact_count: 4,
        executable: false,
    },
};

const Z_IMAGE: PackageSpec = PackageSpec {
    model_id: "local/z-image-turbo-int8",
    display_name: "Z-Image Turbo INT8 + FP4 bundle",
    immutable_revision: "comfyui-8f40b43e+z-image-08d04455",
    code_revision: COMFYUI_RUNTIME_REVISION,
    weight_revision: "08d04455279082882deaabc8d0d09fc914c071e1",
    license_id: "Apache-2.0",
    license_url: "https://www.apache.org/licenses/LICENSE-2.0.txt",
    license_sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    license_scope: "Pinned Comfy-Org INT8 diffusion weight, FP4 text encoder, and VAE published as Apache-2.0. The ComfyUI runtime and bundled dependencies retain their own upstream terms.",
    download_only_reason: "Advanced download candidate. Exact INT8 diffusion, FP4 text encoder, VAE, and ComfyUI v0.9.2 files are installed and verified, but this workflow has not passed the reference 12 GB Windows preflight. It remains unavailable for generation until a reviewed offload recipe passes.",
    artifacts: &[],
    managed_files: Z_IMAGE_MANIFEST_FILES,
    strategy: InstallStrategy::ManagedComfy {
        bundle_bytes: 10_015_721_877,
        artifact_count: 4,
        executable: false,
    },
};

#[cfg(feature = "portable-debug-runtime")]
const ACCEPTANCE_DOWNLOAD_URL_ENV: &str = "ALYSTRIA_ACCEPTANCE_MODEL_DOWNLOAD_URL";
#[cfg(feature = "portable-debug-runtime")]
const ACCEPTANCE_DOWNLOAD_FIXTURE_ARTIFACTS: &[ArtifactSpec] = &[artifact(
    "fixture/alystria-model-download-fixture.bin",
    "alystria/portable-debug-loopback-fixture",
    "1111111111111111111111111111111111111111",
    "alystria-model-download-fixture.bin",
    4 * 1024 * 1024,
    "bb9f8df61474d25e71fa00722318cd387396ca1736605e1248821cc0de3d3af8",
)];
#[cfg(feature = "portable-debug-runtime")]
const ACCEPTANCE_DOWNLOAD_FIXTURE: PackageSpec = PackageSpec {
    model_id: "acceptance/download-fixture-v1",
    display_name: "Acceptance download fixture (4 MiB)",
    immutable_revision: "portable-debug-loopback-fixture-v1",
    code_revision: "1111111111111111111111111111111111111111",
    weight_revision: "2222222222222222222222222222222222222222",
    license_id: "Alystria acceptance fixture",
    license_url: "https://example.invalid/alystria/acceptance-download-fixture-v1",
    license_sha256: "3333333333333333333333333333333333333333333333333333333333333333",
    license_scope: "Portable-debug acceptance fixture only. It contains four MiB of zero bytes and is never available in a production build.",
    download_only_reason: "Portable-debug acceptance fixture. It can fetch only the pinned four-MiB payload from an explicitly configured loopback HTTP endpoint and can never be activated.",
    artifacts: ACCEPTANCE_DOWNLOAD_FIXTURE_ARTIFACTS,
    managed_files: &[],
    strategy: InstallStrategy::Quarantine,
};

#[cfg(not(feature = "portable-debug-runtime"))]
const PACKAGES: &[PackageSpec] = &[MUSETALK, COMFYUI_RUNTIME, SDXL, FLUX_KLEIN, Z_IMAGE];
#[cfg(feature = "portable-debug-runtime")]
const PACKAGES: &[PackageSpec] = &[
    MUSETALK,
    COMFYUI_RUNTIME,
    SDXL,
    FLUX_KLEIN,
    Z_IMAGE,
    ACCEPTANCE_DOWNLOAD_FIXTURE,
];

#[derive(Debug)]
struct ActiveInstaller {
    child: Child,
    process_tree: KillOnCloseJob,
}

impl ActiveInstaller {
    fn terminate_and_wait(&mut self) -> bool {
        self.process_tree.terminate();
        let _ = self.child.kill();
        let deadline = std::time::Instant::now() + INSTALLER_SHUTDOWN_TIMEOUT;
        while std::time::Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = self.child.kill();
        false
    }
}

#[derive(Debug, Clone)]
pub struct ModelDownloadManager {
    root: PathBuf,
    comfy_root: PathBuf,
    installer_executable: Option<PathBuf>,
    statuses: Arc<RwLock<BTreeMap<String, ModelDownloadStatus>>>,
    active_installer: Arc<Mutex<Option<ActiveInstaller>>>,
    closed: Arc<AtomicBool>,
}

impl ModelDownloadManager {
    pub fn at(models_root: PathBuf) -> Result<Self, CommandError> {
        let root = models_root.join("download-quarantine");
        let comfy_root = models_root.join("comfyui-local");
        fs::create_dir_all(&root).map_err(|_| CommandError::io("model download cache setup"))?;
        let manager = Self {
            root,
            comfy_root,
            installer_executable: None,
            statuses: Arc::new(RwLock::new(BTreeMap::new())),
            active_installer: Arc::new(Mutex::new(None)),
            closed: Arc::new(AtomicBool::new(false)),
        };
        manager.load_statuses();
        manager.revalidate_loaded_ready_installs();
        Ok(manager)
    }

    /// Bind the verified packaged pipeline executable used to run the exact
    /// Python installer. The app state supplies the active runtime-pack worker;
    /// no executable is discovered from PATH.
    pub fn with_installer_executable(mut self, executable: Option<PathBuf>) -> Self {
        self.installer_executable = executable.filter(|path| path.is_absolute() && path.is_file());
        self
    }

    pub fn catalog(&self) -> Vec<ModelDownloadCatalogEntry> {
        PACKAGES
            .iter()
            .filter(|spec| catalog_package_visible(spec))
            .map(|spec| catalog_entry(spec, self.installer_executable.is_some()))
            .collect()
    }

    pub fn statuses(&self) -> Vec<ModelDownloadStatus> {
        let records = self.statuses.read();
        PACKAGES
            .iter()
            .map(|spec| {
                records
                    .get(spec.model_id)
                    .cloned()
                    .unwrap_or_else(|| manifest_status(spec))
            })
            .collect()
    }

    pub fn start(
        &self,
        input: ModelDownloadStartRequest,
    ) -> Result<ModelDownloadStatus, CommandError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(CommandError::unavailable(
                "The desktop is shutting down and cannot start another model download.",
            ));
        }
        let spec = package(&input.model_id)?;
        if is_managed_comfy(spec.strategy) && self.installer_is_running_or_uninspectable() {
            return Err(CommandError::conflict(
                "The previous managed local image installer is still stopping.",
            ));
        }
        if input.license_sha256 != spec.license_sha256 || !input.license_accepted {
            return Err(CommandError::new(
                "LICENSE_NOT_ACCEPTED",
                "Accept the displayed immutable license record before downloading this package.",
                false,
            ));
        }
        if self.statuses.read().values().any(|status| {
            active_download_phase(&status.phase)
                && (status.model_id == spec.model_id
                    || is_managed_comfy(spec.strategy)
                        && package(&status.model_id)
                            .is_ok_and(|active| is_managed_comfy(active.strategy)))
        }) {
            return Err(CommandError::conflict(
                "This managed package download is already running.",
            ));
        }
        if is_managed_comfy(spec.strategy) && self.installer_executable.is_none() {
            return Err(CommandError::unavailable(
                "The verified pipeline runtime required for local image installation",
            ));
        }
        let managed = is_managed_comfy(spec.strategy);
        let downloaded_bytes = if managed {
            managed_progress(&self.comfy_root, spec).downloaded_bytes
        } else {
            existing_bytes(&self.package_root(spec), spec)
        };
        let status = ModelDownloadStatus {
            model_id: spec.model_id.into(),
            immutable_revision: Some(spec.immutable_revision.into()),
            install_fingerprint: None,
            runtime_revision: None,
            phase: ModelDownloadPhase::Downloading,
            downloaded_bytes,
            total_bytes: total_bytes(spec),
            verified_artifacts: 0,
            artifact_count: artifact_count(spec),
            license_id: Some(spec.license_id.into()),
            license_url: Some(spec.license_url.into()),
            license_sha256: Some(spec.license_sha256.into()),
            license_accepted_at: Some(Utc::now()),
            detail: if managed {
                "Starting the pinned local image installer. Runtime and model files will be verified before use.".into()
            } else if downloaded_bytes > 0 {
                "Resuming hash-bound artifacts in the download-only quarantine.".into()
            } else {
                "Downloading hash-bound artifacts into the download-only quarantine.".into()
            },
            activation_blocked: true,
            updated_at: Utc::now(),
        };
        self.update(status.clone());
        let manager = self.clone();
        if std::thread::Builder::new()
            .name(format!("model-download-{}", safe_model_key(spec.model_id)))
            .spawn(move || manager.run(spec))
            .is_err()
        {
            let mut failed = status.clone();
            failed.phase = ModelDownloadPhase::Failed;
            failed.detail =
                "The model download worker could not start. Start again to retry.".into();
            failed.updated_at = Utc::now();
            self.update(failed);
            return Err(CommandError::io("model download worker start"));
        }
        Ok(status)
    }

    /// Permanently stop any managed installer before the desktop exits. The
    /// kill-on-close process job also covers abrupt parent-process termination;
    /// this explicit path waits for the installer root to exit before returning.
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        let mut active = self.active_installer.lock();
        let exited = active
            .as_mut()
            .is_none_or(ActiveInstaller::terminate_and_wait);
        if exited {
            active.take();
        }
    }

    fn installer_is_running_or_uninspectable(&self) -> bool {
        let mut active = self.active_installer.lock();
        let exited = active
            .as_mut()
            .is_some_and(|installer| matches!(installer.child.try_wait(), Ok(Some(_))));
        if exited {
            active.take();
        }
        active.is_some()
    }

    fn run(&self, spec: &'static PackageSpec) {
        let result = match spec.strategy {
            InstallStrategy::Quarantine => self.download(spec),
            InstallStrategy::ManagedComfyRuntime => self.install_comfy_runtime(spec),
            InstallStrategy::ManagedComfy { .. } => self.install_comfy(spec),
        };
        if let Err(error) = result {
            if matches!(spec.strategy, InstallStrategy::ManagedComfy { .. }) {
                // The shared runtime can complete before a later model file or
                // preflight fails. Publish its independent receipt so another
                // model does not pretend that the verified runtime is missing.
                self.publish_runtime_receipt_if_ready();
            }
            let mut status = self.current(spec);
            status.phase = ModelDownloadPhase::Failed;
            status.install_fingerprint = None;
            status.runtime_revision = None;
            status.activation_blocked = true;
            status.detail = error.message;
            status.updated_at = Utc::now();
            self.update(status);
        }
    }

    fn install_comfy(&self, spec: &'static PackageSpec) -> Result<(), CommandError> {
        validate_spec(spec)?;
        self.download_managed_files(spec)?;
        self.record_managed_progress(spec);
        let result = self.run_comfy_installer(spec, "install", Some(spec.model_id))?;
        validate_comfy_result(spec, &self.comfy_root, &result)?;
        self.publish_runtime_receipt_if_ready();

        let InstallStrategy::ManagedComfy { executable, .. } = spec.strategy else {
            unreachable!("managed install strategy was checked above")
        };
        let validated_identity = if executable {
            Some(validated_managed_identity(spec, &self.comfy_root, true)?)
        } else {
            validate_managed_runtime(&self.comfy_root)?;
            None
        };
        let mut ready = self.current(spec);
        ready.phase = if executable {
            ModelDownloadPhase::Ready
        } else {
            ModelDownloadPhase::DownloadedQuarantined
        };
        ready.downloaded_bytes = ready.total_bytes;
        ready.verified_artifacts = ready.artifact_count;
        ready.activation_blocked = !executable;
        ready.runtime_revision = validated_identity.as_ref().map(|value| value.0.clone());
        ready.install_fingerprint = validated_identity.map(|value| value.1);
        ready.detail = if executable {
            "The pinned ComfyUI archive and SDXL model files passed their exact hash checks, and the extracted runtime entry points are present. The reviewed recipe is ready for local generation.".into()
        } else {
            "Every pinned runtime and model file passed verification. This candidate remains unavailable for generation because no hardware-reviewed recipe is installed.".into()
        };
        ready.updated_at = Utc::now();
        self.update(ready);
        Ok(())
    }

    fn install_comfy_runtime(&self, spec: &'static PackageSpec) -> Result<(), CommandError> {
        validate_spec(spec)?;
        self.download_managed_files(spec)?;
        self.record_managed_progress(spec);
        let result = self.run_comfy_installer(spec, "install-runtime", None)?;
        validate_comfy_runtime_result(&self.comfy_root, &result)?;
        let (runtime_revision, install_fingerprint) = validated_runtime_identity(&self.comfy_root)?;
        self.commit_runtime_ready(runtime_revision, install_fingerprint);
        Ok(())
    }

    fn run_comfy_installer(
        &self,
        spec: &'static PackageSpec,
        operation: &str,
        model_id: Option<&str>,
    ) -> Result<serde_json::Value, CommandError> {
        let executable = self.installer_executable.as_ref().ok_or_else(|| {
            CommandError::unavailable(
                "The verified pipeline runtime required for local image installation",
            )
        })?;
        let runtime_root = self
            .comfy_root
            .to_str()
            .ok_or_else(|| CommandError::invalid("models root", "is not valid Unicode"))?;
        let mut command = hidden_command(executable);
        command.args(["local-image", operation, "--runtime-root", runtime_root]);
        if let Some(model_id) = model_id {
            command.args(["--model-id", model_id]);
        }
        let (stdout, stderr) = {
            let mut active = self.active_installer.lock();
            if self.closed.load(Ordering::Acquire) {
                return Err(download_error(
                    "The desktop shut down before the managed local image installer started.",
                ));
            }
            if active.is_some() {
                return Err(CommandError::conflict(
                    "Another managed local image installer is still stopping.",
                ));
            }
            let mut child = command
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|_| {
                    download_error("The managed local image installer could not start.")
                })?;
            let process_tree = match KillOnCloseJob::attach_suspended(&child) {
                Ok(process_tree) => process_tree,
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(download_error(
                        "The managed local image installer could not be isolated for safe shutdown.",
                    ));
                }
            };
            let Some(stdout) = child.stdout.take() else {
                drop(process_tree);
                let _ = child.kill();
                let _ = child.wait();
                return Err(download_error(
                    "The managed local image installer output was unavailable.",
                ));
            };
            let Some(stderr) = child.stderr.take() else {
                drop(process_tree);
                let _ = child.kill();
                let _ = child.wait();
                return Err(download_error(
                    "The managed local image installer diagnostics were unavailable.",
                ));
            };
            *active = Some(ActiveInstaller {
                child,
                process_tree,
            });
            (stdout, stderr)
        };
        let stdout_reader = capture_installer_output(stdout);
        let stderr_reader = capture_installer_output(stderr);
        let exit_status = loop {
            let observed = {
                let mut active = self.active_installer.lock();
                match active.as_mut() {
                    Some(installer) => installer.child.try_wait(),
                    None => {
                        return Err(download_error(
                            "The managed local image installer stopped during desktop shutdown.",
                        ));
                    }
                }
            };
            match observed {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    self.record_managed_progress(spec);
                    std::thread::sleep(MANAGED_PROGRESS_POLL_INTERVAL);
                }
                Err(_) => {
                    let mut active = self.active_installer.lock();
                    let exited = active
                        .as_mut()
                        .is_none_or(ActiveInstaller::terminate_and_wait);
                    if exited {
                        active.take();
                    }
                    return Err(download_error(
                        "The managed local image installer could not be monitored.",
                    ));
                }
            }
        };
        // Closing the process job after the root exits also removes any helper
        // process that unexpectedly survived it and releases inherited pipes.
        drop(self.active_installer.lock().take());
        self.record_managed_progress(spec);
        let stdout = finish_installer_output(stdout_reader)?;
        let stderr = finish_installer_output(stderr_reader)?;
        if !exit_status.success() {
            return Err(download_error(
                "The managed local image installer rejected the runtime or model bundle. Start again to retry verified files.",
            ));
        }
        if stdout.exceeded_limit || stderr.exceeded_limit {
            return Err(download_error(
                "The managed local image installer returned too much output.",
            ));
        }
        serde_json::from_slice(&stdout.bytes).map_err(|_| {
            download_error("The managed local image installer returned an invalid result.")
        })
    }

    fn publish_runtime_receipt_if_ready(&self) {
        if let Ok((runtime_revision, install_fingerprint)) =
            validated_runtime_identity(&self.comfy_root)
        {
            self.commit_runtime_ready(runtime_revision, install_fingerprint);
        }
    }

    fn commit_runtime_ready(&self, runtime_revision: String, install_fingerprint: String) {
        let mut ready = self.current(&COMFYUI_RUNTIME);
        ready.phase = ModelDownloadPhase::Ready;
        ready.downloaded_bytes = ready.total_bytes;
        ready.verified_artifacts = ready.artifact_count;
        ready.activation_blocked = false;
        ready.runtime_revision = Some(runtime_revision);
        ready.install_fingerprint = Some(install_fingerprint);
        ready.detail = "The pinned ComfyUI archive passed its exact size and SHA-256 check, and the extracted Python and ComfyUI entry points are ready for compatible local image packs.".into();
        ready.updated_at = Utc::now();
        self.update(ready);
    }

    fn download_managed_files(&self, spec: &PackageSpec) -> Result<(), CommandError> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|_| download_error("The secure model download client could not start."))?;
        let comfy_root = managed_comfy_root(&self.comfy_root);
        let files = std::iter::once((&COMFYUI_RUNTIME_FILE, self.comfy_root.clone())).chain(
            spec.managed_files
                .iter()
                .map(|file| (file, comfy_root.clone())),
        );
        for (index, (file, root)) in files.enumerate() {
            let relative = safe_relative(file.relative_path)?;
            let final_path = root.join(&relative);
            let artifact = ArtifactSpec {
                relative_path: file.relative_path,
                repository: "managed-installer",
                revision: spec.immutable_revision,
                upstream_path: file.relative_path,
                size_bytes: file.size_bytes,
                sha256: file.sha256,
            };
            if verify_file(&final_path, &artifact).is_ok() {
                self.record_managed_progress(spec);
                continue;
            }
            if final_path.exists() {
                fs::remove_file(&final_path)
                    .map_err(|_| CommandError::io("invalid managed model artifact cleanup"))?;
            }
            if let Some(parent) = final_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| CommandError::io("managed model artifact directory creation"))?;
            }
            let part = partial_path(&final_path);
            fetch_artifact_from_url(&client, spec, &artifact, &part, file.source_url, |_| {
                self.record_managed_progress(spec)
            })?;
            let mut status = self.current(spec);
            status.phase = ModelDownloadPhase::Verifying;
            status.downloaded_bytes = managed_progress(&self.comfy_root, spec).downloaded_bytes;
            status.detail = format!(
                "Verifying SHA-256 for managed artifact {} of {}.",
                index + 1,
                spec.managed_files.len() + 1
            );
            status.updated_at = Utc::now();
            self.update(status);
            if let Err(error) = verify_file(&part, &artifact) {
                let _ = fs::remove_file(&part);
                return Err(error);
            }
            fs::rename(&part, &final_path)
                .map_err(|_| CommandError::io("verified managed model artifact promotion"))?;
            self.record_managed_progress(spec);
        }
        Ok(())
    }

    fn download(&self, spec: &'static PackageSpec) -> Result<(), CommandError> {
        validate_spec(spec)?;
        let redirect_policy = if is_acceptance_fixture(spec) {
            reqwest::redirect::Policy::none()
        } else {
            reqwest::redirect::Policy::limited(5)
        };
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .redirect(redirect_policy)
            .build()
            .map_err(|_| download_error("The secure model download client could not start."))?;
        let package_root = self.package_root(spec);
        fs::create_dir_all(package_root.join("files"))
            .map_err(|_| CommandError::io("model staging directory creation"))?;
        let mut verified = 0usize;
        for (index, artifact) in spec.artifacts.iter().enumerate() {
            let relative = safe_relative(artifact.relative_path)?;
            let final_path = package_root.join("files").join(&relative);
            if verify_file(&final_path, artifact).is_ok() {
                verified += 1;
                self.record_progress(
                    spec,
                    verified,
                    format!(
                        "Verified artifact {} of {}.",
                        index + 1,
                        spec.artifacts.len()
                    ),
                    ModelDownloadPhase::Downloading,
                );
                continue;
            }
            if final_path.exists() {
                fs::remove_file(&final_path)
                    .map_err(|_| CommandError::io("invalid model artifact cleanup"))?;
            }
            if let Some(parent) = final_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| CommandError::io("model artifact directory creation"))?;
            }
            let part = final_path.with_extension(format!(
                "{}part",
                final_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| format!("{value}."))
                    .unwrap_or_default()
            ));
            fetch_artifact(&client, spec, artifact, &part, |message| {
                self.record_progress(spec, verified, message, ModelDownloadPhase::Downloading)
            })?;
            self.record_progress(
                spec,
                verified,
                format!(
                    "Verifying SHA-256 for artifact {} of {}.",
                    index + 1,
                    spec.artifacts.len()
                ),
                ModelDownloadPhase::Verifying,
            );
            if let Err(error) = verify_file(&part, artifact) {
                let _ = fs::remove_file(&part);
                return Err(error);
            }
            fs::rename(&part, &final_path)
                .map_err(|_| CommandError::io("verified model artifact promotion"))?;
            verified += 1;
        }
        let mut status = self.current(spec);
        status.phase = ModelDownloadPhase::DownloadedQuarantined;
        status.downloaded_bytes = status.total_bytes;
        status.verified_artifacts = spec.artifacts.len();
        status.detail = "Every artifact passed its exact byte count and SHA-256 check. The pack remains download-only and cannot be used for inference.".into();
        status.updated_at = Utc::now();
        self.update(status);
        Ok(())
    }

    fn record_progress(
        &self,
        spec: &PackageSpec,
        verified: usize,
        detail: String,
        phase: ModelDownloadPhase,
    ) {
        let mut status = self.current(spec);
        status.phase = phase;
        status.downloaded_bytes = existing_bytes(&self.package_root(spec), spec);
        status.verified_artifacts = verified;
        status.detail = detail;
        status.updated_at = Utc::now();
        self.update(status);
    }

    fn record_managed_progress(&self, spec: &PackageSpec) {
        let progress = managed_progress(&self.comfy_root, spec);
        let mut status = self.current(spec);
        if status.downloaded_bytes == progress.downloaded_bytes
            && status.phase == progress.phase
            && status.detail == progress.detail
        {
            return;
        }
        status.phase = progress.phase;
        status.downloaded_bytes = progress.downloaded_bytes;
        status.detail = progress.detail;
        status.updated_at = Utc::now();
        self.update(status);
    }

    fn package_root(&self, spec: &PackageSpec) -> PathBuf {
        self.root
            .join(safe_model_key(spec.model_id))
            .join(spec.immutable_revision)
    }
    fn current(&self, spec: &PackageSpec) -> ModelDownloadStatus {
        self.statuses
            .read()
            .get(spec.model_id)
            .cloned()
            .unwrap_or_else(|| manifest_status(spec))
    }
    fn update(&self, status: ModelDownloadStatus) {
        let path = self
            .package_root(package(status.model_id.as_str()).expect("status model is catalog-owned"))
            .join(STATUS_FILE);
        self.statuses
            .write()
            .insert(status.model_id.clone(), status.clone());
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(&status) {
            let _ = atomic_write(&path, &bytes);
        }
    }
    fn update_memory(&self, status: ModelDownloadStatus) {
        self.statuses
            .write()
            .insert(status.model_id.clone(), status);
    }
    fn load_statuses(&self) {
        for spec in PACKAGES {
            let path = self.package_root(spec).join(STATUS_FILE);
            let Ok(bytes) = fs::read(path) else { continue };
            let Ok(mut status) = serde_json::from_slice::<ModelDownloadStatus>(&bytes) else {
                continue;
            };
            if status.model_id != spec.model_id
                || status.immutable_revision.as_deref() != Some(spec.immutable_revision)
            {
                continue;
            }
            if matches!(
                status.phase,
                ModelDownloadPhase::Downloading
                    | ModelDownloadPhase::Verifying
                    | ModelDownloadPhase::Installing
            ) {
                status.phase = ModelDownloadPhase::Failed;
                status.detail = if is_managed_comfy(spec.strategy) {
                    "The previous app session ended during installation. Start again to verify existing files and finish setup.".into()
                } else {
                    "The previous app session ended during download. Start again to resume the existing .part files.".into()
                };
                status.updated_at = Utc::now();
            } else if status.phase == ModelDownloadPhase::DownloadedQuarantined
                && spec.artifacts.iter().any(|artifact| {
                    safe_relative(artifact.relative_path).is_err()
                        || verify_file(
                            &self
                                .package_root(spec)
                                .join("files")
                                .join(artifact.relative_path),
                            artifact,
                        )
                        .is_err()
                })
            {
                status.phase = ModelDownloadPhase::Failed;
                status.detail = "A previously verified quarantine artifact is now missing or changed. Start again to repair it before any activation review.".into();
                status.updated_at = Utc::now();
            }
            self.statuses.write().insert(spec.model_id.into(), status);
        }
    }

    fn revalidate_loaded_ready_installs(&self) {
        // Migrate older installs that predate the standalone runtime catalog
        // row. This validates the shared archive and extracted entry points;
        // it does not infer runtime readiness from an SDXL receipt.
        if self.current(&COMFYUI_RUNTIME).phase != ModelDownloadPhase::Ready {
            let manager = self.clone();
            let _ = std::thread::Builder::new()
                .name("model-revalidate-comfyui-runtime".into())
                .spawn(move || manager.publish_runtime_receipt_if_ready());
        }
        for spec in PACKAGES {
            if !matches!(
                spec.strategy,
                InstallStrategy::ManagedComfyRuntime
                    | InstallStrategy::ManagedComfy {
                        executable: true,
                        ..
                    }
            ) {
                continue;
            }
            let Some(saved) = self.statuses.read().get(spec.model_id).cloned() else {
                continue;
            };
            if saved.phase != ModelDownloadPhase::Ready {
                continue;
            }
            let expected_identity = self.prepare_ready_revalidation(saved);

            let manager = self.clone();
            let started = std::thread::Builder::new()
                .name(format!(
                    "model-revalidate-{}",
                    safe_model_key(spec.model_id)
                ))
                .spawn(move || manager.finish_loaded_ready_revalidation(spec, expected_identity));
            if started.is_err() {
                let mut failed = self.current(spec);
                failed.phase = ModelDownloadPhase::Failed;
                failed.detail = "The installed local image bundle could not be rechecked. Start the verified installation again.".into();
                failed.updated_at = Utc::now();
                self.update(failed);
            }
        }
    }

    fn prepare_ready_revalidation(
        &self,
        mut saved: ModelDownloadStatus,
    ) -> (Option<String>, Option<String>) {
        let expected_identity = (
            saved.runtime_revision.take(),
            saved.install_fingerprint.take(),
        );
        saved.phase = ModelDownloadPhase::Verifying;
        saved.activation_blocked = true;
        saved.detail = "Rechecking the pinned archive and model-file hashes, plus extracted runtime entrypoint presence.".into();
        saved.updated_at = Utc::now();
        // Leave Ready on disk so an exit during this read-only check is resumable.
        self.update_memory(saved);
        expected_identity
    }

    fn finish_loaded_ready_revalidation(
        &self,
        spec: &'static PackageSpec,
        expected_identity: (Option<String>, Option<String>),
    ) {
        let result = match spec.strategy {
            InstallStrategy::ManagedComfyRuntime => validated_runtime_identity(&self.comfy_root),
            InstallStrategy::ManagedComfy {
                executable: true, ..
            } => validated_managed_identity(spec, &self.comfy_root, true),
            _ => return,
        };
        let mut status = self.current(spec);
        match result {
            Ok((runtime_revision, install_fingerprint))
                if expected_identity
                    .0
                    .as_deref()
                    .is_none_or(|value| value == runtime_revision)
                    && expected_identity
                        .1
                        .as_deref()
                        .is_none_or(|value| value == install_fingerprint) =>
            {
                status.phase = ModelDownloadPhase::Ready;
                status.runtime_revision = Some(runtime_revision);
                status.install_fingerprint = Some(install_fingerprint);
                status.activation_blocked = false;
                status.downloaded_bytes = status.total_bytes;
                status.verified_artifacts = status.artifact_count;
                status.detail = if matches!(spec.strategy, InstallStrategy::ManagedComfyRuntime) {
                    "The pinned ComfyUI archive passed its exact size and SHA-256 check, and the extracted runtime entry points are ready for compatible local image packs.".into()
                } else {
                    "The pinned ComfyUI archive and SDXL model files passed their exact hash checks, and the extracted runtime entry points are present. The reviewed recipe is ready for local generation.".into()
                };
            }
            _ => {
                status.phase = ModelDownloadPhase::Failed;
                status.runtime_revision = None;
                status.install_fingerprint = None;
                status.activation_blocked = true;
                status.detail = if matches!(spec.strategy, InstallStrategy::ManagedComfyRuntime) {
                    "The installed ComfyUI runtime no longer matches its verified archive and entry-point receipt. Start the verified installation again.".into()
                } else {
                    "The installed local image bundle no longer matches its verified archive and model-file receipt. Start the verified installation again.".into()
                };
            }
        }
        status.updated_at = Utc::now();
        self.update(status);
    }
}

fn artifact_url(
    package_spec: &PackageSpec,
    artifact: &ArtifactSpec,
) -> Result<String, CommandError> {
    #[cfg(not(feature = "portable-debug-runtime"))]
    let _ = package_spec;
    #[cfg(feature = "portable-debug-runtime")]
    if package_spec.model_id == ACCEPTANCE_DOWNLOAD_FIXTURE.model_id {
        return Ok(acceptance_download_url()?.into());
    }
    Ok(format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        artifact.repository, artifact.revision, artifact.upstream_path
    ))
}

fn catalog_package_visible(spec: &PackageSpec) -> bool {
    #[cfg(feature = "portable-debug-runtime")]
    {
        !is_acceptance_fixture(spec) || acceptance_download_url().is_ok()
    }
    #[cfg(not(feature = "portable-debug-runtime"))]
    {
        let _ = spec;
        true
    }
}

#[cfg(feature = "portable-debug-runtime")]
fn acceptance_download_url() -> Result<reqwest::Url, CommandError> {
    let raw = std::env::var(ACCEPTANCE_DOWNLOAD_URL_ENV).map_err(|_| {
        download_error("The portable-debug acceptance download fixture has no loopback endpoint.")
    })?;
    let parsed = reqwest::Url::parse(&raw)
        .map_err(|_| download_error("The acceptance download fixture endpoint is invalid."))?;
    let loopback = parsed
        .host_str()
        .and_then(|host| host.parse::<std::net::IpAddr>().ok())
        .is_some_and(|address| address.is_loopback());
    if parsed.scheme() != "http"
        || !loopback
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/alystria-model-download-fixture.bin"
    {
        return Err(download_error(
            "The acceptance download fixture accepts only its exact loopback HTTP path.",
        ));
    }
    Ok(parsed)
}

fn fetch_artifact(
    client: &Client,
    package_spec: &PackageSpec,
    artifact: &ArtifactSpec,
    part: &Path,
    progress: impl FnMut(String),
) -> Result<(), CommandError> {
    let url = artifact_url(package_spec, artifact)?;
    fetch_artifact_from_url(client, package_spec, artifact, part, &url, progress)
}

fn fetch_artifact_from_url(
    client: &Client,
    package_spec: &PackageSpec,
    artifact: &ArtifactSpec,
    part: &Path,
    url: &str,
    mut progress: impl FnMut(String),
) -> Result<(), CommandError> {
    let mut offset = part.metadata().map(|value| value.len()).unwrap_or(0);
    if offset > artifact.size_bytes {
        fs::remove_file(part).map_err(|_| CommandError::io("oversized model partial cleanup"))?;
        offset = 0;
    }
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(RANGE, format!("bytes={offset}-"));
    }
    let mut response = request
        .send()
        .map_err(|_| download_error("The immutable model artifact could not be reached."))?;
    if offset > 0 && response.status() == reqwest::StatusCode::OK {
        fs::remove_file(part).map_err(|_| CommandError::io("model partial restart"))?;
        offset = 0;
        response = client.get(url).send().map_err(|_| {
            download_error("The model source did not support resume and the clean retry failed.")
        })?;
    }
    validate_response(&response, artifact, offset)?;
    let mut output = OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(part)
        .map_err(|_| CommandError::io("model partial write"))?;
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut written = offset;
    loop {
        let count = response.read(&mut buffer).map_err(|_| {
            download_error(
                "The model download was interrupted; the partial file was kept for resume.",
            )
        })?;
        if count == 0 {
            break;
        }
        written = written.saturating_add(count as u64);
        if written > artifact.size_bytes {
            return Err(download_error(
                "The model source exceeded its declared immutable byte count.",
            ));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| CommandError::io("model partial write"))?;
        progress(format!(
            "Downloading {} · {} of {} total.",
            artifact.relative_path,
            human_bytes(existing_bytes_for_progress(package_spec, artifact, written)),
            human_bytes(total_bytes(package_spec))
        ));
    }
    output
        .flush()
        .and_then(|_| output.sync_all())
        .map_err(|_| CommandError::io("model partial flush"))?;
    if written != artifact.size_bytes {
        return Err(download_error(
            "The model artifact ended before its declared immutable byte count.",
        ));
    }
    Ok(())
}

fn validate_response(
    response: &Response,
    artifact: &ArtifactSpec,
    offset: u64,
) -> Result<(), CommandError> {
    if offset > 0 {
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(download_error(
                "The model source did not honor the exact resume range.",
            ));
        }
        let prefix = format!("bytes {offset}-");
        if !response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value.starts_with(&prefix) && value.ends_with(&format!("/{}", artifact.size_bytes))
            })
        {
            return Err(download_error(
                "The model source returned a different immutable range or total size.",
            ));
        }
    } else if response.status() != reqwest::StatusCode::OK {
        return Err(download_error(
            "The model source returned an unexpected HTTP status.",
        ));
    }
    Ok(())
}

fn verify_file(path: &Path, spec: &ArtifactSpec) -> Result<(), CommandError> {
    let metadata =
        fs::metadata(path).map_err(|_| download_error("A staged model artifact is missing."))?;
    if metadata.len() != spec.size_bytes {
        return Err(download_error(
            "A staged model artifact has the wrong byte count.",
        ));
    }
    let mut file =
        File::open(path).map_err(|_| CommandError::io("model artifact verification read"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| CommandError::io("model artifact verification read"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != spec.sha256 {
        return Err(download_error(
            "A staged model artifact failed its exact SHA-256 check and was not promoted.",
        ));
    }
    Ok(())
}

fn validate_spec(spec: &PackageSpec) -> Result<(), CommandError> {
    if !spec.license_url.starts_with("https://")
        || !is_sha256(spec.license_sha256)
        || !is_git_revision(spec.code_revision)
        || match spec.strategy {
            InstallStrategy::ManagedComfyRuntime => spec.weight_revision != "runtime-only",
            _ => !is_git_revision(spec.weight_revision),
        }
        || spec.license_scope.trim().is_empty()
    {
        return Err(download_error(
            "The curated model declaration is incomplete.",
        ));
    }
    match spec.strategy {
        InstallStrategy::Quarantine if spec.artifacts.is_empty() => {
            return Err(download_error(
                "The curated quarantine declaration has no artifacts.",
            ));
        }
        InstallStrategy::ManagedComfyRuntime
            if !spec.artifacts.is_empty() || !spec.managed_files.is_empty() =>
        {
            return Err(download_error(
                "The standalone ComfyUI runtime declaration must not contain model artifacts.",
            ));
        }
        InstallStrategy::ManagedComfy {
            bundle_bytes,
            artifact_count,
            ..
        } if !spec.artifacts.is_empty()
            || bundle_bytes == 0
            || artifact_count != spec.managed_files.len() + 1
            || spec
                .managed_files
                .iter()
                .map(|file| file.size_bytes)
                .sum::<u64>()
                != bundle_bytes =>
        {
            return Err(download_error(
                "The managed local image declaration is invalid.",
            ));
        }
        _ => {}
    }
    for artifact in spec.artifacts {
        safe_relative(artifact.relative_path)?;
        let source_url = artifact_url(spec, artifact)?;
        if artifact.size_bytes == 0
            || artifact.size_bytes > MAX_ARTIFACT_BYTES
            || !is_sha256(artifact.sha256)
            || (!source_url.starts_with("https://huggingface.co/") && !is_acceptance_fixture(spec))
        {
            return Err(download_error(
                "The curated model artifact declaration is invalid.",
            ));
        }
    }
    for file in spec.managed_files {
        safe_relative(file.relative_path)?;
        let source = reqwest::Url::parse(file.source_url)
            .map_err(|_| download_error("A managed model source URL is invalid."))?;
        if file.size_bytes == 0
            || file.size_bytes > MAX_ARTIFACT_BYTES
            || !is_sha256(file.sha256)
            || source.scheme() != "https"
            || source.username() != ""
            || source.password().is_some()
            || !matches!(source.host_str(), Some("huggingface.co"))
        {
            return Err(download_error(
                "The managed local image declaration has an invalid artifact source.",
            ));
        }
    }
    Ok(())
}

fn is_acceptance_fixture(spec: &PackageSpec) -> bool {
    #[cfg(feature = "portable-debug-runtime")]
    {
        spec.model_id == ACCEPTANCE_DOWNLOAD_FIXTURE.model_id
    }
    #[cfg(not(feature = "portable-debug-runtime"))]
    {
        let _ = spec;
        false
    }
}

fn is_git_revision(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn catalog_entry(spec: &PackageSpec, installer_available: bool) -> ModelDownloadCatalogEntry {
    ModelDownloadCatalogEntry {
        model_id: spec.model_id.into(),
        display_name: spec.display_name.into(),
        immutable_revision: spec.immutable_revision.into(),
        total_bytes: total_bytes(spec),
        artifact_count: artifact_count(spec),
        license_id: spec.license_id.into(),
        license_url: spec.license_url.into(),
        license_sha256: spec.license_sha256.into(),
        license_scope: spec.license_scope.into(),
        code_revision: spec.code_revision.into(),
        weight_revision: spec.weight_revision.into(),
        available: matches!(spec.strategy, InstallStrategy::Quarantine) || installer_available,
        download_only_reason: spec.download_only_reason.into(),
    }
}
fn manifest_status(spec: &PackageSpec) -> ModelDownloadStatus {
    ModelDownloadStatus { model_id: spec.model_id.into(), immutable_revision: Some(spec.immutable_revision.into()), install_fingerprint: None, runtime_revision: None, phase: ModelDownloadPhase::ManifestRequired, downloaded_bytes: existing_bytes_placeholder(), total_bytes: total_bytes(spec), verified_artifacts: 0, artifact_count: artifact_count(spec), license_id: Some(spec.license_id.into()), license_url: Some(spec.license_url.into()), license_sha256: Some(spec.license_sha256.into()), license_accepted_at: None, detail: "A pinned immutable declaration is available. Review and accept its exact license record to begin.".into(), activation_blocked: true, updated_at: Utc::now() }
}
const fn existing_bytes_placeholder() -> u64 {
    0
}
fn package(model_id: &str) -> Result<&'static PackageSpec, CommandError> {
    PACKAGES
        .iter()
        .find(|value| value.model_id == model_id)
        .ok_or_else(|| {
            CommandError::invalid("modelId", "has no curated immutable download declaration")
        })
}
fn total_bytes(spec: &PackageSpec) -> u64 {
    match spec.strategy {
        InstallStrategy::Quarantine => spec.artifacts.iter().map(|value| value.size_bytes).sum(),
        InstallStrategy::ManagedComfyRuntime => COMFYUI_RUNTIME_BYTES,
        InstallStrategy::ManagedComfy { bundle_bytes, .. } => {
            COMFYUI_RUNTIME_BYTES.saturating_add(bundle_bytes)
        }
    }
}
fn artifact_count(spec: &PackageSpec) -> usize {
    match spec.strategy {
        InstallStrategy::Quarantine => spec.artifacts.len(),
        InstallStrategy::ManagedComfyRuntime => 1,
        InstallStrategy::ManagedComfy { artifact_count, .. } => artifact_count,
    }
}

fn is_managed_comfy(strategy: InstallStrategy) -> bool {
    matches!(
        strategy,
        InstallStrategy::ManagedComfyRuntime | InstallStrategy::ManagedComfy { .. }
    )
}

#[derive(Debug, PartialEq, Eq)]
struct ManagedProgress {
    downloaded_bytes: u64,
    phase: ModelDownloadPhase,
    detail: String,
}

fn managed_progress(runtime_root: &Path, spec: &PackageSpec) -> ManagedProgress {
    let total = total_bytes(spec);
    let archive = runtime_root.join(COMFYUI_RUNTIME_ARCHIVE);
    let archive_part = partial_path(&archive);
    let manual_comfy = runtime_root.join("ComfyUI");
    let portable_root = runtime_root.join("ComfyUI_windows_portable");
    let portable_comfy = portable_root.join("ComfyUI");
    let manual_runtime_ready = manual_comfy.join("main.py").is_file()
        && runtime_root.join("venv/Scripts/python.exe").is_file();
    let portable_runtime_ready = portable_comfy.join("main.py").is_file()
        && portable_root.join("python_embeded/python.exe").is_file();
    let runtime_ready = manual_runtime_ready || portable_runtime_ready;
    let comfy_root = managed_comfy_root(runtime_root);

    let archive_final_bytes = file_bytes_capped(&archive, COMFYUI_RUNTIME_BYTES);
    let archive_part_bytes = file_bytes_capped(&archive_part, COMFYUI_RUNTIME_BYTES);
    let runtime_bytes = if archive_final_bytes == COMFYUI_RUNTIME_BYTES {
        COMFYUI_RUNTIME_BYTES
    } else {
        archive_part_bytes
    };
    let mut downloaded_bytes = runtime_bytes;
    let mut active_file = (archive_part_bytes > 0 && archive_part_bytes < COMFYUI_RUNTIME_BYTES)
        .then_some(COMFYUI_RUNTIME_ARCHIVE);

    for file in spec.managed_files {
        let path = comfy_root.join(file.relative_path);
        let part = partial_path(&path);
        let final_bytes = file_bytes_capped(&path, file.size_bytes);
        let part_bytes = file_bytes_capped(&part, file.size_bytes);
        downloaded_bytes = downloaded_bytes.saturating_add(if final_bytes == file.size_bytes {
            file.size_bytes
        } else {
            part_bytes
        });
        if active_file.is_none() && part_bytes > 0 && part_bytes < file.size_bytes {
            active_file = Path::new(file.relative_path)
                .file_name()
                .and_then(|value| value.to_str());
        }
    }
    downloaded_bytes = downloaded_bytes.min(total);

    let (phase, detail) = if let Some(name) = active_file {
        (
            ModelDownloadPhase::Downloading,
            format!(
                "Downloading {name} · {} of {}.",
                human_bytes(downloaded_bytes),
                human_bytes(total)
            ),
        )
    } else if runtime_bytes == COMFYUI_RUNTIME_BYTES && !runtime_ready {
        (
            ModelDownloadPhase::Installing,
            "Extracting the pinned ComfyUI runtime. No GPU is used during installation.".into(),
        )
    } else if downloaded_bytes >= total {
        (
            ModelDownloadPhase::Verifying,
            if matches!(spec.strategy, InstallStrategy::ManagedComfyRuntime) {
                "Verifying the pinned ComfyUI runtime before it can be used.".into()
            } else {
                "Verifying the pinned runtime and model files before they can be used.".into()
            },
        )
    } else if runtime_ready && downloaded_bytes > COMFYUI_RUNTIME_BYTES {
        (
            ModelDownloadPhase::Installing,
            "Checking the completed pinned model files before the next download.".into(),
        )
    } else {
        (
            ModelDownloadPhase::Downloading,
            format!(
                "Connecting to the pinned source · {} of {} already present.",
                human_bytes(downloaded_bytes),
                human_bytes(total)
            ),
        )
    };
    ManagedProgress {
        downloaded_bytes,
        phase,
        detail,
    }
}

fn managed_comfy_root(runtime_root: &Path) -> PathBuf {
    resolved_managed_runtime_layout(runtime_root)
        .map(|layout| layout.comfy_root)
        .unwrap_or_else(|| portable_runtime_layout(runtime_root).comfy_root)
}

#[derive(Debug)]
struct ManagedRuntimeLayout {
    comfy_root: PathBuf,
    python_executable: PathBuf,
}

fn manual_runtime_layout(runtime_root: &Path) -> ManagedRuntimeLayout {
    ManagedRuntimeLayout {
        comfy_root: runtime_root.join("ComfyUI"),
        python_executable: runtime_root.join("venv").join("Scripts").join("python.exe"),
    }
}

fn portable_runtime_layout(runtime_root: &Path) -> ManagedRuntimeLayout {
    let root = runtime_root.join("ComfyUI_windows_portable");
    ManagedRuntimeLayout {
        comfy_root: root.join("ComfyUI"),
        python_executable: root.join("python_embeded").join("python.exe"),
    }
}

fn resolved_managed_runtime_layout(runtime_root: &Path) -> Option<ManagedRuntimeLayout> {
    let manual = manual_runtime_layout(runtime_root);
    if manual.comfy_root.join("main.py").is_file() && manual.python_executable.is_file() {
        return Some(manual);
    }
    let portable = portable_runtime_layout(runtime_root);
    if portable.comfy_root.join("main.py").is_file() && portable.python_executable.is_file() {
        return Some(portable);
    }
    None
}

fn existing_bytes(root: &Path, spec: &PackageSpec) -> u64 {
    spec.artifacts
        .iter()
        .map(|artifact| {
            let relative = safe_relative(artifact.relative_path).unwrap_or_default();
            let final_path = root.join("files").join(&relative);
            if final_path.is_file() {
                artifact.size_bytes
            } else {
                file_bytes_capped(&partial_path(&final_path), artifact.size_bytes)
            }
        })
        .sum()
}

fn partial_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}part",
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| format!("{value}."))
            .unwrap_or_default()
    ))
}

fn file_bytes_capped(path: &Path, expected: u64) -> u64 {
    path.metadata()
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len().min(expected))
        .unwrap_or(0)
}
fn existing_bytes_for_progress(
    spec: &PackageSpec,
    current: &ArtifactSpec,
    current_written: u64,
) -> u64 {
    let mut total = 0;
    for artifact in spec.artifacts {
        if std::ptr::eq(artifact, current) {
            total += current_written;
            break;
        }
        total += artifact.size_bytes;
    }
    total
}
fn safe_model_key(model_id: &str) -> String {
    model_id.replace('/', "--")
}
fn safe_relative(value: &str) -> Result<PathBuf, CommandError> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(download_error(
            "A model artifact path escaped the download quarantine.",
        ));
    }
    Ok(path.to_path_buf())
}
fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn active_download_phase(phase: &ModelDownloadPhase) -> bool {
    matches!(
        phase,
        ModelDownloadPhase::Downloading
            | ModelDownloadPhase::Verifying
            | ModelDownloadPhase::Installing
    )
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED_PROCESS);
    command
}

struct CapturedInstallerOutput {
    bytes: Vec<u8>,
    exceeded_limit: bool,
    read_failed: bool,
}

fn capture_installer_output<R>(mut stream: R) -> JoinHandle<CapturedInstallerOutput>
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut exceeded_limit = false;
        let mut read_failed = false;
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let remaining = MAX_INSTALLER_OUTPUT_BYTES.saturating_add(1) - bytes.len();
                    bytes.extend_from_slice(&buffer[..count.min(remaining)]);
                    exceeded_limit |= count > remaining || bytes.len() > MAX_INSTALLER_OUTPUT_BYTES;
                }
                Err(_) => {
                    read_failed = true;
                    break;
                }
            }
        }
        CapturedInstallerOutput {
            bytes,
            exceeded_limit,
            read_failed,
        }
    })
}

fn finish_installer_output(
    reader: JoinHandle<CapturedInstallerOutput>,
) -> Result<CapturedInstallerOutput, CommandError> {
    let output = reader
        .join()
        .map_err(|_| download_error("The managed local image installer output reader failed."))?;
    if output.read_failed {
        return Err(download_error(
            "The managed local image installer output could not be read.",
        ));
    }
    Ok(output)
}

fn validate_comfy_result(
    spec: &PackageSpec,
    runtime_root: &Path,
    value: &serde_json::Value,
) -> Result<(), CommandError> {
    let InstallStrategy::ManagedComfy {
        artifact_count,
        executable,
        ..
    } = spec.strategy
    else {
        return Err(download_error(
            "A quarantine package returned a managed installer result.",
        ));
    };
    let object = value.as_object().ok_or_else(|| {
        download_error("The managed local image installer result is not an object.")
    })?;
    let expected_root = runtime_root
        .canonicalize()
        .map_err(|_| download_error("The managed local image root was not created."))?;
    let returned_root = object
        .get("runtimeRoot")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .and_then(|path| path.canonicalize().ok());
    let expected_recipe = executable.then_some("comfy-sdxl-1.0-portrait-v1");
    let returned_recipe = object.get("recipeId").and_then(serde_json::Value::as_str);
    let files = object
        .get("files")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| download_error("The managed preflight omitted its file results."))?;
    if object.get("ok").and_then(serde_json::Value::as_bool) != Some(true)
        || object.get("operation").and_then(serde_json::Value::as_str) != Some("install")
        || object.get("modelId").and_then(serde_json::Value::as_str) != Some(spec.model_id)
        || object
            .get("runtimeReady")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        || object
            .get("executable")
            .and_then(serde_json::Value::as_bool)
            != Some(executable)
        || returned_recipe != expected_recipe
        || returned_root.as_deref() != Some(expected_root.as_path())
        || files.len().saturating_add(1) != artifact_count
    {
        return Err(download_error(
            "The managed local image installer result did not match the pinned declaration.",
        ));
    }
    for file in files {
        let path = file
            .get("path")
            .and_then(serde_json::Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| download_error("The managed preflight returned an invalid path."))?;
        if file.get("verified").and_then(serde_json::Value::as_bool) != Some(true)
            || !path.is_absolute()
            || !path.starts_with(&expected_root)
        {
            return Err(download_error(
                "The managed preflight did not verify every contained model file.",
            ));
        }
    }
    Ok(())
}

fn validate_comfy_runtime_result(
    runtime_root: &Path,
    value: &serde_json::Value,
) -> Result<(), CommandError> {
    let object = value.as_object().ok_or_else(|| {
        download_error("The managed ComfyUI runtime installer result is not an object.")
    })?;
    let expected_root = runtime_root
        .canonicalize()
        .map_err(|_| download_error("The managed local image root was not created."))?;
    let returned_root = object
        .get("runtimeRoot")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .and_then(|path| path.canonicalize().ok());
    if object.get("ok").and_then(serde_json::Value::as_bool) != Some(true)
        || object.get("operation").and_then(serde_json::Value::as_str) != Some("install-runtime")
        || object
            .get("runtimeReady")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        || object
            .get("runtimeRevision")
            .and_then(serde_json::Value::as_str)
            != Some(COMFYUI_RUNTIME_REVISION)
        || returned_root.as_deref() != Some(expected_root.as_path())
    {
        return Err(download_error(
            "The managed ComfyUI runtime installer result did not match the pinned declaration.",
        ));
    }
    Ok(())
}

fn validated_managed_identity(
    spec: &PackageSpec,
    runtime_root: &Path,
    verify_installed_bytes: bool,
) -> Result<(String, String), CommandError> {
    if spec.model_id != SDXL.model_id {
        return Err(download_error(
            "Only the hardware-reviewed SDXL bundle can produce an executable install receipt.",
        ));
    }
    let manifest_path = runtime_root
        .join("manifests")
        .join("local-sdxl-base-1.0.json");
    let metadata = fs::metadata(&manifest_path)
        .map_err(|_| download_error("The verified SDXL install manifest is missing."))?;
    if metadata.len() == 0 || metadata.len() > MAX_MANAGED_MANIFEST_BYTES {
        return Err(download_error(
            "The verified SDXL install manifest has an invalid size.",
        ));
    }
    let bytes = fs::read(&manifest_path)
        .map_err(|_| download_error("The verified SDXL install manifest could not be read."))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| download_error("The verified SDXL install manifest is invalid."))?;
    let object = value
        .as_object()
        .ok_or_else(|| download_error("The verified SDXL install manifest is not an object."))?;
    let expected_keys = [
        "files",
        "license",
        "modelId",
        "recipeId",
        "runtimeRevision",
        "status",
    ];
    if object.len() != expected_keys.len()
        || expected_keys.iter().any(|key| !object.contains_key(*key))
        || object.get("modelId").and_then(serde_json::Value::as_str) != Some(spec.model_id)
        || object.get("recipeId").and_then(serde_json::Value::as_str) != Some(SDXL_RECIPE_ID)
        || object
            .get("runtimeRevision")
            .and_then(serde_json::Value::as_str)
            != Some(COMFYUI_RUNTIME_REVISION)
        || object.get("status").and_then(serde_json::Value::as_str)
            != Some("hardware-verified-12gb-windows")
        || object.get("license").and_then(serde_json::Value::as_str)
            != Some("CreativeML Open RAIL++-M")
    {
        return Err(download_error(
            "The verified SDXL install manifest differs from the pinned declaration.",
        ));
    }
    let files = object
        .get("files")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| download_error("The verified SDXL install manifest has no file list."))?;
    if files.len() != SDXL_MANIFEST_FILES.len() {
        return Err(download_error(
            "The verified SDXL install manifest has an unexpected file count.",
        ));
    }
    for expected in SDXL_MANIFEST_FILES {
        let matching = files.iter().filter(|file| {
            let Some(row) = file.as_object() else {
                return false;
            };
            row.len() == 3
                && row.get("path").and_then(serde_json::Value::as_str)
                    == Some(expected.relative_path)
                && row.get("size").and_then(serde_json::Value::as_u64) == Some(expected.size_bytes)
                && row.get("sha256").and_then(serde_json::Value::as_str) == Some(expected.sha256)
        });
        if matching.count() != 1 {
            return Err(download_error(
                "The verified SDXL install manifest has an unexpected file identity.",
            ));
        }
    }

    if verify_installed_bytes {
        let comfy_root = validate_managed_runtime(runtime_root)?;
        for expected in SDXL_MANIFEST_FILES {
            let relative = safe_relative(expected.relative_path)?;
            if !verify_exact_file(
                &comfy_root.join(relative),
                expected.size_bytes,
                expected.sha256,
            ) {
                return Err(download_error(
                    "An installed SDXL file no longer matches its verified receipt.",
                ));
            }
        }
    }

    let mut fingerprint = Sha256::new();
    for value in [
        "alystria-managed-local-image-install-v1",
        spec.model_id,
        spec.immutable_revision,
        spec.code_revision,
        spec.weight_revision,
        SDXL_RECIPE_ID,
        COMFYUI_RUNTIME_ARCHIVE,
        &COMFYUI_RUNTIME_BYTES.to_string(),
        COMFYUI_RUNTIME_SHA256,
    ] {
        fingerprint.update(value.as_bytes());
        fingerprint.update([0]);
    }
    for file in SDXL_MANIFEST_FILES {
        for value in [
            file.relative_path,
            &file.size_bytes.to_string(),
            file.sha256,
        ] {
            fingerprint.update(value.as_bytes());
            fingerprint.update([0]);
        }
    }
    Ok((
        spec.immutable_revision.into(),
        format!("{:x}", fingerprint.finalize()),
    ))
}

fn validated_runtime_identity(runtime_root: &Path) -> Result<(String, String), CommandError> {
    validate_managed_runtime(runtime_root)?;
    Ok((
        COMFYUI_RUNTIME.immutable_revision.into(),
        runtime_install_fingerprint(),
    ))
}

fn runtime_install_fingerprint() -> String {
    let mut fingerprint = Sha256::new();
    for value in [
        "alystria-managed-comfy-runtime-install-v1",
        COMFYUI_RUNTIME.model_id,
        COMFYUI_RUNTIME.immutable_revision,
        COMFYUI_RUNTIME.code_revision,
        COMFYUI_RUNTIME_ARCHIVE,
        &COMFYUI_RUNTIME_BYTES.to_string(),
        COMFYUI_RUNTIME_SHA256,
    ] {
        fingerprint.update(value.as_bytes());
        fingerprint.update([0]);
    }
    format!("{:x}", fingerprint.finalize())
}

fn validate_managed_runtime(runtime_root: &Path) -> Result<PathBuf, CommandError> {
    if runtime_root.join(".comfyui-extraction-pending").exists() {
        return Err(download_error(
            "ComfyUI extraction was interrupted. Retry the runtime download to finish installation.",
        ));
    }
    let comfy_root = resolved_managed_runtime_layout(runtime_root)
        .ok_or_else(|| {
            download_error("The extracted ComfyUI runtime entry points are incomplete.")
        })?
        .comfy_root;
    if !verify_exact_file(
        &runtime_root.join(COMFYUI_RUNTIME_ARCHIVE),
        COMFYUI_RUNTIME_BYTES,
        COMFYUI_RUNTIME_SHA256,
    ) {
        return Err(download_error(
            "The pinned ComfyUI archive no longer matches its verified hash.",
        ));
    }
    Ok(comfy_root)
}

fn verify_exact_file(path: &Path, expected_size: u64, expected_sha256: &str) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if metadata.len() != expected_size {
        return false;
    }
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 8 * 1024 * 1024];
    loop {
        let Ok(count) = file.read(&mut buffer) else {
            return false;
        };
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    format!("{:x}", hasher.finalize()) == expected_sha256
}

fn human_bytes(value: u64) -> String {
    if value >= 1024 * 1024 * 1024 {
        format!("{:.2} GiB", value as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if value >= 1024 * 1024 {
        format!("{:.1} MiB", value as f64 / (1024.0 * 1024.0))
    } else {
        format!("{} KiB", value / 1024)
    }
}
fn download_error(message: &str) -> CommandError {
    CommandError::new("MODEL_DOWNLOAD_FAILED", message, true)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let temporary = path.with_extension("json.part");
    fs::write(&temporary, bytes)
        .map_err(|_| CommandError::io("model download status staging write"))?;
    fs::rename(&temporary, path).map_err(|_| CommandError::io("model download status promotion"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use tempfile::tempdir;

    #[test]
    fn catalog_is_pinned_and_explicitly_download_only() {
        validate_spec(&MUSETALK).expect("valid pinned declaration");
        let entry = catalog_entry(&MUSETALK, false);
        assert_eq!(entry.model_id, "local/musetalk-1.5");
        assert!(entry.total_bytes > 4_000_000_000);
        assert!(entry.download_only_reason.contains("not activated"));
        assert_eq!(
            entry.code_revision,
            "0a89dec45a0192b824e3cf4daf96c239440c5ed8"
        );
        assert_eq!(
            entry.weight_revision,
            "3ef28bc5cff08c90ad8178a25f1b570cd800170f"
        );
        assert!(entry.license_url.contains(&entry.code_revision));
        assert!(!entry.license_url.contains(&entry.weight_revision));
        assert!(entry.license_scope.contains("source code only"));
    }

    #[test]
    fn exact_existing_artifact_is_hash_verified() {
        let directory = tempdir().expect("tempdir");
        let bytes = b"safe deterministic bytes";
        let path = directory.path().join("artifact.bin");
        fs::write(&path, bytes).expect("write fixture");
        let digest = format!("{:x}", Sha256::digest(bytes));
        let spec = ArtifactSpec {
            relative_path: "artifact.bin",
            repository: "example/model",
            revision: "revision",
            upstream_path: "artifact.bin",
            size_bytes: bytes.len() as u64,
            sha256: Box::leak(digest.into_boxed_str()),
        };
        verify_file(&path, &spec).expect("verified");
        fs::write(&path, b"tampered").expect("tamper");
        assert_eq!(
            verify_file(&path, &spec).expect_err("reject").code,
            "MODEL_DOWNLOAD_FAILED"
        );
    }

    #[test]
    fn bounded_http_download_writes_and_verifies_the_exact_declared_bytes() {
        let directory = tempdir().expect("tempdir");
        let bytes = b"tiny onboarding download fixture";
        let digest = format!("{:x}", Sha256::digest(bytes));
        let artifact = ArtifactSpec {
            relative_path: "fixture/model.bin",
            repository: "fixture/repository",
            revision: "fixture-revision",
            upstream_path: "model.bin",
            size_bytes: bytes.len() as u64,
            sha256: Box::leak(digest.into_boxed_str()),
        };
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback fixture");
        let address = listener.local_addr().expect("fixture address");
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept fixture request");
            let mut request = [0u8; 2048];
            let count = socket.read(&mut request).expect("read fixture request");
            assert!(
                String::from_utf8_lossy(&request[..count]).starts_with("GET /model.bin HTTP/1.1")
            );
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .expect("write fixture headers");
            socket.write_all(bytes).expect("write fixture body");
        });
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("fixture client");
        let part = directory.path().join("model.bin.part");
        let mut progress = Vec::new();

        fetch_artifact_from_url(
            &client,
            &MUSETALK,
            &artifact,
            &part,
            &format!("http://{address}/model.bin"),
            |message| progress.push(message),
        )
        .expect("bounded fixture download");
        server.join().expect("fixture server");
        verify_file(&part, &artifact).expect("downloaded fixture hash");
        assert_eq!(fs::read(&part).expect("fixture bytes"), bytes);
        assert_eq!(progress.len(), 1);
    }

    #[test]
    fn bounded_http_download_resumes_only_an_exact_server_range() {
        let directory = tempdir().expect("tempdir");
        let bytes = b"tiny resumable model download fixture";
        let offset = 11usize;
        let digest = format!("{:x}", Sha256::digest(bytes));
        let artifact = ArtifactSpec {
            relative_path: "fixture/resumable.bin",
            repository: "fixture/repository",
            revision: "fixture-revision",
            upstream_path: "resumable.bin",
            size_bytes: bytes.len() as u64,
            sha256: Box::leak(digest.into_boxed_str()),
        };
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback fixture");
        let address = listener.local_addr().expect("fixture address");
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept fixture request");
            let mut request = [0u8; 2048];
            let count = socket.read(&mut request).expect("read fixture request");
            let request = String::from_utf8_lossy(&request[..count]);
            assert!(request.starts_with("GET /resumable.bin HTTP/1.1"));
            assert!(request.contains(&format!("range: bytes={offset}-")));
            write!(
                socket,
                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                bytes.len() - offset,
                offset,
                bytes.len() - 1,
                bytes.len()
            )
            .expect("write fixture headers");
            socket
                .write_all(&bytes[offset..])
                .expect("write fixture body");
        });
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("fixture client");
        let part = directory.path().join("resumable.bin.part");
        fs::write(&part, &bytes[..offset]).expect("partial fixture");

        fetch_artifact_from_url(
            &client,
            &MUSETALK,
            &artifact,
            &part,
            &format!("http://{address}/resumable.bin"),
            |_| {},
        )
        .expect("resumed fixture download");
        server.join().expect("fixture server");
        verify_file(&part, &artifact).expect("resumed fixture hash");
        assert_eq!(fs::read(part).expect("fixture bytes"), bytes);
    }

    #[test]
    fn managed_progress_counts_only_allowlisted_runtime_and_model_bytes() {
        let directory = tempdir().expect("tempdir");
        let runtime_root = directory.path();
        let portable_root = runtime_root.join("ComfyUI_windows_portable");
        let comfy_root = portable_root.join("ComfyUI");
        fs::create_dir_all(&comfy_root).expect("comfy root");
        let archive_part = partial_path(&runtime_root.join(COMFYUI_RUNTIME_ARCHIVE));
        fs::write(&archive_part, vec![0u8; 256 * 1024]).expect("partial runtime archive");
        let checkpoint = comfy_root.join(SDXL_MANIFEST_FILES[0].relative_path);
        fs::create_dir_all(checkpoint.parent().expect("checkpoint parent"))
            .expect("checkpoint directory");
        let checkpoint_part = partial_path(&checkpoint);
        fs::write(&checkpoint_part, vec![0u8; 512 * 1024]).expect("partial checkpoint");
        fs::write(
            runtime_root.join("unrelated-large-file.bin"),
            vec![0u8; 1024 * 1024],
        )
        .expect("unrelated fixture");

        let progress = managed_progress(runtime_root, &SDXL);
        assert_eq!(progress.downloaded_bytes, 768 * 1024);
        assert_eq!(progress.phase, ModelDownloadPhase::Downloading);
        assert!(progress.detail.contains(COMFYUI_RUNTIME_ARCHIVE));
    }

    #[cfg(feature = "portable-debug-runtime")]
    #[test]
    fn portable_debug_manager_downloads_the_loopback_hash_pinned_fixture() {
        let directory = tempdir().expect("tempdir");
        unsafe { std::env::remove_var(ACCEPTANCE_DOWNLOAD_URL_ENV) };
        let hidden_manager = ModelDownloadManager::at(directory.path().join("hidden-models"))
            .expect("fixture-hidden manager");
        assert!(
            hidden_manager
                .catalog()
                .iter()
                .all(|entry| entry.model_id != ACCEPTANCE_DOWNLOAD_FIXTURE.model_id),
            "fixture must stay out of the portable-debug catalog without a validated loopback endpoint"
        );
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback fixture");
        let address = listener.local_addr().expect("fixture address");
        let fixture_bytes = vec![0u8; 4 * 1024 * 1024];
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept fixture request");
            let mut request = [0u8; 2048];
            let count = socket.read(&mut request).expect("read fixture request");
            assert!(
                String::from_utf8_lossy(&request[..count])
                    .starts_with("GET /alystria-model-download-fixture.bin HTTP/1.1")
            );
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                fixture_bytes.len()
            )
            .expect("write fixture headers");
            for chunk in fixture_bytes.chunks(64 * 1024) {
                socket.write_all(chunk).expect("write fixture body");
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        let endpoint = format!("http://{address}/alystria-model-download-fixture.bin");
        // This variable exists only in portable-debug builds and the production
        // resolver still validates that its parsed address is loopback-only.
        unsafe {
            std::env::set_var(
                ACCEPTANCE_DOWNLOAD_URL_ENV,
                "http://192.0.2.1/alystria-model-download-fixture.bin",
            )
        };
        assert_eq!(
            artifact_url(
                &ACCEPTANCE_DOWNLOAD_FIXTURE,
                &ACCEPTANCE_DOWNLOAD_FIXTURE_ARTIFACTS[0]
            )
            .expect_err("non-loopback fixture source")
            .code,
            "MODEL_DOWNLOAD_FAILED"
        );
        assert!(
            hidden_manager
                .catalog()
                .iter()
                .all(|entry| entry.model_id != ACCEPTANCE_DOWNLOAD_FIXTURE.model_id),
            "fixture must stay out of the portable-debug catalog for a non-loopback endpoint"
        );
        unsafe { std::env::set_var(ACCEPTANCE_DOWNLOAD_URL_ENV, &endpoint) };
        let manager =
            ModelDownloadManager::at(directory.path().join("models")).expect("fixture manager");
        let fixture_entry = manager
            .catalog()
            .into_iter()
            .find(|entry| entry.model_id == ACCEPTANCE_DOWNLOAD_FIXTURE.model_id)
            .expect("validated loopback fixture catalog entry");
        assert_eq!(
            fixture_entry.display_name,
            ACCEPTANCE_DOWNLOAD_FIXTURE.display_name
        );
        assert_eq!(fixture_entry.total_bytes, 4 * 1024 * 1024);
        manager
            .start(ModelDownloadStartRequest {
                model_id: ACCEPTANCE_DOWNLOAD_FIXTURE.model_id.into(),
                license_sha256: ACCEPTANCE_DOWNLOAD_FIXTURE.license_sha256.into(),
                license_accepted: true,
            })
            .expect("start fixture manager download");
        let mut saw_in_progress_bytes = false;
        for _ in 0..500 {
            let status = manager.current(&ACCEPTANCE_DOWNLOAD_FIXTURE);
            saw_in_progress_bytes |=
                status.downloaded_bytes > 0 && status.downloaded_bytes < status.total_bytes;
            if status.phase == ModelDownloadPhase::DownloadedQuarantined {
                break;
            }
            if status.phase == ModelDownloadPhase::Failed {
                panic!("fixture download failed: {}", status.detail);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        unsafe { std::env::remove_var(ACCEPTANCE_DOWNLOAD_URL_ENV) };
        server.join().expect("fixture server");

        let status = manager.current(&ACCEPTANCE_DOWNLOAD_FIXTURE);
        assert!(
            saw_in_progress_bytes,
            "manager never surfaced real byte progress"
        );
        assert_eq!(status.phase, ModelDownloadPhase::DownloadedQuarantined);
        assert_eq!(status.downloaded_bytes, 4 * 1024 * 1024);
        assert_eq!(status.verified_artifacts, 1);
        assert!(status.activation_blocked);
        let artifact = manager
            .package_root(&ACCEPTANCE_DOWNLOAD_FIXTURE)
            .join("files/fixture/alystria-model-download-fixture.bin");
        verify_file(&artifact, &ACCEPTANCE_DOWNLOAD_FIXTURE_ARTIFACTS[0])
            .expect("pinned fixture hash");
    }

    #[test]
    fn manager_requires_the_exact_license_hash_before_start() {
        let directory = tempdir().expect("tempdir");
        let manager = ModelDownloadManager::at(directory.path().to_path_buf()).expect("manager");
        let error = manager
            .start(ModelDownloadStartRequest {
                model_id: MUSETALK.model_id.into(),
                license_sha256: "0".repeat(64),
                license_accepted: true,
            })
            .expect_err("wrong license");
        assert_eq!(error.code, "LICENSE_NOT_ACCEPTED");
        assert_eq!(
            manager.statuses()[0].phase,
            ModelDownloadPhase::ManifestRequired
        );
    }

    #[test]
    fn closed_manager_cannot_publish_or_launch_another_download() {
        let directory = tempdir().expect("tempdir");
        let manager = ModelDownloadManager::at(directory.path().to_path_buf()).expect("manager");
        manager.close();
        let error = manager
            .start(ModelDownloadStartRequest {
                model_id: COMFYUI_RUNTIME.model_id.into(),
                license_sha256: COMFYUI_RUNTIME.license_sha256.into(),
                license_accepted: true,
            })
            .expect_err("closed manager");
        assert_eq!(error.code, "COMPONENT_UNAVAILABLE");
        assert_eq!(
            manager.current(&COMFYUI_RUNTIME).phase,
            ModelDownloadPhase::ManifestRequired
        );
    }

    #[test]
    fn managed_image_catalog_is_available_only_with_a_verified_installer() {
        for spec in [&SDXL, &FLUX_KLEIN, &Z_IMAGE] {
            validate_spec(spec).expect("valid managed declaration");
            let unavailable = catalog_entry(spec, false);
            let available = catalog_entry(spec, true);
            assert!(!unavailable.available);
            assert!(available.available);
            assert_eq!(available.artifact_count, artifact_count(spec));
            assert_eq!(available.total_bytes, total_bytes(spec));
            assert!(available.total_bytes > COMFYUI_RUNTIME_BYTES);
        }
        assert_eq!(SDXL.model_id, "local/sdxl-base-1.0");
        assert_eq!(FLUX_KLEIN.model_id, "local/flux.2-klein-4b-fp8");
        assert_eq!(Z_IMAGE.model_id, "local/z-image-turbo-int8");
    }

    #[test]
    fn interrupted_extraction_cannot_publish_runtime_ready() {
        let directory = tempdir().expect("tempdir");
        fs::write(
            directory.path().join(".comfyui-extraction-pending"),
            "pending",
        )
        .expect("interruption marker");
        let failure = validate_managed_runtime(directory.path()).expect_err("partial runtime");
        assert!(failure.message.contains("interrupted"));
    }

    #[test]
    fn managed_model_destination_never_combines_mixed_runtime_layouts() {
        let directory = tempdir().expect("tempdir");
        let manual = manual_runtime_layout(directory.path());
        let portable = portable_runtime_layout(directory.path());
        fs::create_dir_all(&manual.comfy_root).expect("manual ComfyUI root");
        fs::write(manual.comfy_root.join("main.py"), b"# incomplete manual")
            .expect("manual entrypoint");
        fs::create_dir_all(&portable.comfy_root).expect("portable ComfyUI root");
        fs::write(portable.comfy_root.join("main.py"), b"# portable").expect("portable entrypoint");
        fs::create_dir_all(portable.python_executable.parent().unwrap())
            .expect("portable Python root");
        fs::write(&portable.python_executable, b"portable python").expect("portable Python");

        assert_eq!(managed_comfy_root(directory.path()), portable.comfy_root);
        let resolved = resolved_managed_runtime_layout(directory.path()).expect("portable pair");
        assert_eq!(resolved.comfy_root, portable.comfy_root);
        assert_eq!(resolved.python_executable, portable.python_executable);

        fs::remove_file(&portable.python_executable).expect("remove portable Python");
        assert!(resolved_managed_runtime_layout(directory.path()).is_none());
        assert_eq!(managed_comfy_root(directory.path()), portable.comfy_root);

        fs::create_dir_all(manual.python_executable.parent().unwrap()).expect("manual Python root");
        fs::write(&manual.python_executable, b"manual python").expect("manual Python");
        let resolved = resolved_managed_runtime_layout(directory.path()).expect("manual pair");
        assert_eq!(resolved.comfy_root, manual.comfy_root);
        assert_eq!(resolved.python_executable, manual.python_executable);
    }

    #[test]
    fn standalone_comfy_runtime_catalog_has_no_model_weight_payload() {
        validate_spec(&COMFYUI_RUNTIME).expect("valid standalone runtime declaration");
        let unavailable = catalog_entry(&COMFYUI_RUNTIME, false);
        let available = catalog_entry(&COMFYUI_RUNTIME, true);
        assert!(!unavailable.available);
        assert!(available.available);
        assert_eq!(available.model_id, "runtime/comfyui-0.9.2");
        assert_eq!(available.display_name, "ComfyUI 0.9.2 portable runtime");
        assert_eq!(available.total_bytes, COMFYUI_RUNTIME_BYTES);
        assert_eq!(available.artifact_count, 1);
        assert_eq!(available.license_id, "GPL-3.0");
        assert!(COMFYUI_RUNTIME.managed_files.is_empty());
        assert_eq!(total_bytes(&SDXL), COMFYUI_RUNTIME_BYTES + 6_987_631_938);
        assert!(is_sha256(&runtime_install_fingerprint()));
    }

    #[test]
    fn runtime_installer_result_requires_exact_revision_and_contained_root() {
        let directory = tempdir().expect("tempdir");
        let runtime_root = directory.path().join("comfyui-local");
        fs::create_dir_all(&runtime_root).expect("runtime root");
        let result = serde_json::json!({
            "ok": true,
            "operation": "install-runtime",
            "runtimeRoot": runtime_root.canonicalize().unwrap(),
            "runtimeReady": true,
            "runtimeRevision": COMFYUI_RUNTIME_REVISION,
        });
        validate_comfy_runtime_result(&runtime_root, &result).expect("valid runtime result");

        let mut wrong_revision = result;
        wrong_revision["runtimeRevision"] = serde_json::json!("untrusted");
        assert_eq!(
            validate_comfy_runtime_result(&runtime_root, &wrong_revision)
                .expect_err("wrong runtime revision")
                .code,
            "MODEL_DOWNLOAD_FAILED"
        );
    }

    #[test]
    fn standalone_runtime_receipt_is_durable_and_distinct_from_sdxl_readiness() {
        let directory = tempdir().expect("tempdir");
        let manager = ModelDownloadManager::at(directory.path().to_path_buf()).expect("manager");
        let fingerprint = runtime_install_fingerprint();
        manager.commit_runtime_ready(
            COMFYUI_RUNTIME.immutable_revision.into(),
            fingerprint.clone(),
        );
        assert_eq!(
            manager.current(&COMFYUI_RUNTIME).phase,
            ModelDownloadPhase::Ready
        );
        assert_eq!(
            manager.current(&COMFYUI_RUNTIME).install_fingerprint,
            Some(fingerprint.clone())
        );
        assert_eq!(
            manager.current(&SDXL).phase,
            ModelDownloadPhase::ManifestRequired
        );

        let restarted = ModelDownloadManager {
            statuses: Arc::new(RwLock::new(BTreeMap::new())),
            ..manager.clone()
        };
        restarted.load_statuses();
        assert_eq!(
            restarted.current(&COMFYUI_RUNTIME).phase,
            ModelDownloadPhase::Ready
        );
        assert_eq!(
            restarted.current(&COMFYUI_RUNTIME).install_fingerprint,
            Some(fingerprint)
        );
        assert_eq!(
            restarted.current(&SDXL).phase,
            ModelDownloadPhase::ManifestRequired
        );
    }

    #[test]
    fn managed_preflight_result_must_match_the_exact_model_and_contained_files() {
        let directory = tempdir().expect("tempdir");
        let runtime_root = directory.path().join("comfyui-local");
        let checkpoint = runtime_root.join("ComfyUI/models/checkpoints/sdxl.safetensors");
        let lora = runtime_root.join("ComfyUI/models/loras/offset.safetensors");
        fs::create_dir_all(checkpoint.parent().unwrap()).expect("checkpoint directory");
        fs::create_dir_all(lora.parent().unwrap()).expect("lora directory");
        fs::write(&checkpoint, b"checkpoint").expect("checkpoint");
        fs::write(&lora, b"lora").expect("lora");
        let result = serde_json::json!({
            "ok": true,
            "operation": "install",
            "runtimeRoot": runtime_root.canonicalize().unwrap(),
            "runtimeReady": true,
            "modelId": SDXL.model_id,
            "recipeId": "comfy-sdxl-1.0-portrait-v1",
            "executable": true,
            "files": [
                {"path": checkpoint.canonicalize().unwrap(), "verified": true},
                {"path": lora.canonicalize().unwrap(), "verified": true}
            ]
        });
        validate_comfy_result(&SDXL, &runtime_root, &result).expect("valid result");

        let mut wrong_model = result;
        wrong_model["modelId"] = serde_json::json!("local/unreviewed");
        assert_eq!(
            validate_comfy_result(&SDXL, &runtime_root, &wrong_model)
                .expect_err("wrong model")
                .code,
            "MODEL_DOWNLOAD_FAILED"
        );
    }

    #[test]
    fn executable_install_identity_comes_from_the_exact_validated_manifest() {
        let directory = tempdir().expect("tempdir");
        let manifest_root = directory.path().join("manifests");
        fs::create_dir_all(&manifest_root).expect("manifest directory");
        let manifest_path = manifest_root.join("local-sdxl-base-1.0.json");
        let manifest = serde_json::json!({
            "modelId": SDXL.model_id,
            "recipeId": SDXL_RECIPE_ID,
            "status": "hardware-verified-12gb-windows",
            "license": "CreativeML Open RAIL++-M",
            "runtimeRevision": COMFYUI_RUNTIME_REVISION,
            "files": SDXL_MANIFEST_FILES.iter().map(|file| serde_json::json!({
                "path": file.relative_path,
                "size": file.size_bytes,
                "sha256": file.sha256,
            })).collect::<Vec<_>>(),
        });
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .expect("manifest");

        let first =
            validated_managed_identity(&SDXL, directory.path(), false).expect("validated identity");
        let second =
            validated_managed_identity(&SDXL, directory.path(), false).expect("stable identity");
        assert_eq!(first, second);
        assert_eq!(first.0, SDXL.immutable_revision);
        assert!(is_sha256(&first.1));

        let mut changed = manifest;
        changed["files"][0]["sha256"] = serde_json::json!("0".repeat(64));
        fs::write(&manifest_path, serde_json::to_vec_pretty(&changed).unwrap())
            .expect("changed manifest");
        assert_eq!(
            validated_managed_identity(&SDXL, directory.path(), false)
                .expect_err("changed identity")
                .code,
            "MODEL_DOWNLOAD_FAILED"
        );
    }

    #[test]
    fn persisted_ready_identity_requires_installed_runtime_and_model_bytes() {
        let directory = tempdir().expect("tempdir");
        let manifest_root = directory.path().join("manifests");
        fs::create_dir_all(&manifest_root).expect("manifest directory");
        let manifest = serde_json::json!({
            "modelId": SDXL.model_id,
            "recipeId": SDXL_RECIPE_ID,
            "status": "hardware-verified-12gb-windows",
            "license": "CreativeML Open RAIL++-M",
            "runtimeRevision": COMFYUI_RUNTIME_REVISION,
            "files": SDXL_MANIFEST_FILES.iter().map(|file| serde_json::json!({
                "path": file.relative_path,
                "size": file.size_bytes,
                "sha256": file.sha256,
            })).collect::<Vec<_>>(),
        });
        fs::write(
            manifest_root.join("local-sdxl-base-1.0.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .expect("manifest");
        let failure = validated_managed_identity(&SDXL, directory.path(), true)
            .expect_err("missing installed bytes");
        assert_eq!(failure.code, "MODEL_DOWNLOAD_FAILED");
    }

    #[test]
    fn transient_revalidation_state_does_not_replace_the_durable_ready_receipt() {
        let directory = tempdir().expect("tempdir");
        let manager = ModelDownloadManager::at(directory.path().to_path_buf()).expect("manager");
        let mut ready = manifest_status(&SDXL);
        ready.phase = ModelDownloadPhase::Ready;
        ready.activation_blocked = false;
        ready.runtime_revision = Some(SDXL.immutable_revision.into());
        ready.install_fingerprint = Some("a".repeat(64));
        manager.update(ready.clone());
        let expected = manager.prepare_ready_revalidation(ready);
        let checking = manager.current(&SDXL);
        assert_eq!(checking.phase, ModelDownloadPhase::Verifying);
        assert!(checking.activation_blocked);
        assert!(checking.install_fingerprint.is_none());
        assert!(checking.runtime_revision.is_none());
        let restarted = ModelDownloadManager {
            statuses: Arc::new(RwLock::new(BTreeMap::new())),
            ..manager.clone()
        };
        restarted.load_statuses();
        assert_eq!(restarted.current(&SDXL).phase, ModelDownloadPhase::Ready);
        assert_eq!(restarted.current(&SDXL).install_fingerprint, expected.1);
        // The absent real files fail the subsequent recheck and clear identity.
        restarted.finish_loaded_ready_revalidation(&SDXL, expected);
        let failed = restarted.current(&SDXL);
        assert_eq!(failed.phase, ModelDownloadPhase::Failed);
        assert!(failed.activation_blocked);
        assert!(failed.install_fingerprint.is_none());
        assert!(failed.runtime_revision.is_none());
    }
}
