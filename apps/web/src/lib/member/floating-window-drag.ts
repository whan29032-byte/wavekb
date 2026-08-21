import { clampPanelCoordinates, type PanelCoordinates } from "./social-panel-state";

export const FLOATING_WINDOW_INTERACTIVE_SELECTOR =
  "button,a,input,textarea,select,[role='button'],[contenteditable='true']";

export type FloatingWindowDragState = {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  windowX: number;
  windowY: number;
};

export function isInteractiveDragTarget(target: EventTarget | null) {
  const candidate = target as { closest?: (selector: string) => unknown } | null;
  return Boolean(candidate && typeof candidate.closest === "function" && candidate.closest(FLOATING_WINDOW_INTERACTIVE_SELECTOR));
}

export function startFloatingWindowDrag(input: {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  windowX: number;
  windowY: number;
}): FloatingWindowDragState {
  return { ...input };
}

export function moveFloatingWindowDrag(
  state: FloatingWindowDragState | null,
  input: { pointerId: number; pointerX: number; pointerY: number },
  viewport: { width: number; height: number },
  windowSize: { width: number; height: number },
): PanelCoordinates | null {
  if (!state || state.pointerId !== input.pointerId) return null;
  return clampPanelCoordinates(
    {
      x: state.windowX + input.pointerX - state.pointerX,
      y: state.windowY + input.pointerY - state.pointerY,
    },
    viewport,
    windowSize,
  );
}

export function stopFloatingWindowDrag(
  state: FloatingWindowDragState | null,
  pointerId?: number,
): FloatingWindowDragState | null {
  if (!state) return null;
  return pointerId === undefined || state.pointerId === pointerId ? null : state;
}
