import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData } from '../../types/editor';
import {
  atlasIslandAtUv,
  atlasPixelRegion,
  getSurfaceUvAtlas,
  type SurfaceUvAtlas
} from '../../geometry/uvAtlas';
import {
  DEFAULT_PAINT_SIZE,
  createFilledImageData,
  floodFill,
  hexToRgba,
  paintBrush,
  rgbaToHex,
  samplePixel
} from './pixelPaint';
import {
  getSurfacePaintSettings,
  setSurfacePaintSettings,
  subscribeSurfacePaint,
  type SurfacePaintSettings
} from './surfacePaintSession';

interface PaintSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

interface PaintHit {
  point: [number, number];
  islandIndex: number;
  atlas: SurfaceUvAtlas;
}

interface CapturableTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

interface OrbitControlApi {
  enabled: boolean;
  enablePan: boolean;
  enableRotate: boolean;
}

export interface SurfacePaintBinding {
  active: boolean;
  texture: THREE.CanvasTexture | null;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onPointerCancel: (event: ThreeEvent<PointerEvent>) => void;
}

function configureTexture(texture: THREE.CanvasTexture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
}

function fillSurface(surface: PaintSurface, color: string): void {
  surface.context.putImageData(
    createFilledImageData(surface.canvas.width, surface.canvas.height, hexToRgba(color)),
    0,
    0
  );
  surface.texture.needsUpdate = true;
}

function createSurface(color: string): PaintSurface {
  const canvas = document.createElement('canvas');
  canvas.width = DEFAULT_PAINT_SIZE;
  canvas.height = DEFAULT_PAINT_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D-Kontext für Oberflächenbemalung nicht verfügbar.');
  context.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(canvas);
  configureTexture(texture);
  const surface = { canvas, context, texture };
  fillSurface(surface, color);
  return surface;
}

function resizeSurface(surface: PaintSurface, width: number, height: number): void {
  if (surface.canvas.width === width && surface.canvas.height === height) return;
  surface.canvas.width = width;
  surface.canvas.height = height;
  surface.context.imageSmoothingEnabled = false;
  surface.texture.needsUpdate = true;
}

function paintHitFromEvent(surface: PaintSurface, event: ThreeEvent<PointerEvent>): PaintHit | null {
  if (!event.uv || !(event.object instanceof THREE.Mesh)) return null;
  const geometry = event.object.geometry;
  const atlas = getSurfaceUvAtlas(geometry);
  const islandIndex = atlasIslandAtUv(atlas, event.uv);
  const u = THREE.MathUtils.clamp(event.uv.x, 0, 0.999999);
  const v = THREE.MathUtils.clamp(event.uv.y, 0, 0.999999);
  return {
    point: [
      Math.max(0, Math.min(surface.canvas.width - 1, Math.floor(u * surface.canvas.width))),
      Math.max(0, Math.min(surface.canvas.height - 1, Math.floor((1 - v) * surface.canvas.height)))
    ],
    islandIndex,
    atlas
  };
}

function linePoints(from: [number, number], to: [number, number]): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let [x0, y0] = from;
  const [x1, y1] = to;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x0 += sx; }
    if (doubled <= dx) { error += dx; y0 += sy; }
  }

  return points;
}

function blockEvent(event: ThreeEvent<PointerEvent>): void {
  event.stopPropagation();
  event.nativeEvent.preventDefault();
  event.nativeEvent.stopImmediatePropagation();
}

export function useSurfacePaintSettings(): SurfacePaintSettings {
  const [settings, setSettings] = useState<SurfacePaintSettings>(() => getSurfacePaintSettings());
  useEffect(() => subscribeSurfacePaint(setSettings), []);
  return settings;
}

