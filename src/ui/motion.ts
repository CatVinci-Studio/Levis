/**
 * Motion that CSS cannot express on its own - FLIP (ui/flip.ts), the AI
 * sheet under a finger, smooth scrolling - reads its timing from here, so
 * it follows the same tokens (motion.css) and the same switches as the
 * stylesheet does.
 *
 * Everything degrades to "no movement": reduced motion, an engine without
 * the Web Animations API, a stylesheet that switched animation off (the
 * e2e helpers), or an easing the engine doesn't know.
 */

export type DurationToken =
  | "--dur-instant"
  | "--dur-fast"
  | "--dur-base"
  | "--dur-medium"
  | "--dur-slow"
  | "--dur-sheet";

export type EasingToken =
  | "--ease-standard"
  | "--ease-out"
  | "--ease-in"
  | "--ease-in-out"
  | "--ease-spring"
  | "--ease-spring-bouncy";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** The defaults in motion.css, for when the stylesheet can't be read. */
const DURATIONS: Record<DurationToken, number> = {
  "--dur-instant": 80,
  "--dur-fast": 120,
  "--dur-base": 200,
  "--dur-medium": 250,
  "--dur-slow": 320,
  "--dur-sheet": 450,
};

/** The cubic fallbacks: what an engine without linear() runs (motion.css
 *  declares the same pairs). */
const CUBIC: Record<EasingToken, string> = {
  "--ease-standard": "cubic-bezier(0.25, 0.1, 0.25, 1)",
  "--ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "--ease-in-out": "cubic-bezier(0.45, 0, 0.25, 1)",
  "--ease-spring": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--ease-spring-bouncy": "cubic-bezier(0.34, 1.3, 0.64, 1)",
};

/** Whether the system asks for reduced motion. Read live: the setting can
 *  change while the app is open. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCE_QUERY).matches
  );
}

let probe: HTMLElement | null = null;

/** True where a stylesheet has switched CSS animation off wholesale - the
 *  e2e helpers' `animation: none !important` - read through an element
 *  whose own rule (motion.css) gives it an animation. Movement driven from
 *  script stands still there too, so a test sees the same final states the
 *  stylesheet shows it. An engine that computes no animation at all (jsdom)
 *  counts as off. */
function stylesheetDisablesAnimation(): boolean {
  if (typeof document === "undefined" || !document.body) return true;
  if (!probe || !probe.isConnected) {
    probe = document.createElement("div");
    probe.className = "motion-probe";
    probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
  }
  const name = getComputedStyle(probe).animationName;
  return !name || name === "none";
}

let allowed: boolean | null = null;

/** Whether script-driven movement may run at all. Answered once per task:
 *  a FLIP asks for every element it moves. */
export function motionAllowed(): boolean {
  if (allowed === null) {
    allowed = !prefersReducedMotion() && !stylesheetDisablesAnimation();
    queueMicrotask(() => {
      allowed = null;
    });
  }
  return allowed;
}

function readToken(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** A duration token in milliseconds, as the stylesheet currently has it
 *  (reduced motion shortens the slow ones). */
export function duration(token: DurationToken): number {
  const raw = readToken(token);
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return DURATIONS[token];
  return raw.endsWith("ms") ? value : value * 1000;
}

/** An easing token's current value: the linear() spring where the engine
 *  has it, else its cubic-bezier. */
export function easing(token: EasingToken): string {
  return readToken(token) || CUBIC[token];
}

/**
 * `el.animate`, with the easing named by token. A linear() string makes
 * Safari before 17.2 throw a TypeError, so that retries with the cubic
 * fallback. Returns null where nothing should move (see motionAllowed) or
 * the engine has no Web Animations API.
 */
export function animate(
  el: Element,
  keyframes: Keyframe[],
  options: {
    duration: DurationToken | number;
    easing: EasingToken;
    delay?: number;
    fill?: FillMode;
    id?: string;
  },
): Animation | null {
  if (typeof el.animate !== "function" || !motionAllowed()) return null;
  const timing: KeyframeAnimationOptions = {
    duration:
      typeof options.duration === "number"
        ? options.duration
        : duration(options.duration),
    easing: easing(options.easing),
    delay: options.delay,
    fill: options.fill,
    id: options.id,
  };
  try {
    return el.animate(keyframes, timing);
  } catch {
    try {
      return el.animate(keyframes, {
        ...timing,
        easing: CUBIC[options.easing],
      });
    } catch {
      return null;
    }
  }
}

/** "smooth" unless motion is reduced - for scrollIntoView and scrollTo. */
export function scrollBehavior(): ScrollBehavior {
  return motionAllowed() ? "smooth" : "auto";
}
