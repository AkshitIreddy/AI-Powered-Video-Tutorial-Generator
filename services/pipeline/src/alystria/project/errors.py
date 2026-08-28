"""Project-domain exceptions with stable error codes for IPC clients."""


class ProjectError(RuntimeError):
    code = "PROJECT_ERROR"


class ProjectExistsError(ProjectError):
    code = "PROJECT_EXISTS"


class InvalidProjectError(ProjectError):
    code = "INVALID_PROJECT"


class UnsafePathError(ProjectError):
    code = "UNSAFE_PATH"


class ArchiveLimitError(ProjectError):
    code = "ARCHIVE_LIMIT"


class RevisionConflictError(ProjectError):
    code = "REVISION_CONFLICT"