export function useSurfacePaint(
  object: SceneObjectData,
  selected: boolean,
  settings: SurfacePaintSettings
): SurfacePaintBinding {
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const [surface] = useState<PaintSurface>(() => createSurface(object.material.color));
  const loadedDataUrlRef = useRef<string | null>(null);
  const requestedDataUrlRef = useRef<string | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeIslandRef = useRef<number | null>(null);
  const lastPointRef = useRef<[number, number] | null>(null);
  const changedRef = useRef(false);
  const paintTexture = object.material.paintTexture;
  const active = settings.enabled && selected && object.visible && !object.locked;
  const textureVisible = active || Boolean(paintTexture);

  useFrame(() => {
    if (!active || !controls) return;
    controls.enabled = true;
    controls.enablePan = false;
    controls.enableRotate = true;
  });

  useEffect(() => () => {
    if (activePointerRef.current !== null) {
      activePointerRef.current = null;
      activeIslandRef.current = null;
      endTransaction();
    }
    surface.texture.dispose();
  }, [endTransaction, surface]);

  useEffect(() => {
    if (!paintTexture) {
      requestedDataUrlRef.current = null;
      loadedDataUrlRef.current = null;
      resizeSurface(surface, DEFAULT_PAINT_SIZE, DEFAULT_PAINT_SIZE);
      fillSurface(surface, object.material.color);
      return;
    }

    if (loadedDataUrlRef.current === paintTexture.dataUrl || requestedDataUrlRef.current === paintTexture.dataUrl) return;
    requestedDataUrlRef.current = paintTexture.dataUrl;
    const image = new Image();

    image.onload = () => {
      if (requestedDataUrlRef.current !== paintTexture.dataUrl) return;
      resizeSurface(surface, paintTexture.width, paintTexture.height);
      surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
      surface.context.imageSmoothingEnabled = false;
      surface.context.drawImage(image, 0, 0, surface.canvas.width, surface.canvas.height);
      loadedDataUrlRef.current = paintTexture.dataUrl;
      requestedDataUrlRef.current = null;
      surface.texture.needsUpdate = true;
    };

    image.onerror = () => {
      if (requestedDataUrlRef.current === paintTexture.dataUrl) requestedDataUrlRef.current = null;
    };

    image.src = paintTexture.dataUrl;
  }, [object.material.color, paintTexture?.dataUrl, paintTexture?.height, paintTexture?.width, surface]);

  const persist = (): void => {
    const dataUrl = surface.canvas.toDataURL('image/png');
    loadedDataUrlRef.current = dataUrl;
    requestedDataUrlRef.current = null;
    updateMaterial(object.id, {
      paintTexture: {
        dataUrl,
        width: surface.canvas.width,
        height: surface.canvas.height,
        pixelated: true
      }
    }, false);
  };

  const paintAt = (
    point: [number, number],
    previous: [number, number] | null,
    atlas: SurfaceUvAtlas,
    islandIndex: number
  ): boolean => {
    const image = surface.context.getImageData(0, 0, surface.canvas.width, surface.canvas.height);

    if (settings.tool === 'eyedropper') {
      const sampled = samplePixel(image, point[0], point[1]);
      if (sampled.a > 0) setSurfacePaintSettings({ color: rgbaToHex(sampled) });
      return false;
    }

    if (settings.tool === 'fill') {
      floodFill(
        image,
        point[0],
        point[1],
        hexToRgba(settings.color),
        0,
        atlasPixelRegion(atlas, islandIndex, image.width, image.height)
      );
    } else {
      const color = settings.tool === 'eraser'
        ? hexToRgba('#000000', 0)
        : hexToRgba(settings.color);
      const points = previous ? linePoints(previous, point) : [point];
      points.forEach(([x, y]) => paintBrush(image, x, y, settings.brushSize, color));
    }

    surface.context.putImageData(image, 0, 0);
    surface.texture.needsUpdate = true;
    return true;
  };

  const releasePointer = (event: ThreeEvent<PointerEvent>): void => {
    const target = event.target as CapturableTarget;
    target.releasePointerCapture?.(event.pointerId);
  };

  const finishStroke = (event: ThreeEvent<PointerEvent>): void => {
    if (activePointerRef.current !== event.pointerId) return;
    blockEvent(event);
    activePointerRef.current = null;
    activeIslandRef.current = null;
    lastPointRef.current = null;
    if (changedRef.current) persist();
    changedRef.current = false;
    releasePointer(event);
    endTransaction();
  };

  return {
    active,
    texture: textureVisible ? surface.texture : null,
    onPointerDown: (event) => {
      if (!active || event.button !== 0) return;
      blockEvent(event);
      const hit = paintHitFromEvent(surface, event);
      if (!hit) return;

      if (settings.tool === 'eyedropper') {
        paintAt(hit.point, null, hit.atlas, hit.islandIndex);
        return;
      }

      beginTransaction();
      const changed = paintAt(hit.point, null, hit.atlas, hit.islandIndex);
      if (settings.tool === 'fill') {
        if (changed) persist();
        endTransaction();
        return;
      }

      activePointerRef.current = event.pointerId;
      activeIslandRef.current = hit.islandIndex;
      lastPointRef.current = hit.point;
      changedRef.current = changed;
      const target = event.target as CapturableTarget;
      target.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event) => {
      if (activePointerRef.current !== event.pointerId) return;
      blockEvent(event);
      const hit = paintHitFromEvent(surface, event);
      if (!hit) {
        activeIslandRef.current = null;
        lastPointRef.current = null;
        return;
      }

      const sameIsland = activeIslandRef.current === hit.islandIndex;
      changedRef.current = paintAt(
        hit.point,
        sameIsland ? lastPointRef.current : null,
        hit.atlas,
        hit.islandIndex
      ) || changedRef.current;
      activeIslandRef.current = hit.islandIndex;
      lastPointRef.current = hit.point;
    },
    onPointerUp: finishStroke,
    onPointerCancel: finishStroke
  };
}
