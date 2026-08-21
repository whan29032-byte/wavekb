"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  isInteractiveDragTarget,
  moveFloatingWindowDrag,
  startFloatingWindowDrag,
  stopFloatingWindowDrag,
  type FloatingWindowDragState,
} from "@/lib/member/floating-window-drag";
import { clampPanelCoordinates, type PanelCoordinates } from "@/lib/member/social-panel-state";

type WindowSize = { width: number; height: number };

export function useFloatingWindowDrag({
  windowRef,
  disabled = false,
  onCommit,
}: {
  windowRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  onCommit: (position: PanelCoordinates, size: WindowSize) => void;
}) {
  const dragRef = useRef<FloatingWindowDragState | null>(null);
  const handleRef = useRef<HTMLElement | null>(null);
  const onCommitRef = useRef(onCommit);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);

  const readClampedPosition = useCallback(() => {
    const element = windowRef.current;
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    const size = { width: bounds.width, height: bounds.height };
    const position = clampPanelCoordinates(
      { x: bounds.left, y: bounds.top },
      { width: window.innerWidth, height: window.innerHeight },
      size,
    );
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    return { position, size };
  }, [windowRef]);

  const stopDrag = useCallback((pointerId?: number) => {
    const active = dragRef.current;
    const next = stopFloatingWindowDrag(active, pointerId);
    if (next === active) return;

    dragRef.current = null;
    setIsDragging(false);
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle && active?.pointerId !== undefined) {
      try {
        if (handle.hasPointerCapture?.(active.pointerId)) handle.releasePointerCapture(active.pointerId);
      } catch { /* Capture may already have been released by the browser. */ }
    }

    const committed = readClampedPosition();
    if (committed) onCommitRef.current(committed.position, committed.size);
  }, [readClampedPosition]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0 || !event.isPrimary || isInteractiveDragTarget(event.target)) return;
    const element = windowRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    dragRef.current = startFloatingWindowDrag({
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      windowX: bounds.left,
      windowY: bounds.top,
    });
    handleRef.current = event.currentTarget;
    setIsDragging(true);
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Global listeners remain the fallback. */ }
  }, [disabled, windowRef]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const element = windowRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const position = moveFloatingWindowDrag(
      dragRef.current,
      { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY },
      { width: window.innerWidth, height: window.innerHeight },
      { width: bounds.width, height: bounds.height },
    );
    if (!position) return;
    event.preventDefault();
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
  }, [windowRef]);

  useEffect(() => {
    const finishPointer = (event: PointerEvent) => stopDrag(event.pointerId);
    const finishGlobal = () => stopDrag();
    const finishWhenHidden = () => { if (document.visibilityState === "hidden") stopDrag(); };
    const clampToViewport = () => {
      if (dragRef.current) return;
      const committed = readClampedPosition();
      if (committed) onCommitRef.current(committed.position, committed.size);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("blur", finishGlobal);
    window.addEventListener("resize", clampToViewport);
    window.addEventListener("orientationchange", clampToViewport);
    document.addEventListener("visibilitychange", finishWhenHidden);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      window.removeEventListener("blur", finishGlobal);
      window.removeEventListener("resize", clampToViewport);
      window.removeEventListener("orientationchange", clampToViewport);
      document.removeEventListener("visibilitychange", finishWhenHidden);
      dragRef.current = null;
      handleRef.current = null;
    };
  }, [onPointerMove, readClampedPosition, stopDrag]);

  return {
    isDragging,
    isActive: () => dragRef.current !== null,
    handleProps: {
      onPointerDown,
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => stopDrag(event.pointerId),
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => stopDrag(event.pointerId),
      onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => stopDrag(event.pointerId),
    },
  };
}
