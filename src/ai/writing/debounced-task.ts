/// Debounce + "am I still the latest call" guarding shared by the
/// ghost-text and grammar-check editor plugins: both debounce an AI request
/// behind typing, then need to discard the response if a newer keystroke
/// scheduled another request while this one was in flight.
export function createDebouncedTask(delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  function cancel() {
    if (timer) clearTimeout(timer);
  }

  /// Cancels any pending call and schedules `fn` to run after `delayMs`.
  /// `fn` receives `isCurrent()`, which returns false if a later `schedule`
  /// call has superseded this one by the time `fn` checks (typically after
  /// an `await`).
  function schedule(fn: (isCurrent: () => boolean) => void | Promise<void>) {
    cancel();
    const mySeq = ++seq;
    timer = setTimeout(() => {
      void fn(() => mySeq === seq);
    }, delayMs);
  }

  return { schedule, cancel };
}
