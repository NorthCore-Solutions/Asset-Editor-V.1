import { useSyncExternalStore } from 'react';

let visible = false;
const listeners = new Set<() => void>();

export function setDimensionOverlayVisible(nextVisible: boolean): void {
  if (visible === nextVisible) return;
  visible = nextVisible;
  listeners.forEach((listener) => listener());
}

export function subscribeDimensionOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDimensionOverlayVisible(): boolean {
  return useSyncExternalStore(
    subscribeDimensionOverlay,
    () => visible,
    () => false
  );
}
