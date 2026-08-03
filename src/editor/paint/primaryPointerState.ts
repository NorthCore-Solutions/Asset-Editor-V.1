type PrimaryPointerListener = (active: boolean) => void;

let primaryPointerActive = false;
const listeners = new Set<PrimaryPointerListener>();

function publish(active: boolean): void {
  if (primaryPointerActive === active) return;
  primaryPointerActive = active;
  listeners.forEach((listener) => listener(active));
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (event) => {
    if (event.button === 0) publish(true);
  }, true);

  const release = () => publish(false);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release, true);
}

export function isPrimaryPointerActive(): boolean {
  return primaryPointerActive;
}

export function subscribePrimaryPointer(listener: PrimaryPointerListener): () => void {
  listeners.add(listener);
  listener(primaryPointerActive);
  return () => listeners.delete(listener);
}
