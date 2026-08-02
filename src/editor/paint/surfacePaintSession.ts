import type { CameraView } from '../../types/editor';
import type { PaintTool } from './pixelPaint';

export interface SurfacePaintSettings {
  enabled: boolean;
  tool: PaintTool;
  color: string;
  brushSize: number;
  islandIndex: number;
  cameraView: CameraView | null;
  cameraRequestId: number;
}

type SurfacePaintListener = (settings: SurfacePaintSettings) => void;

let settings: SurfacePaintSettings = {
  enabled: false,
  tool: 'brush',
  color: '#AEB8BE',
  brushSize: 1,
  islandIndex: -1,
  cameraView: null,
  cameraRequestId: 0
};

const listeners = new Set<SurfacePaintListener>();

export function getSurfacePaintSettings(): SurfacePaintSettings {
  return settings;
}

export function setSurfacePaintSettings(patch: Partial<SurfacePaintSettings>): void {
  settings = {
    ...settings,
    ...patch,
    brushSize: patch.brushSize === undefined
      ? settings.brushSize
      : Math.max(1, Math.min(8, Math.round(patch.brushSize))),
    islandIndex: patch.islandIndex === undefined
      ? settings.islandIndex
      : Math.max(-1, Math.round(patch.islandIndex))
  };
  listeners.forEach((listener) => listener(settings));
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
