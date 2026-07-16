//! The native menu bar: construction (install), the id -> frontend-event
//! dispatch, and the mutable File > Open Recent submenu. Menu ids that carry
//! a payload do it in the id string ("recent:<path>", "export-pandoc:<fmt>",
//! "help-doc:<doc>", "insert-block:<kind>"); the frontend listener for each
//! menu-* event lives in App.tsx.

use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{Emitter, EventTarget, Manager};

use crate::app_identity;
use crate::commands;
use crate::tab_drag::DRAG_PILL_LABEL;

const SETTINGS_MENU_ID: &str = "settings";
const NEW_FILE_ID: &str = "new-file";
const OPEN_FILE_ID: &str = "open-file";
const SAVE_FILE_ID: &str = "save-file";
const SAVE_FILE_AS_ID: &str = "save-file-as";
const RECENT_CLEAR_ID: &str = "recent-clear";
/// Menu ids of File > Open Recent entries carry their path: "recent:<path>".
const RECENT_PREFIX: &str = "recent:";
const EXPORT_PDF_ID: &str = "export-pdf";
const EXPORT_HTML_ID: &str = "export-html";
/// Menu ids of pandoc-backed File > Export entries carry the pandoc writer
/// name: "export-pandoc:<format>". The format list must stay in step with
/// the frontend's PANDOC_FORMATS (src/export-doc.ts).
const EXPORT_PANDOC_PREFIX: &str = "export-pandoc:";
const QUIT_ID: &str = "quit";
const CLOSE_TAB_ID: &str = "close-tab";
const CLOSE_WINDOW_ID: &str = "close-window";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";
const ZOOM_IN_ID: &str = "zoom-in";
const ZOOM_OUT_ID: &str = "zoom-out";
const ZOOM_RESET_ID: &str = "zoom-reset";
const FIND_REPLACE_ID: &str = "find-replace";
const NEW_WINDOW_ID: &str = "new-window";
/// Help menu ids carry the bundled doc they open: "help-doc:<doc>", where
/// <doc> is the frontend's HelpDoc id ("markdown" | "agent" | "welcome").
/// "welcome" additionally re-arms the coach-mark tour on the frontend side
/// (see App.tsx's menu-open-help handler) - this string slot doesn't need
/// to change for that, it's just a payload value like any other doc id.
const HELP_DOC_PREFIX: &str = "help-doc:";
/// Format menu ids carry the block kind to insert: "insert-block:<kind>",
/// where <kind> is one of h1..h6, bullet-list, ordered-list, blockquote,
/// code-block, table - matching the frontend's INSERT_BLOCK_EVENT handler.
const INSERT_BLOCK_PREFIX: &str = "insert-block:";

/// Emit a menu event only to the focused window - each window is an
/// independent document, so broadcast semantics would e.g. save every
/// window's document at once. Deliberately `emit_to` (scoped to one
/// webview), not `emit` on a `Window`/`WebviewWindow` handle - the latter
/// looks scoped but actually broadcasts to every window app-wide, same as
/// calling `emit` on the `AppHandle` itself (both go through the same
/// manager-wide `Emitter::emit`; only `emit_to`/`emit_filter` actually
/// target a specific webview).
fn emit_to_focused(app: &tauri::AppHandle, event: &str) {
    emit_to_focused_payload(app, event, ());
}

fn emit_to_focused_payload<S: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: S) {
    if let Some((label, _)) = app.webview_windows().iter().find(|(_, w)| w.is_focused().unwrap_or(false)) {
        let _ = app.emit_to(EventTarget::webview_window(label), event, payload);
    }
}

/// Handle to the File > Open Recent submenu, kept so add_recent_file can
/// rebuild its entries at runtime without touching the rest of the menu.
struct RecentMenu(Mutex<Option<Submenu<tauri::Wry>>>);

fn abbreviate_home(path: &str) -> String {
    if let Ok(home) = std::env::var("HOME") {
        if let Some(rest) = path.strip_prefix(&home) {
            return format!("~{rest}");
        }
    }
    path.to_string()
}

