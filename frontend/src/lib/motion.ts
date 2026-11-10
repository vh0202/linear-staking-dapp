// Motion preferences and the one animation loop that everything on the page shares.

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

let reducedMotionQuery: MediaQueryList | undefined;

/** True when the user asked for reduced motion. False on the server. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  reducedMotionQuery ??= window.matchMedia(REDUCED_MOTION);
  return reducedMotionQuery.matches;
}

/** Calls `listener` whenever the reduced-motion preference changes. Returns the unsubscribe. */
export function onReducedMotionChange(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  reducedMotionQuery ??= window.matchMedia(REDUCED_MOTION);
  const query = reducedMotionQuery;
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

type FrameListener = (nowMs: number) => void;

const frameListeners = new Set<FrameListener>();
let frameHandle: number | undefined;

function frame() {
  frameHandle = frameListeners.size === 0 ? undefined : requestAnimationFrame(frame);
  // One timestamp for every listener, and all of them in the same callback: numbers that
  // change together are painted together.
  const nowMs = Date.now();
  for (const listener of [...frameListeners]) listener(nowMs);
}

/**
 * Calls `listener` on every animation frame with the local time in ms. All listeners share
 * one requestAnimationFrame loop, which stops when the last one unsubscribes.
 */
export function onFrame(listener: FrameListener): () => void {
  frameListeners.add(listener);
  if (frameHandle === undefined) frameHandle = requestAnimationFrame(frame);
  return () => {
    frameListeners.delete(listener);
    if (frameListeners.size === 0 && frameHandle !== undefined) {
      cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    }
  };
}
