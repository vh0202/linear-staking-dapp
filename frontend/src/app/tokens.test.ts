import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The colour tokens are checked against WCAG 2.1 AA straight from the stylesheet that the
// app ships: 4.5:1 for text (SC 1.4.3) and 3:1 for the graphics that carry meaning
// (SC 1.4.11). A token edit that breaks contrast in either theme fails here.

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

type Tokens = Record<string, string>;

/** Custom properties declared by the rules whose selector list satisfies `matches`. */
function declarations(matches: (selectors: string[]) => boolean): Tokens {
  const tokens: Tokens = {};
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = selectors
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((item) => item.trim());
    if (!matches(list)) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
  }
  return tokens;
}

// `:root` alone holds what both themes share; dark is also the default (`:root, [data-theme="dark"]`).
const shared = declarations((list) => list.length === 1 && list[0] === ":root");
const dark = declarations((list) => list.includes('[data-theme="dark"]'));
const light = declarations((list) => list.includes('[data-theme="light"]'));
const themes: Record<string, Tokens> = {
  dark: { ...shared, ...dark },
  light: { ...shared, ...light },
};

type Rgb = [number, number, number];

function rgb(tokens: Tokens, name: string): Rgb {
  const value = tokens[`--${name}`];
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? "");
  if (match === null) throw new Error(`--${name} must be a six-digit hex colour, got ${JSON.stringify(value)}`);
  const hex = match[1];
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)) as Rgb;
}

/** Relative luminance, WCAG 2.1. */
function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Contrast ratio, WCAG 2.1: 1 (none) to 21 (black on white). */
function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = ["bg", "surface", "surface-raised", "surface-sunken"];
const TEXT = ["text", "text-secondary", "text-tertiary", "accent-text", "success", "warning", "danger"];
const TINTS = ["accent-soft", "success-soft", "warning-soft", "danger-soft"];

/** [foreground, background] pairs that carry text somewhere in the interface. */
const textPairs: [string, string][] = [
  // Every text colour on every surface.
  ...SURFACES.flatMap((surface) => TEXT.map((text): [string, string] => [text, surface])),
  // Notices, pills, status boxes: body text and the tint's own colour on each tinted box.
  ...TINTS.flatMap((tint): [string, string][] => [
    ["text", tint],
    ["text-secondary", tint],
    ["text-tertiary", tint],
    [tint === "accent-soft" ? "accent-text" : tint.replace("-soft", ""), tint],
  ]),
  // The primary button: its label on both ends of its gradient, and its label when disabled.
  ["on-accent", "cta-from"],
  ["on-accent", "cta-to"],
  ["text-secondary", "line"],
  // RainbowKit's dialogs (components/Providers.tsx): button labels on the accent colour.
  ["bg", "accent-text"],
];

/** [graphic, background] pairs where a shape or a boundary carries state. */
const graphicPairs: [string, string][] = [
  // Progress ring, progress bar and logo: every stop of the signature gradient.
  ...["grad-from", "grad-via", "grad-to"].flatMap((stop): [string, string][] => [
    [stop, "surface"],
    [stop, "bg"],
  ]),
  // Focus ring and the borders of the step indicator's states.
  ...["accent", "accent-text", "success", "warning", "danger"].flatMap((colour): [string, string][] => [
    [colour, "surface"],
    [colour, "surface-sunken"],
    [colour, "bg"],
  ]),
  // The tick on a filled success badge.
  ["bg", "success"],
  // Disabled text is exempt from 1.4.3, but it must stay legible as a shape.
  ["text-disabled", "surface"],
  ["text-disabled", "surface-sunken"],
];

/** `colour` laid over `background` at `alpha` (0..1), as the browser composites it. */
function over(colour: Rgb, alpha: number, background: Rgb): Rgb {
  return colour.map((channel, index) => Math.round(channel * alpha + background[index] * (1 - alpha))) as Rgb;
}

/** A token such as `--aura-strength: 26%` as a number between 0 and 1. */
function share(tokens: Tokens, name: string): number {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(tokens[`--${name}`] ?? "");
  if (match === null) throw new Error(`--${name} must be a percentage, got ${JSON.stringify(tokens[`--${name}`])}`);
  return Number(match[1]) / 100;
}

/**
 * The glows (--aura, --aura-card) tint what is behind the text. The worst case is the very
 * centre of a glow, at its full strength; on a card the highlight along its top comes on top.
 * [text colour, surface, with the card highlight?]
 */
const glowCases: [string, string, boolean][] = [
  // On the page itself: brand, subtitle, footer.
  ["text", "bg", false],
  ["text-secondary", "bg", false],
  ["text-tertiary", "bg", false],
  // On the position card. Its labels use the secondary colour: the tertiary one is not
  // strong enough there (see Eyebrow in components/ui.tsx), so it is not in this list.
  ["text", "surface", true],
  ["text-secondary", "surface", true],
  ["success", "surface", true],
  ["accent-text", "surface", true],
];

describe.each(Object.entries(themes))("%s theme", (_name, tokens) => {
  it.each(glowCases)("text over a glow: --%s on tinted --%s is at least 4.5:1", (text, surface, highlight) => {
    for (const [glow, strength] of [
      ["grad-from", "aura-strength"],
      ["grad-to", "aura-strength-end"],
    ]) {
      let background = over(rgb(tokens, glow), share(tokens, strength), rgb(tokens, surface));
      if (highlight) background = over([255, 255, 255], share(tokens, "sheen-strength"), background);
      expect(contrast(rgb(tokens, text), background), `under the ${glow} glow`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("defines every colour token as an opaque hex value", () => {
    const names = [...new Set([...textPairs, ...graphicPairs].flat())];
    for (const name of names) expect(() => rgb(tokens, name), `--${name}`).not.toThrow();
  });

  it.each(textPairs)("text: --%s on --%s is at least 4.5:1", (foreground, background) => {
    expect(contrast(rgb(tokens, foreground), rgb(tokens, background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(graphicPairs)("graphics: --%s on --%s is at least 3:1", (foreground, background) => {
    expect(contrast(rgb(tokens, foreground), rgb(tokens, background))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the surfaces distinct from the page background", () => {
    // Elevation is carried by borders and shadows too; this only guards against two
    // surfaces collapsing into the same colour.
    expect(tokens["--surface"]).not.toBe(tokens["--bg"]);
    expect(tokens["--surface-sunken"]).not.toBe(tokens["--surface"]);
  });
});

describe("themes", () => {
  it("define the same set of tokens", () => {
    expect(Object.keys(dark).length).toBeGreaterThan(20);
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it("make dark the default when no theme is set", () => {
    expect(declarations((list) => list.includes(":root") && list.includes('[data-theme="dark"]'))).toEqual(dark);
  });

  it("really differ", () => {
    expect(themes.dark["--bg"]).not.toBe(themes.light["--bg"]);
    expect(luminance(rgb(themes.dark, "bg"))).toBeLessThan(0.05);
    expect(luminance(rgb(themes.light, "bg"))).toBeGreaterThan(0.8);
  });

  it("checks contrast with the WCAG formula", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBe(1);
    // #767676 on white is the well-known threshold grey: 4.54:1.
    expect(contrast([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });
});
