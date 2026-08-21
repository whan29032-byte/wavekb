import { describe, expect, it } from "vitest";
import {
  FLOATING_WINDOW_INTERACTIVE_SELECTOR,
  isInteractiveDragTarget,
  moveFloatingWindowDrag,
  startFloatingWindowDrag,
  stopFloatingWindowDrag,
} from "./floating-window-drag";

function activeDrag() {
  return startFloatingWindowDrag({ pointerId: 7, pointerX: 200, pointerY: 160, windowX: 920, windowY: 120 });
}

describe("floating window drag lifecycle", () => {
  it("starts only with the pointer and origin needed to move a header", () => {
    expect(activeDrag()).toEqual({ pointerId: 7, pointerX: 200, pointerY: 160, windowX: 920, windowY: 120 });
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture", "window blur", "hidden document"])(
    "clears active drag idempotently on %s",
    () => {
      const stopped = stopFloatingWindowDrag(activeDrag());
      expect(stopped).toBeNull();
      expect(stopFloatingWindowDrag(stopped)).toBeNull();
    },
  );

  it("ignores a finish event from a different pointer", () => {
    const state = activeDrag();
    expect(stopFloatingWindowDrag(state, 9)).toBe(state);
    expect(stopFloatingWindowDrag(state, 7)).toBeNull();
  });

  it("clamps the full floating window inside the viewport", () => {
    expect(moveFloatingWindowDrag(
      activeDrag(),
      { pointerId: 7, pointerX: 900, pointerY: 900 },
      { width: 1280, height: 800 },
      { width: 304, height: 520 },
    )).toEqual({ x: 968, y: 272 });
  });

  it("does not start from interactive controls or message fields", () => {
    const closest = (selector: string) => selector === FLOATING_WINDOW_INTERACTIVE_SELECTOR ? {} : null;
    expect(isInteractiveDragTarget({ closest } as unknown as EventTarget)).toBe(true);
    expect(FLOATING_WINDOW_INTERACTIVE_SELECTOR).toContain("textarea");
    expect(FLOATING_WINDOW_INTERACTIVE_SELECTOR).toContain("[contenteditable='true']");
  });
});
