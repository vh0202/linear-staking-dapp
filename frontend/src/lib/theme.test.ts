import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY, themeInitScript } from "./theme";

type Setup = {
  /** What localStorage holds under the theme key. */
  stored?: string | null;
  /** What the operating system prefers. */
  system?: "light" | "dark";
  storageBlocked?: boolean;
  noMatchMedia?: boolean;
};

/**
 * Runs the inline script exactly as it is written into <head>, in a fresh context that has
 * nothing but the browser globals it is allowed to use, and returns the theme it set.
 */
function themeAfterInit({ stored = null, system = "dark", storageBlocked = false, noMatchMedia = false }: Setup = {}) {
  const attributes: Record<string, string> = {};
  const readKeys: string[] = [];
  const context = {
    window: {
      localStorage: {
        getItem(key: string) {
          if (storageBlocked) throw new Error("SecurityError");
          readKeys.push(key);
          return stored;
        },
      },
      matchMedia: noMatchMedia
        ? undefined
        : (query: string) => ({ matches: query === "(prefers-color-scheme: light)" && system === "light" }),
    },
    document: {
      documentElement: {
        setAttribute(name: string, value: string) {
          attributes[name] = value;
        },
      },
    },
  };
  vm.runInNewContext(themeInitScript, context);
  return { theme: attributes["data-theme"], readKeys };
}

describe("theme init script (runs before the first paint)", () => {
  it("uses the stored choice, whatever the operating system prefers", () => {
    expect(themeAfterInit({ stored: "light", system: "dark" }).theme).toBe("light");
    expect(themeAfterInit({ stored: "dark", system: "light" }).theme).toBe("dark");
  });

  it("follows the operating system when nothing is stored", () => {
    expect(themeAfterInit({ system: "light" }).theme).toBe("light");
    expect(themeAfterInit({ system: "dark" }).theme).toBe("dark");
  });

  it("ignores a stored value that is not a theme", () => {
    expect(themeAfterInit({ stored: "blue", system: "light" }).theme).toBe("light");
    expect(themeAfterInit({ stored: "", system: "dark" }).theme).toBe("dark");
  });

  it("falls back to dark when storage or matchMedia is unavailable, and still sets a theme", () => {
    expect(themeAfterInit({ storageBlocked: true, system: "light" }).theme).toBe("dark");
    expect(themeAfterInit({ noMatchMedia: true }).theme).toBe("dark");
    expect(themeAfterInit({ noMatchMedia: true, stored: "light" }).theme).toBe("light");
  });

  it("reads the same storage key the toggle writes", () => {
    expect(themeAfterInit().readKeys).toEqual([THEME_STORAGE_KEY]);
  });

  it("is self-contained: it needs nothing but window and document", () => {
    // Anything else the function referenced would throw a ReferenceError in the empty context.
    expect(() => themeAfterInit({ stored: "light" })).not.toThrow();
    expect(themeInitScript.startsWith("(")).toBe(true);
    expect(themeInitScript).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });
});