/// Replace the Open Recent submenu's entries with `list` (most recent
/// first). Menus may only be mutated on the main thread, and the caller
/// may be a command on any thread - hence the hop.
pub(crate) fn rebuild_recent_menu(app: &tauri::AppHandle, list: Vec<String>) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(state) = app.try_state::<RecentMenu>() else { return };
        let guard = state.0.lock().unwrap();
        let Some(submenu) = guard.as_ref() else { return };
        if let Ok(items) = submenu.items() {
            for item in items {
                let _ = submenu.remove(&item);
            }
        }
        if list.is_empty() {
            if let Ok(item) = MenuItemBuilder::with_id("recent-none", "No Recent Files").enabled(false).build(&app) {
                let _ = submenu.append(&item);
            }
            return;
        }
        for path in &list {
            if let Ok(item) = MenuItemBuilder::with_id(format!("{RECENT_PREFIX}{path}"), abbreviate_home(path)).build(&app) {
                let _ = submenu.append(&item);
            }
        }
        if let Ok(sep) = PredefinedMenuItem::separator(&app) {
            let _ = submenu.append(&sep);
        }
        if let Ok(item) = MenuItemBuilder::with_id(RECENT_CLEAR_ID, "Clear Menu").build(&app) {
            let _ = submenu.append(&item);
        }
    });
}

