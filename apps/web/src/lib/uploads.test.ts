import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./uploads";

describe("mapWithConcurrency", () => {
  it("preserves input order and never exceeds the upload limit", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapWithConcurrency([3, 1, 2, 4], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });
    expect(result).toEqual([6, 2, 4, 8]);
    expect(maximum).toBe(2);
  });
});
