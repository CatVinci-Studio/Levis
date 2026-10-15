// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-textus-files",
  // Matches bundle.iOS.minimumSystemVersion; the string form, since
  // tools 5.3 has no .v16 constant.
  platforms: [.iOS("16.0")],
  products: [
    .library(name: "tauri-plugin-textus-files", type: .static, targets: ["tauri-plugin-textus-files"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-textus-files",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources")
  ]
)