/// Build and set the whole menu bar, then register the id -> event dispatch.
/// Called once from setup.
pub(crate) fn install(app: &tauri::App) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…")
        .accelerator("Cmd+,")
        .build(app)?;

    // Custom Quit instead of the predefined one: quitting must give
    // every window's unsaved document its close-confirmation prompt,
    // so it goes through each window's normal close request rather
    // than exiting the process outright.
    let quit_item = MenuItemBuilder::with_id(QUIT_ID, format!("Quit {}", app_identity::APP_NAME))
        .accelerator("Cmd+Q")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, app_identity::APP_NAME)
        .about(None)
        .separator()
        .item(&settings_item)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit_item)
        .build()?;

    let new_file_item = MenuItemBuilder::with_id(NEW_FILE_ID, "New File").accelerator("Cmd+N").build(app)?;
    let open_file_item = MenuItemBuilder::with_id(OPEN_FILE_ID, "Open…").accelerator("Cmd+O").build(app)?;
    // Built empty here; rebuild_recent_menu below fills it from the
    // persisted list and keeps it current as files are opened.
    let open_recent_menu = SubmenuBuilder::new(app, "Open Recent").build()?;
    let save_file_item = MenuItemBuilder::with_id(SAVE_FILE_ID, "Save").accelerator("Cmd+S").build(app)?;
    let save_file_as_item = MenuItemBuilder::with_id(SAVE_FILE_AS_ID, "Save As…")
        .accelerator("Cmd+Shift+S")
        .build(app)?;
    let export_pdf_item = MenuItemBuilder::with_id(EXPORT_PDF_ID, "PDF…")
        .accelerator("Cmd+P")
        .build(app)?;
    let export_html_item = MenuItemBuilder::with_id(EXPORT_HTML_ID, "HTML…").build(app)?;
    let mut export_menu_builder = SubmenuBuilder::new(app, "Export")
        .item(&export_pdf_item)
        .item(&export_html_item)
        .separator();
    // Everything below converts through a user-installed pandoc
    // (commands/export.rs) - same format list Typora offers.
    for (format, label) in [
        ("docx", "Word (.docx)…"),
        ("odt", "OpenDocument (.odt)…"),
        ("rtf", "RTF…"),
        ("epub", "EPUB…"),
        ("latex", "LaTeX…"),
        ("mediawiki", "MediaWiki…"),
        ("rst", "reStructuredText…"),
        ("textile", "Textile…"),
        ("opml", "OPML…"),
    ] {
        let item = MenuItemBuilder::with_id(format!("{EXPORT_PANDOC_PREFIX}{format}"), label).build(app)?;
        export_menu_builder = export_menu_builder.item(&item);
    }
    let export_menu = export_menu_builder.build()?;

    // Cmd+W closes the current tab (not the window - see
    // CLOSE_WINDOW_ID below, which owns Cmd+Shift+W instead).
    let close_tab_item = MenuItemBuilder::with_id(CLOSE_TAB_ID, "Close Tab").accelerator("Cmd+W").build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_file_item)
        .item(&open_file_item)
        .item(&open_recent_menu)
        .separator()
        .item(&save_file_item)
        .item(&save_file_as_item)
        .separator()
        .item(&export_menu)
        .separator()
        .item(&close_tab_item)
        .build()?;

    app.manage(RecentMenu(Mutex::new(Some(open_recent_menu))));
    rebuild_recent_menu(app.handle(), commands::recents::read_recent_files(app.handle()));

    // No fixed accelerator - the combo is user-configurable and
    // handled by the frontend keydown dispatcher (see
    // toggle_source_mode_item's comment below for why).
    let find_replace_item = MenuItemBuilder::with_id(FIND_REPLACE_ID, "Find & Replace…").build(app)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find_replace_item)
        .build()?;

    let mut format_menu_builder = SubmenuBuilder::new(app, "Format");
    for (kind, label) in [
        ("h1", "Heading 1"),
        ("h2", "Heading 2"),
        ("h3", "Heading 3"),
        ("h4", "Heading 4"),
        ("h5", "Heading 5"),
        ("h6", "Heading 6"),
    ] {
        let item = MenuItemBuilder::with_id(format!("{INSERT_BLOCK_PREFIX}{kind}"), label).build(app)?;
        format_menu_builder = format_menu_builder.item(&item);
    }
    format_menu_builder = format_menu_builder.separator();
    for (kind, label) in [
        ("bullet-list", "Bullet List"),
        ("ordered-list", "Numbered List"),
        ("blockquote", "Blockquote"),
        ("code-block", "Code Block"),
        ("table", "Table"),
    ] {
        let item = MenuItemBuilder::with_id(format!("{INSERT_BLOCK_PREFIX}{kind}"), label).build(app)?;
        format_menu_builder = format_menu_builder.item(&item);
    }
    let format_menu = format_menu_builder.build()?;

    // No fixed accelerators on these - their shortcuts are
    // user-configurable and handled by the frontend keydown
    // dispatcher (App.tsx), which reads the current bindings from
    // Settings. A native accelerator here would keep firing on the
    // default combo even after the user rebinds it.
    let toggle_source_mode_item =
        MenuItemBuilder::with_id(TOGGLE_SOURCE_MODE_ID, "Toggle Source Code Mode").build(app)?;
    let toggle_typewriter_mode_item =
        MenuItemBuilder::with_id(TOGGLE_TYPEWRITER_MODE_ID, "Toggle Typewriter Mode").build(app)?;
    let toggle_sidebar_item = MenuItemBuilder::with_id(TOGGLE_SIDEBAR_ID, "Toggle Sidebar").build(app)?;

    // Fixed OS-convention accelerators (like Cmd+S / Cmd+W), not
    // user-configurable ones - so unlike the items above they keep
    // native accelerators. Zoom itself is applied by the frontend
    // (utils/useZoom.ts), which also handles pinch and mod+wheel.
    let zoom_in_item = MenuItemBuilder::with_id(ZOOM_IN_ID, "Zoom In").accelerator("Cmd+=").build(app)?;
    let zoom_out_item = MenuItemBuilder::with_id(ZOOM_OUT_ID, "Zoom Out").accelerator("Cmd+-").build(app)?;
    let zoom_reset_item =
        MenuItemBuilder::with_id(ZOOM_RESET_ID, "Actual Size").accelerator("Cmd+0").build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&toggle_source_mode_item)
        .item(&toggle_typewriter_mode_item)
        .item(&toggle_sidebar_item)
        .separator()
        .item(&zoom_in_item)
        .item(&zoom_out_item)
        .item(&zoom_reset_item)
        .separator()
        .fullscreen()
        .build()?;

    let new_window_item = MenuItemBuilder::with_id(NEW_WINDOW_ID, "New Window")
        .accelerator("Cmd+T")
        .build(app)?;
    // Built manually (not the .close_window() predefined item) so it
    // doesn't own the OS-default Cmd+W accelerator - that's Close
    // Tab's now (see CLOSE_TAB_ID above).
    let close_window_item = MenuItemBuilder::with_id(CLOSE_WINDOW_ID, "Close Window")
        .accelerator("Cmd+Shift+W")
        .build(app)?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&new_window_item)
        .separator()
        .minimize()
        .maximize()
        .separator()
        .item(&close_window_item)
        .separator()
        .bring_all_to_front()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .text(format!("{HELP_DOC_PREFIX}welcome"), "Welcome and Tutorial")
        .separator()
        .text(format!("{HELP_DOC_PREFIX}markdown"), "Markdown Guide")
        .text(format!("{HELP_DOC_PREFIX}agent"), "AI Features Guide")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &format_menu, &view_menu, &window_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app_handle, event| {
        let id = event.id();
        if id == SETTINGS_MENU_ID {
            let _ = app_handle.emit("menu-open-settings", ());
        } else if id == NEW_FILE_ID {
            // Honors the same Settings choice as opening files: a
            // new tab in the focused window in tab mode, a fresh
            // window otherwise (or when there's no window at all).
            if app_handle.webview_windows().is_empty()
                || commands::prefs::read_new_document_mode(app_handle) != "tab"
            {
                let _ = crate::open_new_window(app_handle);
            } else {
                emit_to_focused(app_handle, "menu-new-file");
            }
        } else if id == OPEN_FILE_ID {
            let _ = app_handle.emit("menu-open-file", ());
        } else if id == SAVE_FILE_ID {
            emit_to_focused(app_handle, "menu-save-file");
        } else if id == SAVE_FILE_AS_ID {
            emit_to_focused(app_handle, "menu-save-file-as");
        } else if id == RECENT_CLEAR_ID {
            commands::recents::clear_recent_files(app_handle);
        } else if id.as_ref().starts_with(RECENT_PREFIX) {
            // Routes through the same queue as Finder/CLI opens, so
            // it lands as a tab or a window per the user's setting.
            let path = id.as_ref()[RECENT_PREFIX.len()..].to_string();
            crate::queue_paths_to_open(app_handle, vec![path]);
        } else if id == EXPORT_PDF_ID {
            emit_to_focused(app_handle, "menu-export-pdf");
        } else if id == EXPORT_HTML_ID {
            emit_to_focused(app_handle, "menu-export-html");
        } else if id.as_ref().starts_with(EXPORT_PANDOC_PREFIX) {
            let format = id.as_ref()[EXPORT_PANDOC_PREFIX.len()..].to_string();
            emit_to_focused_payload(app_handle, "menu-export-pandoc", format);
        } else if id == QUIT_ID {
            // close() (not destroy()) so each frontend gets its
            // close-requested prompt; the app exits once the last
            // window actually closes.
            for (_, window) in app_handle.webview_windows() {
                let _ = window.close();
            }
        } else if id.as_ref().starts_with(INSERT_BLOCK_PREFIX) {
            let kind = id.as_ref()[INSERT_BLOCK_PREFIX.len()..].to_string();
            emit_to_focused_payload(app_handle, "menu-insert-block", kind);
        } else if id == TOGGLE_SOURCE_MODE_ID {
            let _ = app_handle.emit("menu-toggle-source-mode", ());
        } else if id == TOGGLE_TYPEWRITER_MODE_ID {
            let _ = app_handle.emit("menu-toggle-typewriter-mode", ());
        } else if id == TOGGLE_SIDEBAR_ID {
            let _ = app_handle.emit("menu-toggle-sidebar", ());
        } else if id == FIND_REPLACE_ID {
            emit_to_focused(app_handle, "menu-find-replace");
        } else if id == ZOOM_IN_ID {
            emit_to_focused(app_handle, "menu-zoom-in");
        } else if id == ZOOM_OUT_ID {
            emit_to_focused(app_handle, "menu-zoom-out");
        } else if id == ZOOM_RESET_ID {
            emit_to_focused(app_handle, "menu-zoom-reset");
        } else if id == CLOSE_TAB_ID {
            emit_to_focused(app_handle, "menu-close-tab");
        } else if id == CLOSE_WINDOW_ID {
            // close() (not destroy()) so the frontend's dirty-tab
            // prompt still runs, same as the red traffic-light button.
            if let Some((_, window)) = app_handle.webview_windows().iter().find(|(_, w)| w.is_focused().unwrap_or(false)) {
                let _ = window.close();
            }
        } else if id == NEW_WINDOW_ID {
            let _ = crate::open_new_window(app_handle);
        } else if id.as_ref().starts_with(HELP_DOC_PREFIX) {
            // A help doc opens as a tab in the focused window; with
            // no window to receive it (macOS keeps the app alive
            // windowless), spawn one that drains the pending doc on
            // mount.
            let doc = id.as_ref()[HELP_DOC_PREFIX.len()..].to_string();
            if app_handle.webview_windows().iter().any(|(label, _)| *label != DRAG_PILL_LABEL) {
                emit_to_focused_payload(app_handle, "menu-open-help", doc);
            } else {
                *crate::PENDING_SHOW_HELP.lock().unwrap() = Some(doc);
                let _ = crate::open_new_window(app_handle);
            }
        }
    });

    Ok(())
}
