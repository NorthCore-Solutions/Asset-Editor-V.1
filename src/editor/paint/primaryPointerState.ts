import { getSurfacePaintSettings } from './surfacePaintSession';

type PrimaryPointerListener = (active: boolean) => void;

interface PaintPointerStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  dragging: boolean;
}

const PAINT_DRAG_THRESHOLD_PX = 3;

let primaryPointerActive = false;
let paintPointerStart: PaintPointerStart | null = null;
const listeners = new Set<PrimaryPointerListener>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener(primaryPointerActive));
}

function setPrimaryPointerActive(active: boolean): void {
  if (primaryPointerActive === active) return;
  primaryPointerActive = active;
  notifyListeners();
}

function isPaintCanvasTarget(target: EventTarget | null): target is HTMLCanvasElement {
  return target instanceof HTMLCanvasElement && getSurfacePaintSettings().enabled;
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;

  setPrimaryPointerActive(true);
  paintPointerStart = isPaintCanvasTarget(event.target)
    ? {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        dragging: false
      }
    : null;
}

function handlePointerMove(event: PointerEvent): void {
  const start = paintPointerStart;
  if (!start || start.pointerId !== event.pointerId || start.dragging) return;

  const distance = Math.hypot(
    event.clientX - start.clientX,
    event.clientY - start.clientY
  );
  if (distance >= PAINT_DRAG_THRESHOLD_PX) {
    start.dragging = true;
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function releasePrimaryPointer(event?: Event): void {
  if (
    event instanceof PointerEvent
    && paintPointerStart
    && event.pointerId !== paintPointerStart.pointerId
  ) return;

  paintPointerStart = null;
  setPrimaryPointerActive(false);
}

function registerWindowListeners(): void {
  window.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('pointermove', handlePointerMove, true);
  window.addEventListener('pointerup', releasePrimaryPointer, true);
  window.addEventListener('pointercancel', releasePrimaryPointer, true);
  window.addEventListener('blur', releasePrimaryPointer, true);
}

if (typeof window !== 'undefined') registerWindowListeners();

export function isPrimaryPointerActive(): boolean {
  return primaryPointerActive;
}

export function subscribePrimaryPointer(listener: PrimaryPointerListener): () => void {
  listeners.add(listener);
  listener(primaryPointerActive);
  return () => listeners.delete(listener);
}
