import UIKit
import WebKit

// Keeps the web view out from under the on-screen keyboard.
//
// WKWebView does not resize its page for the keyboard: it shrinks the
// visual viewport and scrolls the whole document up to keep the caret in
// view, which carries the app's title row off the top of the screen and
// leaves the page sitting high after the keyboard is gone. Shortening the
// view itself instead means the page is simply a shorter page while the
// keyboard is up, laid out by the same CSS as any other window size.
//
// Lives in this package because it is the app's only native code; the
// plugin starts it from load(webview:).
final class KeyboardFit {
  private weak var webview: WKWebView?
  private var observer: NSObjectProtocol?

  init(webview: WKWebView) {
    self.webview = webview
    // No scroll-into-view of a page that already fits.
    webview.scrollView.isScrollEnabled = false
    observer = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillChangeFrameNotification,
      object: nil,
      queue: .main
    ) { [weak self] note in
      self?.fit(note)
    }
  }

  deinit {
    if let observer = observer {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  private func fit(_ note: Notification) {
    guard let webview = webview, let host = webview.superview,
      let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
    else { return }
    // How much of the host the keyboard covers once it has moved (zero
    // when it is leaving, or is a floating/hardware-keyboard bar).
    let keyboard = host.convert(end, from: nil)
    let covered = max(0, host.bounds.maxY - keyboard.minY)
    // Shows for a moment below the shortened view as the keyboard moves.
    host.backgroundColor = .systemBackground
    var frame = host.bounds
    frame.size.height -= covered
    let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
    UIView.animate(withDuration: duration) {
      webview.frame = frame
    }
    webview.scrollView.contentOffset = .zero
  }
}
