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

/// Renders a themed document to a PDF file on macOS. On Windows/Linux the
/// frontend calls window.print() instead; macOS can't, because wry's
/// window.print() there drives a broken NSPrintPanel that flashes and
/// self-dismisses (tauri-apps/wry#713, tauri#6202).
///
/// This does not go through NSPrintOperation at all. The print path lays the
/// page out at a size that depends on the selected printer's imageable area,
/// and never paints an @page margin - so a themed background either stopped
/// in white bands at every page edge, or, with zero margins, text ran flush
/// into each page seam. Instead the frontend lays the document out at A4
/// width with its own page margins (export-paginate.ts), this renders it with
/// WKWebView's createPDF at exactly 1 CSS px = 1 pt, and PDFKit cuts that one
/// tall page into A4 sheets. WKWebView is main-thread-only, so this
/// dispatches there and waits for the file to be written.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn export_pdf_native(
    app: tauri::AppHandle,
    html: String,
    base_dir: Option<String>,
    output_path: String,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        pdf_macos::start_pdf_export(html, base_dir, output_path, tx);
    })
    .map_err(|e| e.to_string())?;
    // Bounded wait so a hung render can never leave the frontend spinner stuck.
    match tokio::task::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(60)))
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
    _output_path: String,
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

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadOnly, Message};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{
        MainThreadMarker, NSCopying, NSData, NSError, NSNumber, NSObjectProtocol, NSString, NSURL,
    };
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};
    use objc2_web_kit::{
        WKContentWorld, WKNavigation, WKNavigationDelegate, WKPDFConfiguration, WKWebView,
        WKWebViewConfiguration,
    };

    // A4 in PostScript points (1pt = 1/72"); createPDF renders 1 CSS px as 1pt,
    // so this is also the page in CSS px. Mirrored by PDF_PAGE_WIDTH/HEIGHT in
    // src/export-paginate.ts, which lays the document out at this size - change
    // both together.
    const PAPER_WIDTH: f64 = 595.0;
    const PAPER_HEIGHT: f64 = 842.0;

    // Runs in the loaded page before rendering: fonts and images must have
    // settled, or the PDF captures fallback glyphs and empty boxes. Returns
    // the document height, which decides the page count.
    const SETTLE_JS: &str = "await document.fonts.ready; \
        await Promise.all(Array.from(document.images).map(i => \
          i.complete ? null : i.decode().catch(() => null))); \
        return document.documentElement.scrollHeight;";

    // Keeps the offscreen webview and its delegate alive from load until the
    // file is written. navigationDelegate is weak and the dispatch that starts
    // the export returns immediately, so without this the graph would drop
    // mid-flight.
    struct Pending {
        _webview: Retained<WKWebView>,
        _delegate: Retained<PdfExporter>,
    }

    thread_local! {
        static PENDING: RefCell<HashMap<usize, Pending>> = RefCell::new(HashMap::new());
        static NEXT_ID: Cell<usize> = const { Cell::new(0) };
    }

    struct PdfExporterIvars {
        id: usize,
        output_path: String,
        result_tx: Sender<Result<(), String>>,
        // The channel is signalled once; `signalled` guards against a second
        // send (a late navigation callback after a failure, say).
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
                self.settle_then_render(webview);
            }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: &WKNavigation,
                error: &NSError,
            ) {
                self.finish(Err(format!(
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
                self.finish(Err(format!(
                    "Failed to load page: {}",
                    error.localizedDescription()
                )));
            }
        }
    );

    impl PdfExporter {
        fn settle_then_render(&self, webview: &WKWebView) {
            if self.ivars().signalled.get() {
                return;
            }
            let Some(mtm) = MainThreadMarker::new() else {
                self.finish(Err("PDF export left the main thread".to_string()));
                return;
            };
            let this = self.retain();
            let view = webview.retain();
            let handler = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
                if !error.is_null() {
                    // SAFETY: WebKit passes a valid NSError when non-null.
                    let message = unsafe { (*error).localizedDescription() };
                    this.finish(Err(format!("Failed to prepare page: {message}")));
                    return;
                }
                // SAFETY: a JS number arrives as an NSNumber.
                let height = unsafe { result.cast::<NSNumber>().as_ref() }
                    .map(|n| n.doubleValue())
                    .unwrap_or(PAPER_HEIGHT);
                let pages = ((height / PAPER_HEIGHT).ceil() as usize).max(1);
                this.render(&view, pages);
            });
            let world = unsafe { WKContentWorld::pageWorld(mtm) };
            unsafe {
                webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &NSString::from_str(SETTLE_JS),
                    None,
                    None,
                    &world,
                    Some(&handler),
                );
            }
        }

        fn render(&self, webview: &WKWebView, pages: usize) {
            let Some(mtm) = MainThreadMarker::new() else {
                self.finish(Err("PDF export left the main thread".to_string()));
                return;
            };
            let config = unsafe { WKPDFConfiguration::new(mtm) };
            unsafe {
                config.setRect(CGRect {
                    origin: CGPoint::new(0.0, 0.0),
                    size: CGSize::new(PAPER_WIDTH, PAPER_HEIGHT * pages as f64),
                });
            }
            let this = self.retain();
            let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                // SAFETY: WebKit passes valid objects when non-null.
                let result = match (unsafe { data.as_ref() }, unsafe { error.as_ref() }) {
                    (Some(data), _) => this.write_pages(data, pages),
                    (None, Some(error)) => Err(format!(
                        "Failed to render PDF: {}",
                        error.localizedDescription()
                    )),
                    (None, None) => Err("Failed to render PDF".to_string()),
                };
                this.finish(result);
            });
            unsafe {
                webview.createPDFWithConfiguration_completionHandler(Some(&config), &handler);
            }
        }

        // Cuts the single tall rendered page into A4 sheets. Each sheet is a
        // copy of the tall page with its media and crop boxes moved to one
        // window of it (PDF space starts at the bottom left, so sheet i is
        // counted down from the top).
        fn write_pages(&self, data: &NSData, pages: usize) -> Result<(), String> {
            let source = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), data) }
                .ok_or("Rendered PDF could not be read")?;
            let tall = unsafe { source.pageAtIndex(0) }.ok_or("Rendered PDF is empty")?;
            let bounds = unsafe { tall.boundsForBox(PDFDisplayBox::MediaBox) };
            let top = bounds.origin.y + bounds.size.height;
            let output = unsafe { PDFDocument::new() };
            for i in 0..pages {
                let sheet = tall.copy();
                let rect = CGRect {
                    origin: CGPoint::new(bounds.origin.x, top - PAPER_HEIGHT * (i + 1) as f64),
                    size: CGSize::new(PAPER_WIDTH, PAPER_HEIGHT),
                };
                unsafe {
                    sheet.setBounds_forBox(rect, PDFDisplayBox::MediaBox);
                    sheet.setBounds_forBox(rect, PDFDisplayBox::CropBox);
                    output.insertPage_atIndex(&sheet, i);
                }
            }
            let path = NSString::from_str(&self.ivars().output_path);
            if unsafe { output.writeToFile(&path) } {
                Ok(())
            } else {
                Err(format!("Could not write {}", self.ivars().output_path))
            }
        }

        // Sends the one-shot result and drops this export's webview + delegate.
        // Retains self first: the PENDING map holds our only strong reference
        // (the webview points back weakly), and we may be inside a delegate
        // method, so removing our own entry would otherwise be a use-after-free.
        fn finish(&self, result: Result<(), String>) {
            let _keep = self.retain();
            if !self.ivars().signalled.replace(true) {
                let _ = self.ivars().result_tx.send(result);
            }
            let id = self.ivars().id;
            PENDING.with(|pending| {
                pending.borrow_mut().remove(&id);
            });
        }
    }

    pub fn start_pdf_export(
        html: String,
        base_dir: Option<String>,
        output_path: String,
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
        // The paper width: the frontend laid the document out at this width.
        let frame = CGRect {
            origin: CGPoint::new(0.0, 0.0),
            size: CGSize::new(PAPER_WIDTH, PAPER_HEIGHT),
        };
        let webview =
            unsafe { WKWebView::initWithFrame_configuration(mtm.alloc(), frame, &config) };

        let delegate = {
            let this = mtm.alloc::<PdfExporter>().set_ivars(PdfExporterIvars {
                id,
                output_path,
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
