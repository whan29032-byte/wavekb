import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, normalizeAppearance, readableAccent, textOnColor, customAccentPalette, contrastRatio } from "./appearance";

describe("appearance settings", () => {
  it("preserves valid legacy settings", () => expect(normalizeAppearance({ theme: "sakura", mode: "dark", customColor: "#ABCDEF" })).toEqual({ theme: "sakura", mode: "dark", customColor: "#abcdef" }));
  it("rejects malformed stored values", () => expect(normalizeAppearance({ theme: "hack", mode: "blue", customColor: "red" })).toEqual(DEFAULT_APPEARANCE));
  it("preserves the explicit reduce-motion choice without interpreting strings as booleans", () => {
    expect(normalizeAppearance({ reduceMotion: true }).reduceMotion).toBe(true);
    expect(normalizeAppearance({ reduceMotion: "false" }).reduceMotion).not.toBe(true);
  });
  it("keeps text readable on custom colors", () => { expect(textOnColor("#ffffff")).toBe("#102033"); expect(textOnColor("#000000")).toBe("#f7fbff"); });
  it("darkens bright custom accents for readable text and focus states", () => { expect(readableAccent("#ffff00")).not.toBe("#ffff00"); expect(readableAccent("#102030")).toBe("#102030"); });
  it.each(["#557fb8", "#ffffff", "#000000", "#ffff00", "#00ff00", "#ff0000", "#0000ff", "#abcdef"])("derives readable text and button colors for %s in both modes", (color) => {
    const palette = customAccentPalette(color);
    expect(contrastRatio(palette.light, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.dark, "#263342")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.light, palette.onLight)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.dark, palette.onDark)).toBeGreaterThanOrEqual(4.5);
  });
});
