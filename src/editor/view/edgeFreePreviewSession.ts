import { useSyncExternalStore } from 'react';

let edgeFreePreview = false;
const listeners = new Set<() => void>();

export function getEdgeFreePreview(): boolean {
  return edgeFreePreview;
}

export function setEdgeFreePreview(nextValue: boolean): void {
  if (edgeFreePreview === nextValue) return;
  edgeFreePreview = nextValue;
  listeners.forEach((listener) => listener());
}

export function subscribeEdgeFreePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEdgeFreePreview(): boolean {
  return useSyncExternalStore(
    subscribeEdgeFreePreview,
    getEdgeFreePreview,
    () => false
  );
}
