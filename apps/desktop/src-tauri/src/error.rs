use serde::Serialize;
use std::fmt::Display;

/// Stable error envelope crossing the Tauri IPC boundary.
///
/// Internal error chains, OS credential errors and secret values are deliberately
/// never serialized to the webview.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl CommandError {
    pub fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }

    pub fn invalid(field: &str, reason: impl Display) -> Self {
        Self::new("INVALID_INPUT", format!("Invalid {field}: {reason}"), false)
    }

    pub fn unavailable(component: &str) -> Self {
        Self::new(
            "COMPONENT_UNAVAILABLE",
            format!("{component} is not available on this system."),
            true,
        )
    }

    pub fn io(operation: &str) -> Self {
        Self::new(
            "LOCAL_IO_FAILED",
            format!("The local {operation} operation failed."),
            true,
        )
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("CONFLICT", message, false)
    }

    pub fn worker(message: impl Into<String>, retryable: bool) -> Self {
        Self::new("WORKER_ERROR", message, retryable)
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(_: serde_json::Error) -> Self {
        Self::new(
            "INVALID_PROJECT_DOCUMENT",
            "The project document is not valid JSON.",
            false,
        )
    }
}
