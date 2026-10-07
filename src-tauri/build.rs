fn main() {
    // src/distribution.rs reads this with option_env!. Without this line a
    // cached build would keep the channel of whichever build ran first.
    println!("cargo:rerun-if-env-changed=LEVIS_DISTRIBUTION");
    tauri_build::build()
}
