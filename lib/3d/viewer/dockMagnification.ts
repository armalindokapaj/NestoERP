export const DOCK_WINDOW_SLOTS = 2.5;

export function dockMagnification(distanceSlots: number): number {
  const distance = Math.abs(distanceSlots);
  if (!(distance < DOCK_WINDOW_SLOTS)) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * distance) / DOCK_WINDOW_SLOTS));
}
