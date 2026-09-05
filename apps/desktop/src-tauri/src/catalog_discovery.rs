use crate::error::CommandError;
use crate::secrets::CredentialManager;
use chrono::Utc;
use reqwest::Url;
use reqwest::blocking::{Client, Response};
use reqwest::header::{AUTHORIZATION, LINK};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use zeroize::Zeroizing;

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDiscoveryRequest {
    pub source: String,
    #[serde(default)]
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: u16,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDiscoveryResponse {
    pub source: String,
    pub items: Vec<Value>,
    pub next_cursor: Option<String>,
    pub retrieved_at: String,
}

fn default_limit() -> u16 {
    24
}

pub async fn discover(
    input: CatalogDiscoveryRequest,
    credentials: Arc<CredentialManager>,
) -> Result<CatalogDiscoveryResponse, CommandError> {
    validate_input(&input)?;
    let credential = match input.source.as_str() {
        "nvidia-nim" => Some(credentials.lease_reference("keyring://alystria/nvidia-nim/api_key")?),
        "cohere" => Some(credentials.lease_reference("keyring://alystria/cohere/api_key")?),
        _ => None,
    };
    tauri::async_runtime::spawn_blocking(move || discover_blocking(input, credential))
        .await
        .map_err(|_| {
            CommandError::new(
                "CATALOG_DISCOVERY_JOIN_FAILED",
                "The catalog request worker stopped unexpectedly.",
                true,
            )
        })?
}

fn discover_blocking(
    input: CatalogDiscoveryRequest,
    credential: Option<Zeroizing<String>>,
) -> Result<CatalogDiscoveryResponse, CommandError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!(
            "AI-Video-Tutorial-Generator/",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|_| discovery_error("The catalog HTTP client could not be initialized."))?;

    let url = discovery_url(&input)?;
    let mut request = client.get(url);
    if let Some(secret) = credential.as_deref() {
        request = request.header(AUTHORIZATION, format!("Bearer {secret}"));
    }
    let response = request
        .send()
        .map_err(|_| discovery_error("The catalog endpoint could not be reached."))?;
    let link = response
        .headers()
        .get(LINK)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = bounded_json(response)?;
    let (items, body_cursor) = extract_items(&input.source, body)?;
    let next_cursor = body_cursor.or_else(|| link.as_deref().and_then(next_link));
    if let Some(cursor) = &next_cursor {
        validate_cursor(&input.source, cursor)?;
    }
    Ok(CatalogDiscoveryResponse {
        source: input.source,
        items,
        next_cursor,
        retrieved_at: Utc::now().to_rfc3339(),
    })
}

fn validate_input(input: &CatalogDiscoveryRequest) -> Result<(), CommandError> {
    if !matches!(
        input.source.as_str(),
        "hugging-face" | "civitai" | "nvidia-nim" | "cohere"
    ) {
        return Err(CommandError::invalid(
            "source",
            "must be hugging-face, civitai, nvidia-nim, or cohere",
        ));
    }
    if input.query.chars().count() > 200 || input.query.chars().any(char::is_control) {
        return Err(CommandError::invalid(
            "query",
            "must be at most 200 printable characters",
        ));
    }
    if !(1..=50).contains(&input.limit) {
        return Err(CommandError::invalid("limit", "must be between 1 and 50"));
    }
    if let Some(cursor) = &input.cursor {
        validate_cursor(&input.source, cursor)?;
    }
    Ok(())
}

fn discovery_url(input: &CatalogDiscoveryRequest) -> Result<Url, CommandError> {
    if let Some(cursor) = &input.cursor {
        return Url::parse(cursor)
            .map_err(|_| CommandError::invalid("cursor", "must be a valid provider cursor URL"));
    }
    let base = match input.source.as_str() {
        "hugging-face" => "https://huggingface.co/api/models",
        "civitai" => "https://civitai.com/api/v1/models",
        "nvidia-nim" => "https://integrate.api.nvidia.com/v1/models",
        "cohere" => "https://api.cohere.com/v1/models",
        _ => unreachable!(),
    };
    let mut url =
        Url::parse(base).map_err(|_| discovery_error("The built-in provider URL is invalid."))?;
    if input.source == "hugging-face" {
        url.query_pairs_mut()
            .append_pair("limit", &input.limit.to_string())
            .append_pair("full", "true")
            .append_pair("config", "true")
            .append_pair("sort", "downloads")
            .append_pair("direction", "-1");
        if !input.query.trim().is_empty() {
            url.query_pairs_mut()
                .append_pair("search", input.query.trim());
        }
    } else if input.source == "civitai" {
        url.query_pairs_mut()
            .append_pair("limit", &input.limit.to_string())
            .append_pair("sort", "Most Downloaded")
            .append_pair("period", "AllTime")
            .append_pair("nsfw", "false");
        if !input.query.trim().is_empty() {
            url.query_pairs_mut()
                .append_pair("query", input.query.trim());
        }
    } else if input.source == "cohere" {
        url.query_pairs_mut()
            .append_pair("page_size", &input.limit.to_string());
        if !input.query.trim().is_empty() {
            url.query_pairs_mut()
                .append_pair("endpoint", input.query.trim());
        }
    }
    Ok(url)
}

