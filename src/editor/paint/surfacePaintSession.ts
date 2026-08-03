import type { CameraView } from '../../types/editor';
import type { PaintTool } from './pixelPaint';

export interface SurfacePaintSettings {
  enabled: boolean;
  tool: PaintTool;
  color: string;
  brushSize: number;
  eraseAll: boolean;
  islandIndex: number;
  cameraView: CameraView | null;
  cameraRequestId: number;
}

type SurfacePaintListener = (settings: SurfacePaintSettings) => void;

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 8;
const MIN_ISLAND_INDEX = -1;

let settings: SurfacePaintSettings = {
  enabled: false,
  tool: 'brush',
  color: '#AEB8BE',
  brushSize: MIN_BRUSH_SIZE,
  eraseAll: false,
  islandIndex: MIN_ISLAND_INDEX,
  cameraView: null,
  cameraRequestId: 0
};

const listeners = new Set<SurfacePaintListener>();

function clampInteger(value: number, minimum: number, maximum?: number): number {
  const rounded = Math.round(value);
  return maximum === undefined
    ? Math.max(minimum, rounded)
    : Math.max(minimum, Math.min(maximum, rounded));
}

function normalizeSettings(
  current: SurfacePaintSettings,
  patch: Partial<SurfacePaintSettings>
): SurfacePaintSettings {
  return {
    ...current,
    ...patch,
    brushSize: patch.brushSize === undefined
      ? current.brushSize
      : clampInteger(patch.brushSize, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE),
    islandIndex: patch.islandIndex === undefined
      ? current.islandIndex
      : clampInteger(patch.islandIndex, MIN_ISLAND_INDEX)
  };
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener(settings));
}

export function getSurfacePaintSettings(): SurfacePaintSettings {
  return settings;
}

export function setSurfacePaintSettings(patch: Partial<SurfacePaintSettings>): void {
  settings = normalizeSettings(settings, patch);
  notifyListeners();
}

export function requestSurfaceCameraView(cameraView: CameraView): void {
  setSurfacePaintSettings({
    cameraView,
    cameraRequestId: settings.cameraRequestId + 1
  });
}

export function subscribeSurfacePaint(listener: SurfacePaintListener): () => void {
  listeners.add(listener);
  listener(settings);
  return () => listeners.delete(listener);
}
