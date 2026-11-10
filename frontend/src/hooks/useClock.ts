"use client";

import { useSyncExternalStore } from "react";

// One shared ticker for the whole page. Components subscribe through
// useSyncExternalStore, so reading the time stays out of render.
const TICK_MS = 250;

const listeners = new Set<() => void>();
let nowMs = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  nowMs = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    nowMs = Date.now();
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Local time in ms, refreshed four times a second. 0 on the server and before mount. */
export function useClock(): number {
  return useSyncExternalStore(
    subscribe,
    () => nowMs,
    () => 0,
  );
}
