type PrimaryPointerListener = (active: boolean) => void;

let primaryPointerActive = false;
const listeners = new Set<PrimaryPointerListener>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener(primaryPointerActive));
}

function setPrimaryPointerActive(active: boolean): void {
  if (primaryPointerActive === active) return;
  primaryPointerActive = active;
  notifyListeners();
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button === 0) setPrimaryPointerActive(true);
}

function releasePrimaryPointer(): void {
  setPrimaryPointerActive(false);
}

function registerWindowListeners(): void {
  window.addEventListener('pointerdown', handlePointerDown, true);
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
