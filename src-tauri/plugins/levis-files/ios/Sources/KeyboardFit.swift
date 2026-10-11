import ObjectiveC
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
  private var observers: [NSObjectProtocol] = []

  init(webview: WKWebView) {
    self.webview = webview
    // No scroll-into-view of a page that already fits, and no rubber band
    // that leaves the page pulled up under the status bar.
    webview.scrollView.isScrollEnabled = false
    webview.scrollView.bounces = false
    Self.hideFormAccessory(in: webview)
    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: UIResponder.keyboardWillChangeFrameNotification,
        object: nil,
        queue: .main
      ) { [weak self] note in
        self?.fit(note)
      })
    // Coming back from another app the keyboard is re-announced and the
    // page may have drifted; settle it again.
    observers.append(
      center.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.pinToTop()
      })
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  /// WebKit puts its form-assistant bar (previous / next field and Done)
  /// on top of the keyboard for any focused field. A document editor has no
  /// "next field", and Levis draws its own toolbar there
  /// (mobile/KeyboardToolbar.tsx), so the content view is given a subclass
  /// whose inputAccessoryView is nil - the standard way to drop that bar,
  /// since WKWebView exposes no setting for it.
  private static func hideFormAccessory(in webview: WKWebView) {
    guard
      let content = webview.scrollView.subviews.first(where: {
        String(describing: type(of: $0)).hasPrefix("WKContent")
      })
    else { return }
    let base: AnyClass = type(of: content)
    let name = "\(base)_LevisNoAccessory"
    var subclass: AnyClass? = NSClassFromString(name)
    if subclass == nil, let made = objc_allocateClassPair(base, name, 0) {
      let nothing: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
      class_addMethod(
        made, #selector(getter: UIResponder.inputAccessoryView),
        imp_implementationWithBlock(nothing), "@@:")
      objc_registerClassPair(made)
      subclass = made
    }
    if let subclass = subclass { object_setClass(content, subclass) }
  }

  /// The page's resting position. Not zero: the scroll view insets the
  /// page below the status bar, so "the top" is minus that inset - an
  /// offset of zero pushed the title row and the text under the clock.
  private func pinToTop() {
    guard let scroll = webview?.scrollView else { return }
    scroll.setContentOffset(
      CGPoint(x: 0, y: -scroll.adjustedContentInset.top), animated: false)
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
    UIView.animate(
      withDuration: duration,
      animations: { webview.frame = frame },
      completion: { [weak self] _ in self?.pinToTop() })
    pinToTop()
  }
}
