//! iOS document access for Levis.
//!
//! An iOS app can't open arbitrary paths: a file or folder the user picks in
//! the Files app arrives as a security-scoped URL that has to be opened for
//! access around every read and write, through a file coordinator (iCloud
//! may be syncing it), and that must be saved as a bookmark to survive a
//! relaunch. That is native work, so it lives in
//! `ios/Sources/LevisFilesPlugin.swift`; this crate only forwards the
//! frontend's calls to it.
//!
//! Files in the app's own Documents folder (shown in Files as "On My
//! iPhone > Levis") don't need any of this and keep using the app's
//! ordinary Rust file commands.
//!
//! Registered on iOS only (see the app's lib.rs); desktop never loads it.

#[cfg(target_os = "ios")]
mod ios {
    use serde_json::Value;
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        AppHandle, Manager, Runtime,
    };

    tauri::ios_plugin_binding!(init_plugin_levis_files);

    struct Native<R: Runtime>(PluginHandle<R>);

    /// Calls a method of the Swift plugin with the command's arguments as they
    /// came from the frontend, and hands its answer straight back.
    fn forward<R: Runtime>(app: &AppHandle<R>, method: &str, args: Value) -> Result<Value, String> {
        app.state::<Native<R>>()
            .0
            .run_mobile_plugin::<Value>(method, args)
            .map_err(|err| err.to_string())
    }

    macro_rules! forwarded {
        ($($name:ident => $method:literal),* $(,)?) => {
            $(
                #[tauri::command]
                async fn $name<R: Runtime>(app: AppHandle<R>, args: Option<Value>) -> Result<Value, String> {
                    forward(&app, $method, args.unwrap_or(Value::Null))
                }
            )*
        };
    }

    forwarded! {
        pick_document => "pickDocument",
        pick_folder => "pickFolder",
        read_text => "readText",
        write_text => "writeText",
        list_folder => "listFolder",
        remembered => "remembered",
        begin_access => "beginAccess",
    }

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("levis-files")
            .invoke_handler(tauri::generate_handler![
                pick_document,
                pick_folder,
                read_text,
                write_text,
                list_folder,
                remembered,
                begin_access
            ])
            .setup(|app, api| {
                let handle = api.register_ios_plugin(init_plugin_levis_files)?;
                app.manage(Native(handle));
                Ok(())
            })
            .build()
    }
}

#[cfg(target_os = "ios")]
pub use ios::init;
