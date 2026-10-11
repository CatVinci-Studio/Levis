import { isIOSApp } from "./capabilities";

/**
 * Stops WebKit on iOS zooming the page into a field whose text is under
 * 16px when it takes focus - every input in the app - and leaving it
 * zoomed afterwards. maximum-scale only does that on iOS; pinch-to-zoom
 * stays available.
 *
 * The keyboard itself is handled natively: the web view is shortened by
 * the height it covers (plugins/levis-files, KeyboardFit.swift), so the
 * page never has to scroll out from under it.
 */
export function installMobileViewport(): void {
  if (!isIOSApp) return;
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0",
    );
}
