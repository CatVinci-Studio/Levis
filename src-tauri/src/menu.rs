//! The native menu bar: construction (install), the id -> frontend-event
//! dispatch, and the mutable File > Open Recent submenu. Menu ids that carry
//! a payload do it in the id string ("recent:<path>", "export-pandoc:<fmt>",
//! "help-doc:<doc>", "insert-block:<kind>"); the frontend listener for each
//! menu-* event lives in App.tsx.
//!
//! On Windows the bar built here is never seen - it is hidden with the
//! window frame and kept only for its accelerators, and the menu the user
//! opens is drawn in HTML (src/ui/app-menu-model.ts, which lists the same
//! ids) and comes back through `trigger_menu_item`. Renaming an id here
//! means renaming it there.

use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{Emitter, EventTarget, Manager};

use crate::app_identity;
use crate::commands;

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

fn emit_to_focused_payload<S: serde::Serialize + Clone>(
    app: &tauri::AppHandle,
    event: &str,
    payload: S,
) {
    if let Some(label) = focused_editor_window(app) {
        let _ = app.emit_to(EventTarget::webview_window(&label), event, payload);
    }
}

/// The editor window a window-addressed message should go to - menu commands
/// here, and lib.rs's OS-open handling, which has the same "which of several
/// windows means *this* one" question.
///
/// "Focused window" alone is not enough once a detached chat window exists:
/// the chat holds focus for as long as the user is typing in it, but it has
/// no document and subscribes to none of these events, so Save/Open/Export/
/// Find would all quietly do nothing. A focused chat is resolved back to the
/// editor it belongs to; failing that, any editor window is a better target
/// than none.
pub(crate) fn focused_editor_window(app: &tauri::AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    let focused = windows
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone());

    match focused {
        Some(label) if crate::commands::chat_window::is_editor_window(&label) => Some(label),
        Some(label) => app
            .try_state::<crate::commands::chat_window::OpenChatWindows>()
            .zip(app.try_state::<crate::commands::chat_window::LastActiveEditor>())
            .and_then(|(open, last_active)| {
                crate::commands::chat_window::editor_for_chat(&label, &open, &last_active)
            }),
        None => None,
    }
    .or_else(|| {
        windows
            .keys()
            .find(|label| crate::commands::chat_window::is_editor_window(label))
            .cloned()
    })
}

/// Handle to the File > Open Recent submenu, kept so add_recent_file can
/// rebuild its entries at runtime without touching the rest of the menu.
struct RecentMenu(Mutex<Option<Submenu<tauri::Wry>>>);

/// Runs a menu id exactly as clicking that item in the native menu would.
///
/// The way in for the app-drawn menu on Windows (src/ui/AppMenu.tsx): there
/// the native menu bar is hidden and the menu is redrawn in HTML, so its
/// items have no native click to dispatch - they send their id here instead.
/// The ids are the contract between the two, and `dispatch` below is the one
/// implementation both entry points run, so an HTML item can never drift
/// into doing something different from its native twin.
///
/// Ids the HTML menu invents (there is no such native item) are simply not
/// matched by `dispatch` and do nothing, so a typo fails quietly rather than
/// firing the wrong command.
///
/// `command(async)`, like detach_chat_window, and for the same reason: half
/// of what dispatch does is create or close windows, and on Windows doing
/// that from inside the calling webview's own IPC callback - which a plain
/// `command` runs on the main thread - is the re-entrancy that freezes the
/// whole app.
#[tauri::command(async)]
pub fn trigger_menu_item(app: tauri::AppHandle, id: String) {
    dispatch(&app, &id);
}

/// The recent-file list behind File > Open Recent, for the app-drawn menu -
/// the native submenu is filled by `rebuild_recent_menu`, which the HTML one
/// can't read.
#[tauri::command]
pub fn list_recent_files(app: tauri::AppHandle) -> Vec<String> {
    commands::recents::read_recent_files(&app)
}

