//! Pages of ours the app opens in the system browser. Each URL is fixed
//! here rather than passed in, so the frontend can't send the browser
//! anywhere else.

/// The CatVinci Studio Discord server, through the website's redirect: a
/// changed invite then needs no app update.
pub const COMMUNITY_URL: &str = "https://textus.catvinci.com/discord";

pub fn open_community(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(COMMUNITY_URL, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Help > Discord Community, and its row in Settings.
#[tauri::command]
pub async fn open_community_page(app: tauri::AppHandle) -> Result<(), String> {
    open_community(&app)
}
