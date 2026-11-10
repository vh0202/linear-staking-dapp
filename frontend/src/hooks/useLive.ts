"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { liveRewards } from "@/lib/liveRewards";
import { getServerTheme, getTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { getServerToasts, getToasts, subscribeToasts } from "@/lib/toasts";
import { createTween } from "@/lib/tween";

const zero = () => 0n;
const no = () => false;

/** Claimable rewards as shown on screen, in reward-token wei. Changes on every frame. */
export function useLiveRewards(): bigint {
  return useSyncExternalStore(liveRewards.subscribe, liveRewards.get, zero);
}

/** Whether there is anything to claim. Changes only when the answer does. */
export function useHasLiveRewards(): boolean {
  return useSyncExternalStore(liveRewards.subscribe, () => liveRewards.get() > 0n, no);
}

/**
 * `value`, counting to each new value instead of jumping (see lib/tween.ts). The first
 * value is shown as it is.
 */
export function useTween(value: bigint): bigint {
  const [tween] = useState(() => createTween(value));
  useEffect(() => tween.to(value), [tween, value]);
  return useSyncExternalStore(tween.subscribe, tween.get, () => value);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

export function useToasts() {
  return useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
}
