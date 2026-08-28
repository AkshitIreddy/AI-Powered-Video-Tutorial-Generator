"""Stable model-runtime errors suitable for IPC translation."""


class ModelRuntimeError(RuntimeError):
    code = "MODEL_RUNTIME_ERROR"


class ManifestError(ModelRuntimeError):
    code = "INVALID_MODEL_MANIFEST"


class SignatureError(ModelRuntimeError):
    code = "MODEL_SIGNATURE_INVALID"


class LicenseNotAcceptedError(ModelRuntimeError):
    code = "MODEL_LICENSE_NOT_ACCEPTED"


class UnsafeModelError(ModelRuntimeError):
    code = "UNSAFE_MODEL_ARTIFACT"


class DownloadError(ModelRuntimeError):
    code = "MODEL_DOWNLOAD_FAILED"


class IntegrityError(ModelRuntimeError):
    code = "MODEL_INTEGRITY_FAILED"


class InstallError(ModelRuntimeError):
    code = "MODEL_INSTALL_FAILED"


class ModelNotInstalledError(ModelRuntimeError):
    code = "MODEL_NOT_INSTALLED"


class ModelInUseError(ModelRuntimeError):
    code = "MODEL_IN_USE"


class ResourceUnavailableError(ModelRuntimeError):
    code = "MODEL_RESOURCE_UNAVAILABLE"


class NetworkDisabledError(ModelRuntimeError):
    code = "NETWORK_DISABLED"


class NetworkPolicyError(ModelRuntimeError):
    code = "NETWORK_POLICY_BLOCKED"
