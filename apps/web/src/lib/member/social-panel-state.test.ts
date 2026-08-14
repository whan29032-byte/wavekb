import { describe, expect, it } from "vitest";
import { clampPanelCoordinates } from "./social-panel-state";

describe("social panel viewport persistence", () => {
  it("moves desktop coordinates back into a phone viewport", () => {
    expect(clampPanelCoordinates(
      { x: 1180, y: 700 },
      { width: 375, height: 667 },
      { width: 304, height: 520 },
    )).toEqual({ x: 63, y: 139 });
  });

  it("normalizes malformed stored coordinates", () => {
    expect(clampPanelCoordinates(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      { width: 1280, height: 800 },
      { width: 304, height: 520 },
    )).toEqual({ x: 968, y: 70 });
  });
});
