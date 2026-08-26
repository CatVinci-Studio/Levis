//! Uploads pasted editor images to a user-configured HTTP image host.
//! The endpoint contract is intentionally small: multipart/form-data with a
//! `file` part, an optional bearer token, and either a plain URL response or
//! JSON containing the URL at a configured dot-separated field path.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::auth::keys::load_provider_key;

const CREDENTIAL_ID: &str = "__image_host";
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Serialize)]
pub struct UploadedImage {
    src: String,
}

fn response_url(value: &Value, path: &str) -> Option<String> {
    let mut current = value;
    for segment in path.split('.').filter(|part| !part.is_empty()) {
        current = current.get(segment)?;
    }
    current.as_str().map(str::to_owned)
}

fn valid_public_url(value: &str) -> bool {
    reqwest::Url::parse(value)
        .map(|url| matches!(url.scheme(), "http" | "https"))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn upload_image(
    app: AppHandle,
    data_base64: String,
    mime: String,
    filename: String,
    endpoint: String,
    url_field: String,
) -> Result<UploadedImage, String> {
    let endpoint = endpoint.trim();
    let parsed_endpoint = reqwest::Url::parse(endpoint).map_err(|_| "invalid upload URL")?;
    if !matches!(parsed_endpoint.scheme(), "http" | "https") {
        return Err("upload URL must use http or https".to_string());
    }
    if filename.is_empty() || filename.contains(['/', '\\']) || filename == "." || filename == ".."
    {
        return Err("invalid image filename".to_string());
    }

    let bytes = STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("image is empty or exceeds the 25 MB limit".to_string());
    }

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str(&mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let client = reqwest::Client::new();
    let mut request = client.post(parsed_endpoint).multipart(form);
    if let Some(token) = load_provider_key(&app, CREDENTIAL_ID)? {
        request = request.bearer_auth(token);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("image host returned {status}: {}", body.trim()));
    }

    let trimmed = body.trim();
    let src = if valid_public_url(trimmed) {
        trimmed.to_string()
    } else {
        let json: Value = serde_json::from_str(trimmed)
            .map_err(|_| "image host response is neither a URL nor valid JSON".to_string())?;
        response_url(&json, url_field.trim())
            .ok_or_else(|| format!("image URL field `{}` was not found", url_field.trim()))?
    };
    if !valid_public_url(&src) {
        return Err("image host returned an invalid public URL".to_string());
    }
    Ok(UploadedImage { src })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_nested_response_url() {
        let value = serde_json::json!({"data": {"image": {"url": "https://img.test/a.png"}}});
        assert_eq!(
            response_url(&value, "data.image.url").as_deref(),
            Some("https://img.test/a.png")
        );
    }

    #[test]
    fn accepts_only_web_urls() {
        assert!(valid_public_url("https://img.test/a.png"));
        assert!(!valid_public_url("file:///tmp/a.png"));
        assert!(!valid_public_url("not a url"));
    }
}
