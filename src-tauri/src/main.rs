// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer (2.42+) draws a blank or white window,
    // or crashes, on NVIDIA's proprietary driver - the most common "Textus
    // opens empty" report on Linux. Falling back to the older renderer costs
    // little for a text editor. Only on NVIDIA, and never over a value the
    // user set themselves. Set before any thread exists, which is what makes
    // set_var sound here.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
    {
        // SAFETY: first statement of main, single-threaded.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    textus_lib::run()
}
