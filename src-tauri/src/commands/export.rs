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

/// Renders self-contained, already-themed document HTML to a paginated PDF
/// file. wry's window.print() on macOS drives a broken NSPrintPanel (flashes
/// and self-dismisses - tauri-apps/wry#713, tauri#6202), so instead we load the
/// HTML into a fresh offscreen WKWebView and, once it finishes loading, run a
/// panel-less NSPrintOperation with the job disposition set to "save", writing
/// an A4-paginated PDF to `output_path`. WKWebView is main-thread-only, so the
/// work is dispatched to the main thread and this async command blocks on a
/// channel until the print operation reports its result.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn export_pdf_native(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    base_dir: Option<String>,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        pdf_macos::start_pdf_export(html, output_path, base_dir, tx);
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
    _output_path: String,
    _base_dir: Option<String>,
) -> Result<(), String> {
    Err("Native PDF export is only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
mod pdf_macos {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::sync::mpsc::Sender;

    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly, Message};
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode,
    };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{MainThreadMarker, NSError, NSObjectProtocol, NSString, NSURL};
    use objc2_web_kit::{WKNavigation, WKNavigationDelegate, WKWebView, WKWebViewConfiguration};

    // A4 in PostScript points (1pt = 1/72"), with a 0.5" margin on every side.
    // WKWebView's print operation paginates the document across pages of this
    // geometry, honouring its @media print CSS - unlike createPDF, which only
    // ever yields one continuous page.
    const PAPER_WIDTH: f64 = 595.0;
    const PAPER_HEIGHT: f64 = 842.0;
    const MARGIN: f64 = 36.0;

    // Keeps the webview and its delegate alive until navigation finishes and the
    // PDF is written. WKWebView's navigationDelegate is a weak reference, and the
    // main-thread dispatch that starts the export returns long before the load
    // completes, so without this both would be dropped and nothing would render.
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
        output_path: String,
        result_tx: Sender<Result<(), String>>,
        // Guards against reporting a result twice (e.g. a load failure after a
        // finish), which would send on a channel whose receiver may be gone.
        settled: Cell<bool>,
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
                self.render(webview);
            }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: &WKNavigation,
                error: &NSError,
            ) {
                self.settle(Err(format!(
                    "Failed to render page: {}",
                    error.localizedDescription()
                )));
            }

            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn did_fail_provisional_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: &WKNavigation,
                error: &NSError,
            ) {
                self.settle(Err(format!(
                    "Failed to load page: {}",
                    error.localizedDescription()
                )));
            }
        }
    );

    impl PdfExporter {
        fn render(&self, webview: &WKWebView) {
            if self.ivars().settled.get() {
                return;
            }
            let result = print_webview_to_pdf(webview, &self.ivars().output_path);
            self.settle(result);
        }

        fn settle(&self, result: Result<(), String>) {
            let ivars = self.ivars();
            if ivars.settled.replace(true) {
                return;
            }
            // Retain across the PENDING removal: the map holds our only strong
            // reference (the webview points back weakly), and we're still inside
            // a delegate method, so dropping it now would be a use-after-free.
            let _keep = self.retain();
            let _ = ivars.result_tx.send(result);
            let id = ivars.id;
            PENDING.with(|pending| {
                pending.borrow_mut().remove(&id);
            });
        }
    }

    // Drives an NSPrintOperation on the loaded offscreen webview with both
    // panels suppressed and the job disposition set to "save", writing a
    // paginated PDF to `output_path`. Runs synchronously on the main thread.
    fn print_webview_to_pdf(webview: &WKWebView, output_path: &str) -> Result<(), String> {
        let print_info = NSPrintInfo::new();
        print_info.setPaperSize(CGSize::new(PAPER_WIDTH, PAPER_HEIGHT));
        print_info.setTopMargin(MARGIN);
        print_info.setBottomMargin(MARGIN);
        print_info.setLeftMargin(MARGIN);
        print_info.setRightMargin(MARGIN);
        // Scale to the page width so nothing is clipped horizontally; let height
        // flow across as many pages as the document needs.
        print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        // SAFETY: accessing AppKit's `extern static` job-disposition constant.
        print_info.setJobDisposition(unsafe { NSPrintSaveJob });

        // The output path goes in the print-info dictionary under the
        // save-to-URL key - there's no typed setter for it.
        let url = NSURL::fileURLWithPath(&NSString::from_str(output_path));
        let key = ProtocolObject::from_ref(unsafe { NSPrintJobSavingURL });
        let dict = unsafe { print_info.dictionary() };
        unsafe { dict.setObject_forKey(&url, key) };

        let operation = unsafe { webview.printOperationWithPrintInfo(&print_info) };
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        // Keep it on this (main) thread so runOperation blocks until the file is
        // written, rather than returning while a worker thread is still going.
        operation.setCanSpawnSeparateThread(false);
        if operation.runOperation() {
            Ok(())
        } else {
            Err("The print operation did not complete".to_string())
        }
    }

    pub fn start_pdf_export(
        html: String,
        output_path: String,
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
        // Lay the content out at the printable width so on-screen wrapping lines
        // up with what the print operation paginates.
        let frame = CGRect {
            origin: CGPoint::new(0.0, 0.0),
            size: CGSize::new(PAPER_WIDTH - 2.0 * MARGIN, PAPER_HEIGHT),
        };
        let webview =
            unsafe { WKWebView::initWithFrame_configuration(mtm.alloc(), frame, &config) };

        let delegate = {
            let this = mtm.alloc::<PdfExporter>().set_ivars(PdfExporterIvars {
                id,
                output_path,
                result_tx: tx,
                settled: Cell::new(false),
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