fn abbreviate_home(path: &str) -> String {
    // Windows has no HOME; without USERPROFILE every recent file there shows
    // its full C:\Users\... prefix and the submenu is unreadable.
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok();
    if let Some(home) = home {
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
        let Some(state) = app.try_state::<RecentMenu>() else {
            return;
        };
        let guard = state.0.lock().unwrap();
        let Some(submenu) = guard.as_ref() else {
            return;
        };
        if let Ok(items) = submenu.items() {
            for item in items {
                let _ = submenu.remove(&item);
            }
        }
        if list.is_empty() {
            if let Ok(item) = MenuItemBuilder::with_id("recent-none", "No Recent Files")
                .enabled(false)
                .build(&app)
            {
                let _ = submenu.append(&item);
            }
            return;
        }
        for path in &list {
            if let Ok(item) =
                MenuItemBuilder::with_id(format!("{RECENT_PREFIX}{path}"), abbreviate_home(path))
                    .build(&app)
            {
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
    // Accelerators below are written "CmdOrCtrl+X", never "Cmd+X". They read
    // the same on macOS - both parse to ⌘ - but muda maps a bare CMD to
    // SUPER, which on Windows is the WINDOWS key. That silently handed our
    // shortcuts to the OS: Cmd+P became Win+P (the projection panel),
    // Cmd+Shift+S became Win+Shift+S (the screenshot tool), and none of them
    // ever reached the app.
    let settings_item = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    // Custom Quit instead of the predefined one: quitting must give
    // every window's unsaved document its close-confirmation prompt,
    // so it goes through each window's normal close request rather
    // than exiting the process outright.
    let quit_item = {
        let builder = MenuItemBuilder::with_id(QUIT_ID, format!("Quit {}", app_identity::APP_NAME));
        // Cmd+Q on macOS, Ctrl+Q on Linux - but Windows has no such combo.
        // There the app is closed with Alt+F4, which the OS delivers on its
        // own, and Ctrl+Q means nothing, so claiming it would only take a
        // shortcut Windows users never aim at Quit. The app-drawn menu
        // advertises Alt+F4 instead (src/ui/app-menu-model.ts).
        #[cfg(not(windows))]
        let builder = builder.accelerator("CmdOrCtrl+Q");
        builder.build(app)?
    };

    let app_menu = {
        let builder = SubmenuBuilder::new(app, app_identity::APP_NAME)
            .about(None)
            .separator()
            .item(&settings_item);
        // Hide / Hide Others / Show All are macOS application-menu concepts.
        // muda still renders them elsewhere, so on Windows they were three
        // entries that did nothing when clicked.
        #[cfg(target_os = "macos")]
        let builder = builder.separator().hide().hide_others().show_all();
        builder.separator().item(&quit_item).build()?
    };

    let new_file_item = MenuItemBuilder::with_id(NEW_FILE_ID, "New File")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_file_item = MenuItemBuilder::with_id(OPEN_FILE_ID, "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    // Built empty here; rebuild_recent_menu below fills it from the
    // persisted list and keeps it current as files are opened.
    let open_recent_menu = SubmenuBuilder::new(app, "Open Recent").build()?;
    let save_file_item = MenuItemBuilder::with_id(SAVE_FILE_ID, "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_file_as_item = MenuItemBuilder::with_id(SAVE_FILE_AS_ID, "Save As…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let export_pdf_item = MenuItemBuilder::with_id(EXPORT_PDF_ID, "PDF…")
        .accelerator("CmdOrCtrl+P")
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
        let item = MenuItemBuilder::with_id(format!("{EXPORT_PANDOC_PREFIX}{format}"), label)
            .build(app)?;
        export_menu_builder = export_menu_builder.item(&item);
    }
    let export_menu = export_menu_builder.build()?;

    // Cmd+W closes the current tab (not the window - see
    // CLOSE_WINDOW_ID below, which owns Cmd+Shift+W instead).
    let close_tab_item = MenuItemBuilder::with_id(CLOSE_TAB_ID, "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

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
    rebuild_recent_menu(
        app.handle(),
        commands::recents::read_recent_files(app.handle()),
    );

    // No fixed accelerator - the combo is user-configurable and
    // handled by the frontend keydown dispatcher (see
    // toggle_source_mode_item's comment below for why).
    let find_replace_item =
        MenuItemBuilder::with_id(FIND_REPLACE_ID, "Find & Replace…").build(app)?;

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
        let item =
            MenuItemBuilder::with_id(format!("{INSERT_BLOCK_PREFIX}{kind}"), label).build(app)?;
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
        let item =
            MenuItemBuilder::with_id(format!("{INSERT_BLOCK_PREFIX}{kind}"), label).build(app)?;
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
    let toggle_sidebar_item =
        MenuItemBuilder::with_id(TOGGLE_SIDEBAR_ID, "Toggle Sidebar").build(app)?;

    // Fixed OS-convention accelerators (like Cmd+S / Cmd+W), not
    // user-configurable ones - so unlike the items above they keep
    // native accelerators. Zoom itself is applied by the frontend
    // (utils/useZoom.ts), which also handles pinch and mod+wheel.
    let zoom_in_item = MenuItemBuilder::with_id(ZOOM_IN_ID, "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out_item = MenuItemBuilder::with_id(ZOOM_OUT_ID, "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset_item = MenuItemBuilder::with_id(ZOOM_RESET_ID, "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;

    let view_menu = {
        let builder = SubmenuBuilder::new(app, "View")
            .item(&toggle_source_mode_item)
            .item(&toggle_typewriter_mode_item)
            .item(&toggle_sidebar_item)
            .separator()
            .item(&zoom_in_item)
            .item(&zoom_out_item)
            .item(&zoom_reset_item);
        // Same story as Hide/Show All and Bring All to Front: muda documents
        // its predefined fullscreen item as unsupported on Windows and
        // Linux, where it renders as an entry that does nothing when
        // clicked. Windows reaches fullscreen through the app-drawn menu
        // instead, which calls the window API directly
        // (src/ui/app-menu-actions.ts).
        #[cfg(target_os = "macos")]
        let builder = builder.separator().fullscreen();
        builder.build()?
    };

    // Cmd+T on macOS. On Windows Ctrl+T is "new tab" in every browser, and
    // this app has tabs - so there New Window takes Ctrl+Shift+N, which is
    // what Explorer, Edge and VS Code all open a window with.
    #[cfg(windows)]
    const NEW_WINDOW_ACCEL: &str = "CmdOrCtrl+Shift+N";
    #[cfg(not(windows))]
    const NEW_WINDOW_ACCEL: &str = "CmdOrCtrl+T";
    let new_window_item = MenuItemBuilder::with_id(NEW_WINDOW_ID, "New Window")
        .accelerator(NEW_WINDOW_ACCEL)
        .build(app)?;
    // Built manually (not the .close_window() predefined item) so it
    // doesn't own the OS-default Cmd+W accelerator - that's Close
    // Tab's now (see CLOSE_TAB_ID above).
    let close_window_item = MenuItemBuilder::with_id(CLOSE_WINDOW_ID, "Close Window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(app)?;

    let window_menu = {
        let builder = SubmenuBuilder::new(app, "Window")
            .item(&new_window_item)
            .separator()
            .minimize()
            .maximize()
            .separator()
            .item(&close_window_item);
        // Same story as Hide/Show All above: "Bring All to Front" is an
        // NSApplication command with no Windows counterpart.
        #[cfg(target_os = "macos")]
        let builder = builder.separator().bring_all_to_front();
        builder.build()?
    };

    let help_menu = SubmenuBuilder::new(app, "Help")
        .text(format!("{HELP_DOC_PREFIX}welcome"), "Welcome and Tutorial")
        .separator()
        .text(format!("{HELP_DOC_PREFIX}markdown"), "Markdown Guide")
        .text(format!("{HELP_DOC_PREFIX}agent"), "AI Features Guide")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app_handle, event| dispatch(app_handle, event.id().as_ref()));

    Ok(())
}

/// What a menu id does. Reached from a native menu click (`on_menu_event`
/// above) and from the app-drawn menu's `trigger_menu_item`, so both entry
/// points stay one behaviour.
fn dispatch(app_handle: &tauri::AppHandle, id: &str) {
    if id == SETTINGS_MENU_ID {
        emit_to_focused(app_handle, "menu-open-settings");
    } else if id == NEW_FILE_ID {
        // Honors the same Settings choice as opening files: a new tab in the
        // focused window in tab mode, a fresh window otherwise (or when
        // there's no window at all).
        if app_handle.webview_windows().is_empty()
            || commands::prefs::read_new_document_mode(app_handle) != "tab"
        {
            let _ = crate::open_new_window(app_handle);
        } else {
            emit_to_focused(app_handle, "menu-new-file");
        }
    } else if id == OPEN_FILE_ID {
        emit_to_focused(app_handle, "menu-open-file");
    } else if id == SAVE_FILE_ID {
        emit_to_focused(app_handle, "menu-save-file");
    } else if id == SAVE_FILE_AS_ID {
        emit_to_focused(app_handle, "menu-save-file-as");
    } else if id == RECENT_CLEAR_ID {
        commands::recents::clear_recent_files(app_handle);
    } else if let Some(path) = id.strip_prefix(RECENT_PREFIX) {
        // Routes through the same queue as Finder/CLI opens, so it lands as
        // a tab or a window per the user's setting.
        crate::queue_paths_to_open(app_handle, vec![path.to_string()]);
    } else if id == EXPORT_PDF_ID {
        emit_to_focused(app_handle, "menu-export-pdf");
    } else if id == EXPORT_HTML_ID {
        emit_to_focused(app_handle, "menu-export-html");
    } else if let Some(format) = id.strip_prefix(EXPORT_PANDOC_PREFIX) {
        emit_to_focused_payload(app_handle, "menu-export-pandoc", format);
    } else if id == QUIT_ID {
        // close() (not destroy()) so each frontend gets its close-requested
        // prompt; the app exits once the last window actually closes.
        for (_, window) in app_handle.webview_windows() {
            let _ = window.close();
        }
    } else if let Some(kind) = id.strip_prefix(INSERT_BLOCK_PREFIX) {
        emit_to_focused_payload(app_handle, "menu-insert-block", kind);
    } else if id == TOGGLE_SOURCE_MODE_ID {
        emit_to_focused(app_handle, "menu-toggle-source-mode");
    } else if id == TOGGLE_TYPEWRITER_MODE_ID {
        emit_to_focused(app_handle, "menu-toggle-typewriter-mode");
    } else if id == TOGGLE_SIDEBAR_ID {
        emit_to_focused(app_handle, "menu-toggle-sidebar");
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
        // close() (not destroy()) so the frontend's dirty-tab prompt still
        // runs, same as the red traffic-light button.
        if let Some((_, window)) = app_handle
            .webview_windows()
            .iter()
            .find(|(_, w)| w.is_focused().unwrap_or(false))
        {
            let _ = window.close();
        }
    } else if id == NEW_WINDOW_ID {
        let _ = crate::open_new_window(app_handle);
    } else if let Some(doc) = id.strip_prefix(HELP_DOC_PREFIX) {
        // A help doc opens as a tab in the focused window; with no window to
        // receive it (macOS keeps the app alive windowless), spawn one that
        // drains the pending doc on mount.
        if let Some(label) = focused_editor_window(app_handle) {
            let _ = app_handle.emit_to(EventTarget::webview_window(&label), "menu-open-help", doc);
        } else {
            *crate::PENDING_SHOW_HELP.lock().unwrap() = Some(doc.to_string());
            let _ = crate::open_new_window(app_handle);
        }
    }
}
