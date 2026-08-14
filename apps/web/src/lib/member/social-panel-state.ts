export type PanelCoordinates = { x: number; y: number };

export function clampPanelCoordinates(
  coordinates: PanelCoordinates,
  viewport: { width: number; height: number },
  panel: { width: number; height: number },
): PanelCoordinates {
  const minX = 8;
  const minY = 70;
  const maxX = Math.max(minX, viewport.width - Math.min(panel.width, viewport.width - 16) - 8);
  const maxY = Math.max(minY, viewport.height - Math.min(panel.height, viewport.height - 76) - 8);
  return {
    x: Math.min(maxX, Math.max(minX, Number.isFinite(coordinates.x) ? coordinates.x : maxX)),
    y: Math.min(maxY, Math.max(minY, Number.isFinite(coordinates.y) ? coordinates.y : minY)),
  };
}
