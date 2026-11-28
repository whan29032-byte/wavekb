import { describe, expect, it } from "vitest";
import { TRADE_CHART_DRAWING_TOOL_SCHEMAS } from "@wavekb/domain/trading-review";
import { drawingSettingsSchema, getDrawingTool } from "openalgo-charts/draw";

import * as chartEngine from "./chart-engine";

describe("installed OpenAlgo drawing registry", () => {
  it("resolves every WaveKB drawing identifier through the installed public draw export", async () => {
    expect(chartEngine.verifyWaveKbDrawingToolRegistry).toEqual(expect.any(Function));

    await expect(chartEngine.verifyWaveKbDrawingToolRegistry()).resolves.toEqual(
      chartEngine.WAVEKB_DRAWING_TOOL_IDS,
    );
  });

  it("matches all application anchor counts and allowed settings to the installed public contracts", () => {
    const expectedPointCounts = {
      "trend-line": 2, ray: 2, "horizontal-line": 1, "vertical-line": 1,
      rectangle: 2, text: 1, "long-position": 2, "short-position": 2,
      "fib-retracement": 2, "fib-extension": 3, "fib-time-zone": 2,
      "fib-fan": 2, "fib-channel": 3, "elliott-impulse": 6,
      "elliott-correction": 4, "elliott-triangle": 6,
      "elliott-double-combo": 4, "elliott-triple-combo": 6,
    } as const;

    expect(Object.fromEntries(chartEngine.WAVEKB_DRAWING_TOOL_IDS.map((toolId) => [
      toolId,
      getDrawingTool(toolId).points,
    ]))).toEqual(expectedPointCounts);

    for (const toolId of chartEngine.WAVEKB_DRAWING_TOOL_IDS) {
      const applicationSchema = TRADE_CHART_DRAWING_TOOL_SCHEMAS[toolId];
      const publicPaths = new Set(drawingSettingsSchema(toolId).fields.map((field) => field.path));
      expect(applicationSchema.pointCount, `${toolId} input anchors`).toBe(getDrawingTool(toolId).points);
      for (const key of applicationSchema.styleKeys) expect(publicPaths, `${toolId} style.${key}`).toContain(`style.${key}`);
      for (const key of applicationSchema.textKeys) expect(publicPaths, `${toolId} text.${key}`).toContain(`text.${key}`);
      for (const key of applicationSchema.propertyKeys) {
        if (key === "stopTime" || key === "stopPrice") {
          expect(["long-position", "short-position"]).toContain(toolId);
          expect(publicPaths, `${toolId} WaveKB-owned props.${key}`).not.toContain(`props.${key}`);
        } else {
          expect(publicPaths, `${toolId} props.${key}`).toContain(`props.${key}`);
        }
      }
    }

    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS["trend-line"].styleKeys).toContain("showStats");
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS.ray.styleKeys).toContain("showStats");
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS["long-position"].styleKeys).toEqual(expect.arrayContaining(["accountSize", "risk"]));
    expect(TRADE_CHART_DRAWING_TOOL_SCHEMAS["short-position"].styleKeys).toEqual(expect.arrayContaining(["accountSize", "risk"]));

    const publicField = (toolId: Parameters<typeof drawingSettingsSchema>[0], path: string) =>
      drawingSettingsSchema(toolId).fields.find((field) => field.path === path);

    for (const toolId of ["trend-line", "ray"] as const) {
      expect(publicField(toolId, "style.showStats")).toMatchObject({
        path: "style.showStats",
        kind: "boolean",
      });
    }

    for (const toolId of ["long-position", "short-position"] as const) {
      expect(publicField(toolId, "style.accountSize")).toMatchObject({
        path: "style.accountSize",
        kind: "number",
        min: 0,
      });
      expect(publicField(toolId, "style.risk")).toMatchObject({
        path: "style.risk",
        kind: "number",
        min: 0,
        max: 100,
      });

      const anchors = [{ time: 100, price: 100 }, { time: 200, price: 110 }];
      const tool = getDrawingTool(toolId);
      expect(tool.expand?.(anchors, { barSeconds: 60, visibleBars: 100 })).toEqual([
        anchors[0],
        anchors[1],
        { time: 200, price: 95 },
      ]);
      const customStop = [...anchors, { time: 240, price: 80 }];
      expect(tool.constrain?.(customStop, 2)).toEqual(customStop);
    }
  });
});
