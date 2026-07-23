use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Pandoc-backed export follows Typora's model: detect a user-installed
/// binary instead of bundling one (pandoc is ~180MB and GPL-licensed; the
/// frontend guides the user to pandoc.org when it's missing).
fn pandoc_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        // Works when the app inherits a shell PATH (e.g. launched via CLI).
        PathBuf::from("pandoc"),
        PathBuf::from("/opt/homebrew/bin/pandoc"),
        PathBuf::from("/usr/local/bin/pandoc"),
        PathBuf::from("/opt/local/bin/pandoc"),
        PathBuf::from("/usr/bin/pandoc"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/pandoc"));
    }
    candidates
}

/// Returns the path of a working pandoc binary, or None. GUI apps launched
/// from Finder don't inherit the shell's PATH, so beyond a plain `pandoc`
/// lookup this probes the usual install locations (Homebrew, MacPorts, the
/// official installer's /usr/local, ~/.local).
#[tauri::command]
pub async fn detect_pandoc() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        for candidate in pandoc_candidates() {
            let works = Command::new(&candidate)
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if works {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

/// Converts the current document text to `format` (a pandoc writer name)
/// via a user-installed pandoc. The markdown is piped through stdin - no
/// temp file - and --resource-path points at the document's folder so
/// relative image srcs (Typora-style assets/...) resolve for formats that
/// embed them (docx, epub, odt).
#[tauri::command]
pub async fn export_via_pandoc(
    pandoc_path: String,
    markdown: String,
    output_path: String,
    format: String,
    resource_dir: Option<String>,
    title: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&pandoc_path);
        cmd.arg("--from")
            // gfm to match the editor's dialect; dollar math and YAML
            // frontmatter are off by default in pandoc's gfm reader but
            // supported in Levis documents.
            .arg("gfm+tex_math_dollars+yaml_metadata_block")
            .arg("--to")
            .arg(&format)
            .arg("--standalone")
            // epub refuses (and standalone latex warns) without a title;
            // the filename stem is what Typora passes too.
            .arg("--metadata")
            .arg(format!("title={title}"))
            .arg("--output")
            .arg(&output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(dir) = &resource_dir {
            cmd.arg("--resource-path").arg(dir);
            cmd.current_dir(dir);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or_else(|| "failed to open pandoc stdin".to_string())?
            .write_all(markdown.as_bytes())
            .map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save dialog for exports - like save_file_dialog but with the target
/// format's name and extension.
#[tauri::command]
pub async fn export_save_dialog(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    ext: String,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&default_name)
            .add_filter(&filter_name, &[ext.as_str()])
            .blocking_save_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn open_pandoc_install_page(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://pandoc.org/installing.html", None::<&str>)
        .map_err(|e| e.to_string())
}

/// Shows the exported file in Finder, so a successful export has visible
/// feedback beyond the dialog closing.
#[tauri::command]
pub async fn reveal_in_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// Shows the system print panel for a themed document, so the user can "Save as
/// PDF" (vector, selectable text) - the cross-platform browser way of exporting
/// a page. On Windows/Linux the frontend just calls window.print(); only macOS
/// needs this native path, because wry's window.print() there drives a broken
/// NSPrintPanel that flashes and self-dismisses (tauri-apps/wry#713,
/// tauri#6202). We load the self-contained themed HTML into a fresh offscreen
/// WKWebView (wry's own webview subclass doesn't respond to
/// printOperationWithPrintInfo:) and drive an NSPrintOperation through the
/// documented async path. WKWebView is main-thread-only, so this dispatches to
/// the main thread and returns once the panel is on screen (or the render
/// failed); the panel then handles saving.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn export_pdf_native(
    app: tauri::AppHandle,
    html: String,
    base_dir: Option<String>,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        pdf_macos::start_pdf_export(html, base_dir, tx);
    })
    .map_err(|e| e.to_string())?;
    // Bounded wait so a hung render can never leave the frontend spinner stuck.
    match tokio::task::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(30)))
        .await
        .map_err(|e| e.to_string())?
    {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err("PDF export timed out".to_string()),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("PDF export ended without a result".to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn export_pdf_native(
    _app: tauri::AppHandle,
    _html: String,
    _base_dir: Option<String>,
) -> Result<(), String> {
    // Non-macOS platforms use the webview's own window.print() from the
    // frontend, so this native path is never invoked there.
    Err("Native PDF export is only used on macOS".to_string())
}

#[cfg(target_os = "macos")]
mod pdf_macos {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadOnly, Message};
    use objc2_app_kit::{NSApplication, NSPrintInfo, NSPrintingPaginationMode};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{MainThreadMarker, NSError, NSObjectProtocol, NSString, NSURL};
    use objc2_web_kit::{WKNavigation, WKNavigationDelegate, WKWebView, WKWebViewConfiguration};

    // A4 in PostScript points (1pt = 1/72") with 0.5" margins - the panel's
    // defaults; the user can still change paper/scale there.
    const PAPER_WIDTH: f64 = 595.0;
    const PAPER_HEIGHT: f64 = 842.0;
    const MARGIN: f64 = 36.0;

    // Keeps the offscreen webview and its delegate alive from load until the
    // print panel is dismissed. navigationDelegate is weak and the dispatch that
    // starts the export returns immediately, so without this the graph would drop
    // mid-flight.
    struct Pending {
        _webview: Retained<WKWebView>,
        _delegate: Retained<PdfExporter>,
    }

    thread_local! {
        static PENDING: RefCell<HashMap<usize, Pending>> = RefCell::new(HashMap::new());
        static NEXT_ID: Cell<usize> = Cell::new(0);
    }

    struct PdfExporterIvars {
        id: usize,
        result_tx: Sender<Result<(), String>>,
        // The channel is signalled once (panel shown, or render failed);
        // `signalled` guards against a second send on a possibly-gone receiver.
        signalled: Cell<bool>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = PdfExporterIvars]
        struct PdfExporter;

        unsafe impl NSObjectProtocol for PdfExporter {}

        unsafe impl WKNavigationDelegate for PdfExporter {
            #[unsafe(method(webView:didFinishNavigation:))]
            fn did_finish_navigation(&self, webview: &WKWebView, _navigation: &WKNavigation) {
                self.present_panel(webview);
            }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: &WKNavigation,
                error: &NSError,
            ) {
                self.fail(format!(
                    "Failed to render page: {}",
                    error.localizedDescription()
                ));
            }

            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn did_fail_provisional_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: &WKNavigation,
                error: &NSError,
            ) {
                self.fail(format!(
                    "Failed to load page: {}",
                    error.localizedDescription()
                ));
            }
        }

        // Async did-run callback for runOperationModalForWindow (not part of any
        // protocol - it lives in its own runtime-exposed impl). Fires when the
        // user dismisses the print panel; the channel is long signalled by then,
        // so this only tears the webview down.
        impl PdfExporter {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn print_operation_did_run(
                &self,
                _operation: *mut AnyObject,
                _success: Bool,
                _context: *mut core::ffi::c_void,
            ) {
                self.cleanup();
            }
        }
    );

    impl PdfExporter {
        // Builds an NSPrintOperation for the loaded webview and shows the system
        // print panel. Per Apple (developer.apple.com/forums/thread/705138), the
        // reliable way to print a WKWebView is the async runOperationModalForWindow
        // (a synchronous runOperation deadlocks its async render), with the
        // operation view's frame set to the paper size (omitting it crashes).
        fn present_panel(&self, webview: &WKWebView) {
            if self.ivars().signalled.get() {
                return;
            }
            let Some(mtm) = MainThreadMarker::new() else {
                self.fail("PDF export left the main thread".to_string());
                return;
            };

            let print_info = NSPrintInfo::new();
            print_info.setPaperSize(CGSize::new(PAPER_WIDTH, PAPER_HEIGHT));
            print_info.setTopMargin(MARGIN);
            print_info.setBottomMargin(MARGIN);
            print_info.setLeftMargin(MARGIN);
            print_info.setRightMargin(MARGIN);
            print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
            print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);

            let operation = unsafe { webview.printOperationWithPrintInfo(&print_info) };
            // Required: without a sized view the operation crashes.
            if let Some(view) = operation.view() {
                view.setFrame(CGRect {
                    origin: CGPoint::new(0.0, 0.0),
                    size: print_info.paperSize(),
                });
            }
            operation.setShowsPrintPanel(true);
            operation.setShowsProgressPanel(true);

            let app = NSApplication::sharedApplication(mtm);
            let Some(window) = app.mainWindow().or_else(|| app.keyWindow()) else {
                self.fail("No window to host the print panel".to_string());
                return;
            };

            // SAFETY: `self` is an NSObject; the print machinery calls our
            // printOperationDidRun:success:contextInfo: on it when done.
            let delegate = unsafe { &*(self as *const Self as *const AnyObject) };
            unsafe {
                operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    &window,
                    Some(delegate),
                    Some(sel!(printOperationDidRun:success:contextInfo:)),
                    core::ptr::null_mut(),
                );
            }
            // Panel is on screen now - let the frontend drop its "preparing"
            // overlay. Saving happens in the panel; teardown waits for did-run.
            self.signal(Ok(()));
        }

        // Sends the one-shot channel result (panel shown, or an error).
        fn signal(&self, result: Result<(), String>) {
            if self.ivars().signalled.replace(true) {
                return;
            }
            let _ = self.ivars().result_tx.send(result);
        }

        // Reports an error and tears down (the render never reached the panel).
        fn fail(&self, message: String) {
            self.signal(Err(message));
            self.cleanup();
        }

        // Drops this export's webview + delegate. Retains self first: the PENDING
        // map holds our only strong reference (the webview points back weakly),
        // and we may be inside a delegate method, so removing our own entry would
        // otherwise be a use-after-free.
        fn cleanup(&self) {
            let _keep = self.retain();
            let id = self.ivars().id;
            PENDING.with(|pending| {
                pending.borrow_mut().remove(&id);
            });
        }
    }

    pub fn start_pdf_export(
        html: String,
        base_dir: Option<String>,
        tx: Sender<Result<(), String>>,
    ) {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("PDF export must run on the main thread".to_string()));
            return;
        };
        let id = NEXT_ID.with(|next| {
            let id = next.get();
            next.set(id.wrapping_add(1));
            id
        });

        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        // Printable width x A4 height, so on-screen wrapping ~ matches print.
        let frame = CGRect {
            origin: CGPoint::new(0.0, 0.0),
            size: CGSize::new(PAPER_WIDTH - 2.0 * MARGIN, PAPER_HEIGHT),
        };
        let webview =
            unsafe { WKWebView::initWithFrame_configuration(mtm.alloc(), frame, &config) };

        let delegate = {
            let this = mtm.alloc::<PdfExporter>().set_ivars(PdfExporterIvars {
                id,
                result_tx: tx,
                signalled: Cell::new(false),
            });
            let this: Retained<PdfExporter> = unsafe { msg_send![super(this), init] };
            this
        };

        let proto = ProtocolObject::from_ref(&*delegate);
        unsafe { webview.setNavigationDelegate(Some(proto)) };

        let ns_html = NSString::from_str(&html);
        let base_url = base_dir
            .as_deref()
            .map(|dir| NSURL::fileURLWithPath(&NSString::from_str(dir)));
        unsafe {
            webview.loadHTMLString_baseURL(&ns_html, base_url.as_deref());
        }

        PENDING.with(|pending| {
            pending.borrow_mut().insert(
                id,
                Pending {
                    _webview: webview,
                    _delegate: delegate,
                },
            );
        });
    }
}
