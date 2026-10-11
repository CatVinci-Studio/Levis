// The command list is also the permission list (permissions/default.toml
// allows them all). Each one is a method of LevisFilesPlugin.swift.
const COMMANDS: &[&str] = &[
    "pick_document",
    "pick_folder",
    "read_text",
    "write_text",
    "list_folder",
    "remembered",
    "forget",
    "begin_access",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
