// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-levis-files",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "tauri-plugin-levis-files", type: .static, targets: ["tauri-plugin-levis-files"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-levis-files",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources")
  ]
)