fn validate_cursor(source: &str, cursor: &str) -> Result<(), CommandError> {
    if cursor.len() > 4096 {
        return Err(CommandError::invalid("cursor", "is too long"));
    }
    let url =
        Url::parse(cursor).map_err(|_| CommandError::invalid("cursor", "must be a valid URL"))?;
    let expected = match source {
        "hugging-face" => ("huggingface.co", "/api/models"),
        "civitai" => ("civitai.com", "/api/v1/models"),
        "nvidia-nim" => ("integrate.api.nvidia.com", "/v1/models"),
        "cohere" => ("api.cohere.com", "/v1/models"),
        _ => return Err(CommandError::invalid("source", "is not supported")),
    };
    if url.scheme() != "https"
        || url.host_str() != Some(expected.0)
        || url.path() != expected.1
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(CommandError::invalid(
            "cursor",
            "must stay on the selected provider's HTTPS catalog endpoint",
        ));
    }
    Ok(())
}

fn bounded_json(response: Response) -> Result<Value, CommandError> {
    let status = response.status();
    if !status.is_success() {
        return Err(CommandError::new(
            "CATALOG_DISCOVERY_HTTP",
            format!(
                "The provider returned HTTP {}. No catalog rows were changed.",
                status.as_u16()
            ),
            status.is_server_error() || status.as_u16() == 429,
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(discovery_error(
            "The provider response exceeded the 8 MiB catalog limit.",
        ));
    }
    let bytes = response
        .bytes()
        .map_err(|_| discovery_error("The provider response could not be read."))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(discovery_error(
            "The provider response exceeded the 8 MiB catalog limit.",
        ));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| discovery_error("The provider returned invalid catalog JSON."))
}

fn extract_items(source: &str, body: Value) -> Result<(Vec<Value>, Option<String>), CommandError> {
    match source {
        "hugging-face" => body.as_array().cloned().map(|items| (items, None)),
        "civitai" => {
            let items = body.get("items").and_then(Value::as_array).cloned();
            let cursor = body
                .get("metadata")
                .and_then(|value| value.get("nextPage"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            items.map(|items| (items, cursor))
        }
        "nvidia-nim" => body
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .map(|items| (items, None)),
        "cohere" => {
            let items = body.get("models").and_then(Value::as_array).cloned();
            let cursor = body
                .get("next_page_token")
                .and_then(Value::as_str)
                .map(|token| {
                    let mut url =
                        Url::parse("https://api.cohere.com/v1/models").expect("static Cohere URL");
                    url.query_pairs_mut().append_pair("page_token", token);
                    url.to_string()
                });
            items.map(|items| (items, cursor))
        }
        _ => None,
    }
    .ok_or_else(|| {
        discovery_error("The provider response did not contain the documented model list.")
    })
}

fn next_link(header: &str) -> Option<String> {
    header.split(',').find_map(|part| {
        let (url, attributes) = part.trim().split_once('>')?;
        if !attributes
            .split(';')
            .any(|value| value.trim() == "rel=\"next\"")
        {
            return None;
        }
        Some(url.trim().strip_prefix('<')?.to_owned())
    })
}

fn discovery_error(message: impl Into<String>) -> CommandError {
    CommandError::new("CATALOG_DISCOVERY_FAILED", message, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_cross_provider_and_non_https_cursors() {
        assert!(
            validate_cursor(
                "hugging-face",
                "https://huggingface.co/api/models?cursor=abc"
            )
            .is_ok()
        );
        assert!(validate_cursor("hugging-face", "https://evil.example/api/models").is_err());
        assert!(validate_cursor("civitai", "http://civitai.com/api/v1/models?page=2").is_err());
    }

    #[test]
    fn extracts_only_the_next_link_relation() {
        let header = "<https://huggingface.co/api/models?cursor=older>; rel=\"prev\", <https://huggingface.co/api/models?cursor=newer>; rel=\"next\"";
        assert_eq!(
            next_link(header).as_deref(),
            Some("https://huggingface.co/api/models?cursor=newer")
        );
    }
}
