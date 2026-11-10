export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "linear-staking.theme";

const SWITCHING_ATTRIBUTE = "data-theme-switching";
const SWITCH_MS = 300;

/**
 * Sets the theme before the first paint, so the page never flashes in the wrong one.
 *
 * The stored choice wins; without one the operating system's preference decides; dark is
 * the fallback. This function is serialised into an inline script in <head> (see
 * `themeInitScript`), so it must not use anything outside its own body.
 */
export function applyInitialTheme(storageKey: string): void {
  let theme = "dark";
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") theme = stored;
    else if (window.matchMedia("(prefers-color-scheme: light)").matches) theme = "light";
  } catch {
    // Storage or matchMedia unavailable: keep the fallback.
  }
  document.documentElement.setAttribute("data-theme", theme);
}

/** The inline script for <head>: `applyInitialTheme` called with the storage key. */
export const themeInitScript = `(${applyInitialTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)})`;

const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

const readStored = (): Theme | undefined => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : undefined;
  } catch {
    return undefined;
  }
};

/** The theme the document is in right now. */
export function getTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export const getServerTheme = (): Theme => "dark";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === theme) return;
  // Cross-fade the colours for the duration of the switch (see globals.css).
  root.setAttribute(SWITCHING_ATTRIBUTE, "");
  root.setAttribute("data-theme", theme);
  window.setTimeout(() => root.removeAttribute(SWITCHING_ATTRIBUTE), SWITCH_MS);
  emit();
}

/** Switches the theme and remembers the choice. */
export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not persisted (private mode): the choice still applies to this visit.
  }
  apply(theme);
}

/** Subscribes to theme changes; also follows the operating system until a choice is stored. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const system = window.matchMedia("(prefers-color-scheme: light)");
  const followSystem = () => {
    if (readStored() === undefined) apply(system.matches ? "light" : "dark");
  };
  system.addEventListener("change", followSystem);
  return () => {
    listeners.delete(listener);
    system.removeEventListener("change", followSystem);
  };
}
