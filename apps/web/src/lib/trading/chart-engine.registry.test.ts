import { describe, expect, it } from "vitest";

import * as chartEngine from "./chart-engine";

describe("installed OpenAlgo drawing registry", () => {
  it("resolves every WaveKB drawing identifier through the installed public draw export", async () => {
    expect(chartEngine.verifyWaveKbDrawingToolRegistry).toEqual(expect.any(Function));

    await expect(chartEngine.verifyWaveKbDrawingToolRegistry()).resolves.toEqual(
      chartEngine.WAVEKB_DRAWING_TOOL_IDS,
    );
  });
});
