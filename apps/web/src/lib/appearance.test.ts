import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, normalizeAppearance, textOnColor } from "./appearance";

describe("appearance settings", () => {
  it("preserves valid legacy settings", () => expect(normalizeAppearance({ theme: "sakura", mode: "dark", customColor: "#ABCDEF" })).toEqual({ theme: "sakura", mode: "dark", customColor: "#abcdef" }));
  it("rejects malformed stored values", () => expect(normalizeAppearance({ theme: "hack", mode: "blue", customColor: "red" })).toEqual(DEFAULT_APPEARANCE));
  it("keeps text readable on custom colors", () => { expect(textOnColor("#ffffff")).toBe("#102033"); expect(textOnColor("#000000")).toBe("#f7fbff"); });
});
