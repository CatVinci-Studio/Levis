import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

// Document access outside the app's own folder (see src/lib.rs).
//
// Every file or folder the user picks is remembered as a bookmark, keyed by
// its URL. A read or write of any URL inside a remembered folder (or of a
// remembered file) opens that root's security scope for the duration of
// the operation, coordinated with iCloud through NSFileCoordinator.

struct UrlArgs: Decodable {
  let url: String
}

struct WriteArgs: Decodable {
  let url: String
  let text: String
}

struct PickArgs: Decodable {
  var allowedExtensions: [String]?
}

private let bookmarksKey = "levis.bookmarks"

class LevisFilesPlugin: Plugin, UIDocumentPickerDelegate {
  private var pending: Invoke?
  private var pickingFolder = false

  // MARK: Bookmarks

  private func loadBookmarks() -> [String: Data] {
    UserDefaults.standard.dictionary(forKey: bookmarksKey) as? [String: Data] ?? [:]
  }

  private func saveBookmarks(_ marks: [String: Data]) {
    UserDefaults.standard.set(marks, forKey: bookmarksKey)
  }

  private func remember(_ url: URL) {
    guard let data = try? url.bookmarkData(
      options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    else { return }
    var marks = loadBookmarks()
    marks[url.absoluteString] = data
    saveBookmarks(marks)
  }

  /// The remembered root (file or folder) that grants access to `target`,
  /// resolved fresh - a bookmark can go stale when the item moves.
  private func scopeRoot(for target: URL) -> URL? {
    let path = target.standardizedFileURL.path
    var marks = loadBookmarks()
    var best: URL?
    for (key, data) in marks {
      var stale = false
      guard let url = try? URL(
        resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      else { continue }
      if stale, let fresh = try? url.bookmarkData(
        options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
      {
        marks[key] = fresh
      }
      let root = url.standardizedFileURL.path
      if path == root || path.hasPrefix(root.hasSuffix("/") ? root : root + "/") {
        if best == nil || root.count > best!.standardizedFileURL.path.count { best = url }
      }
    }
    saveBookmarks(marks)
    return best
  }

  /// Runs `body` with the security scope of whatever grants `url` open.
  private func withAccess<T>(to url: URL, _ body: () throws -> T) throws -> T {
    let root = scopeRoot(for: url) ?? url
    let opened = root.startAccessingSecurityScopedResource()
    defer { if opened { root.stopAccessingSecurityScopedResource() } }
    return try body()
  }

  // MARK: Pickers

  private func present(_ picker: UIDocumentPickerViewController, _ invoke: Invoke) {
    pending = invoke
    picker.delegate = self
    DispatchQueue.main.async {
      self.manager.viewController?.present(picker, animated: true)
    }
  }

  @objc public func pickDocument(_ invoke: Invoke) throws {
    let args = (try? invoke.parseArgs(PickArgs.self)) ?? PickArgs()
    let types = (args.allowedExtensions ?? ["md", "markdown", "txt"])
      .compactMap { UTType(filenameExtension: $0) }
    pickingFolder = false
    present(UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false), invoke)
  }

  @objc public func pickFolder(_ invoke: Invoke) throws {
    pickingFolder = true
    present(UIDocumentPickerViewController(forOpeningContentTypes: [.folder]), invoke)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pending, let url = urls.first else { return }
    pending = nil
    // Picker URLs are already open for this session; the bookmark is what
    // lets a later launch reopen them.
    let opened = url.startAccessingSecurityScopedResource()
    remember(url)
    if opened { url.stopAccessingSecurityScopedResource() }
    invoke.resolve(["url": url.absoluteString, "name": url.lastPathComponent, "folder": pickingFolder])
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pending?.resolve(["url": NSNull()])
    pending = nil
  }

  // MARK: Reading and writing

  @objc public func readText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    do {
      let text: String = try withAccess(to: url) {
        var result: Result<String, Error> = .failure(CocoaError(.fileReadUnknown))
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { u in
          result = Result { try String(contentsOf: u, encoding: .utf8) }
        }
        if let coordError = coordError { throw coordError }
        return try result.get()
      }
      invoke.resolve(["text": text])
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc public func writeText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WriteArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    do {
      try withAccess(to: url) {
        var writeError: Error?
        var coordError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { u in
          do { try args.text.write(to: u, atomically: true, encoding: .utf8) } catch { writeError = error }
        }
        if let error = coordError ?? writeError { throw error }
      }
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc public func listFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    do {
      let entries: [[String: Any]] = try withAccess(to: url) {
        let items = try FileManager.default.contentsOfDirectory(
          at: url, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
        return items.map { item in
          let dir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
          return ["url": item.absoluteString, "name": item.lastPathComponent, "folder": dir == true]
        }
      }
      invoke.resolve(["entries": entries])
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  // MARK: A folder for the whole session

  private var openScopes: [String: URL] = [:]

  /// Opens a remembered folder's scope until the app quits and returns its
  /// plain path. A scope covers the whole process, so the Rust side (the
  /// project folder the AI reads, .levis/style.md and library/) then reads
  /// it with ordinary file calls.
  @objc public func beginAccess(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url) else { return invoke.reject("Invalid URL") }
    let root = scopeRoot(for: url) ?? url
    if openScopes[root.absoluteString] == nil {
      guard root.startAccessingSecurityScopedResource() else {
        return invoke.reject("Access to this folder has expired. Choose it again.")
      }
      openScopes[root.absoluteString] = root
    }
    invoke.resolve(["path": url.path])
  }

  // MARK: Remembered items

  @objc public func remembered(_ invoke: Invoke) throws {
    let items = loadBookmarks().compactMap { (_, data) -> [String: Any]? in
      var stale = false
      guard let url = try? URL(
        resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      else { return nil }
      return ["url": url.absoluteString, "name": url.lastPathComponent, "folder": url.hasDirectoryPath]
    }
    invoke.resolve(["items": items])
  }

}

@_cdecl("init_plugin_levis_files")
func initPlugin() -> Plugin {
  return LevisFilesPlugin()
}
