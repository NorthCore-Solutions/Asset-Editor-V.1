import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { CameraView, SceneObjectData } from '../../types/editor';
import {
  atlasIslandAtUv,
  atlasPixelRegion,
  getSurfaceUvAtlas,
  type SurfaceUvAtlas
} from '../../geometry/uvAtlas';
import {
  getSurfaceTileRepeats,
  repeatUvInsideIsland,
  type SurfaceTileRepeat
} from '../../geometry/surfaceTileGrid';
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
  displayCanvas: HTMLCanvasElement;
  displayContext: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

interface PaintHit {
  point: [number, number];
  islandIndex: number;
  tileKey: string;
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
  target: THREE.Vector3;
  update: () => void;
}

interface CameraTransition {
  startedAt: number;
  duration: number;
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  startUp: THREE.Vector3;
  upRotation: THREE.Quaternion;
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

function copySourceToDisplay(surface: PaintSurface): void {
  const image = surface.context.getImageData(0, 0, surface.canvas.width, surface.canvas.height);
  surface.displayContext.putImageData(image, 0, 0);
  surface.texture.needsUpdate = true;
}

function fillSurface(surface: PaintSurface, color: string): void {
  const image = createFilledImageData(surface.canvas.width, surface.canvas.height, hexToRgba(color));
  surface.context.putImageData(image, 0, 0);
  surface.displayContext.putImageData(image, 0, 0);
  surface.texture.needsUpdate = true;
}

function createSurface(color: string): PaintSurface {
  const canvas = document.createElement('canvas');
  const displayCanvas = document.createElement('canvas');
  canvas.width = DEFAULT_PAINT_SIZE;
  canvas.height = DEFAULT_PAINT_SIZE;
  displayCanvas.width = DEFAULT_PAINT_SIZE;
  displayCanvas.height = DEFAULT_PAINT_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const displayContext = displayCanvas.getContext('2d', { willReadFrequently: true });
  if (!context || !displayContext) throw new Error('2D-Kontext für Oberflächenbemalung nicht verfügbar.');
  context.imageSmoothingEnabled = false;
  displayContext.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(displayCanvas);
  configureTexture(texture);
  const surface = { canvas, context, displayCanvas, displayContext, texture };
  fillSurface(surface, color);
  return surface;
}

function resizeSurface(surface: PaintSurface, width: number, height: number): void {
  if (
    surface.canvas.width === width
    && surface.canvas.height === height
    && surface.displayCanvas.width === width
    && surface.displayCanvas.height === height
  ) return;

  surface.canvas.width = width;
  surface.canvas.height = height;
  surface.displayCanvas.width = width;
  surface.displayCanvas.height = height;
  surface.context.imageSmoothingEnabled = false;
  surface.displayContext.imageSmoothingEnabled = false;
  surface.texture.needsUpdate = true;
}

function renderTiledSurface(
  surface: PaintSurface,
  atlas: SurfaceUvAtlas,
  repeats: SurfaceTileRepeat[]
): void {
  const width = surface.canvas.width;
  const height = surface.canvas.height;
  if (width <= 0 || height <= 0) return;

  const source = surface.context.getImageData(0, 0, width, height);
  const output = new ImageData(new Uint8ClampedArray(source.data), width, height);

  atlas.islands.forEach((_, islandIndex) => {
    const region = atlasPixelRegion(atlas, islandIndex, width, height);
    const regionWidth = Math.max(1, region.maxX - region.minX + 1);
    const regionHeight = Math.max(1, region.maxY - region.minY + 1);
    const repeat = repeats[islandIndex] ?? { u: 1, v: 1 };

    for (let y = region.minY; y <= region.maxY; y += 1) {
      const localY = (y - region.minY + 0.5) / regionHeight;
      const repeatedY = localY * repeat.v - Math.floor(localY * repeat.v);
      const sourceY = Math.min(region.maxY, region.minY + Math.floor(repeatedY * regionHeight));

      for (let x = region.minX; x <= region.maxX; x += 1) {
        const localX = (x - region.minX + 0.5) / regionWidth;
        const repeatedX = localX * repeat.u - Math.floor(localX * repeat.u);
        const sourceX = Math.min(region.maxX, region.minX + Math.floor(repeatedX * regionWidth));
        const sourceOffset = (sourceY * width + sourceX) * 4;
        const targetOffset = (y * width + x) * 4;
        output.data[targetOffset] = source.data[sourceOffset];
        output.data[targetOffset + 1] = source.data[sourceOffset + 1];
        output.data[targetOffset + 2] = source.data[sourceOffset + 2];
        output.data[targetOffset + 3] = source.data[sourceOffset + 3];
      }
    }
  });

  surface.displayContext.putImageData(output, 0, 0);
  surface.texture.needsUpdate = true;
}

function paintHitFromEvent(
  surface: PaintSurface,
  event: ThreeEvent<PointerEvent>,
  atlas: SurfaceUvAtlas,
  repeats: SurfaceTileRepeat[]
): PaintHit | null {
  if (!event.uv || !(event.object instanceof THREE.Mesh)) return null;
  const islandIndex = atlasIslandAtUv(atlas, event.uv);
  const island = atlas.islands[islandIndex];
  if (!island) return null;

  const repeat = repeats[islandIndex] ?? { u: 1, v: 1 };
  const islandWidth = Math.max(0.000001, island.uMax - island.uMin);
  const islandHeight = Math.max(0.000001, island.vMax - island.vMin);
  const localU = THREE.MathUtils.clamp((event.uv.x - island.uMin) / islandWidth, 0, 0.999999);
  const localV = THREE.MathUtils.clamp((event.uv.y - island.vMin) / islandHeight, 0, 0.999999);
  const tileU = Math.floor(localU * repeat.u);
  const tileV = Math.floor(localV * repeat.v);
  const repeatedUv = repeatUvInsideIsland(atlas, islandIndex, event.uv, repeat);
  const u = THREE.MathUtils.clamp(repeatedUv.x, 0, 0.999999);
  const v = THREE.MathUtils.clamp(repeatedUv.y, 0, 0.999999);

  return {
    point: [
      Math.max(0, Math.min(surface.canvas.width - 1, Math.floor(u * surface.canvas.width))),
      Math.max(0, Math.min(surface.canvas.height - 1, Math.floor((1 - v) * surface.canvas.height)))
    ],
    islandIndex,
    tileKey: `${islandIndex}:${tileU}:${tileV}`,
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

function cameraDestination(
  view: CameraView,
  target: THREE.Vector3,
  distance: number
): { position: THREE.Vector3; up: THREE.Vector3 } | null {
  const up = new THREE.Vector3(0, 1, 0);

  switch (view) {
    case 'front':
      return { position: target.clone().add(new THREE.Vector3(0, 0, distance)), up };
    case 'back':
      return { position: target.clone().add(new THREE.Vector3(0, 0, -distance)), up };
    case 'left':
      return { position: target.clone().add(new THREE.Vector3(-distance, 0, 0)), up };
    case 'right':
      return { position: target.clone().add(new THREE.Vector3(distance, 0, 0)), up };
    case 'top':
      return {
        position: target.clone().add(new THREE.Vector3(0, distance, 0.001)),
        up: new THREE.Vector3(0, 0, -1)
      };
    case 'bottom':
      return {
        position: target.clone().add(new THREE.Vector3(0, -distance, 0.001)),
        up: new THREE.Vector3(0, 0, 1)
      };
    default:
      return null;
  }
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function useSurfacePaintSettings(): SurfacePaintSettings {
  const [settings, setSettings] = useState<SurfacePaintSettings>(() => getSurfacePaintSettings());
  useEffect(() => subscribeSurfacePaint(setSettings), []);
  return settings;
}

export function useSurfacePaint(
  object: SceneObjectData,
  selected: boolean,
  settings: SurfacePaintSettings,
  geometry: THREE.BufferGeometry
): SurfacePaintBinding {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const [surface] = useState<PaintSurface>(() => createSurface(object.material.color));
  const atlas = useMemo(() => getSurfaceUvAtlas(geometry), [geometry]);
  const tileRepeats = useMemo(
    () => getSurfaceTileRepeats(geometry, object.scale),
    [geometry, object.scale[0], object.scale[1], object.scale[2]]
  );
  const tileRepeatsRef = useRef<SurfaceTileRepeat[]>(tileRepeats);
  tileRepeatsRef.current = tileRepeats;
  const loadedDataUrlRef = useRef<string | null>(null);
  const requestedDataUrlRef = useRef<string | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeIslandRef = useRef<number | null>(null);
  const activeTileRef = useRef<string | null>(null);
  const lastPointRef = useRef<[number, number] | null>(null);
  const changedRef = useRef(false);
  const wasActiveRef = useRef(false);
  const handledCameraRequestRef = useRef(settings.cameraRequestId);
  const cameraTransitionRef = useRef<CameraTransition | null>(null);
  const paintTexture = object.material.paintTexture;
  const active = settings.enabled && selected && object.visible && !object.locked;
  const textureVisible = active || Boolean(paintTexture);

  useEffect(() => {
    renderTiledSurface(surface, atlas, tileRepeats);
  }, [atlas, surface, tileRepeats]);

  useEffect(() => {
    if (settings.cameraRequestId === handledCameraRequestRef.current || !controls) return;
    handledCameraRequestRef.current = settings.cameraRequestId;
    if (!selected || !settings.cameraView) return;

    const target = new THREE.Vector3(...object.position);
    const distance = Math.max(
      3.5,
      Math.max(Math.abs(object.scale[0]), Math.abs(object.scale[1]), Math.abs(object.scale[2])) * 4
    );
    const destination = cameraDestination(settings.cameraView, target, distance);
    if (!destination) return;

    const startUp = camera.up.clone().normalize();
    const endUp = destination.up.clone().normalize();
    cameraTransitionRef.current = {
      startedAt: performance.now(),
      duration: 420,
      startPosition: camera.position.clone(),
      endPosition: destination.position,
      startTarget: controls.target.clone(),
      endTarget: target,
      startUp,
      upRotation: new THREE.Quaternion().setFromUnitVectors(startUp, endUp)
    };
  }, [
    camera,
    controls,
    object.position[0],
    object.position[1],
    object.position[2],
    object.scale[0],
    object.scale[1],
    object.scale[2],
    selected,
    settings.cameraRequestId,
    settings.cameraView
  ]);

  useFrame(() => {
    if (active && controls) {
      controls.enabled = true;
      controls.enablePan = false;
      controls.enableRotate = true;
    }

    const transition = cameraTransitionRef.current;
    if (!transition || !controls || !selected) return;
    const progress = THREE.MathUtils.clamp(
      (performance.now() - transition.startedAt) / transition.duration,
      0,
      1
    );
    const eased = smoothStep(progress);
    const upStep = new THREE.Quaternion().identity().slerp(transition.upRotation, eased);

    camera.position.lerpVectors(transition.startPosition, transition.endPosition, eased);
    controls.target.lerpVectors(transition.startTarget, transition.endTarget, eased);
    camera.up.copy(transition.startUp).applyQuaternion(upStep).normalize();
    camera.lookAt(controls.target);
    camera.updateMatrixWorld(true);
    controls.update();

    if (progress >= 1) cameraTransitionRef.current = null;
  });

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      return;
    }

    if (!wasActiveRef.current || !controls) return;
    wasActiveRef.current = false;
    controls.enabled = true;
    controls.enablePan = true;
    controls.enableRotate = true;
    camera.up.set(0, 1, 0);
    controls.update();
    camera.updateMatrixWorld(true);
  }, [active, camera, controls]);

  useEffect(() => () => {
    if (activePointerRef.current !== null) {
      activePointerRef.current = null;
      activeIslandRef.current = null;
      activeTileRef.current = null;
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
      renderTiledSurface(surface, atlas, tileRepeatsRef.current);
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
      renderTiledSurface(surface, atlas, tileRepeatsRef.current);
    };

    image.onerror = () => {
      if (requestedDataUrlRef.current === paintTexture.dataUrl) requestedDataUrlRef.current = null;
    };

    image.src = paintTexture.dataUrl;
  }, [atlas, object.material.color, paintTexture?.dataUrl, paintTexture?.height, paintTexture?.width, surface]);

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
    currentAtlas: SurfaceUvAtlas,
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
        atlasPixelRegion(currentAtlas, islandIndex, image.width, image.height)
      );
    } else {
      const color = settings.tool === 'eraser'
        ? hexToRgba('#000000', 0)
        : hexToRgba(settings.color);
      const points = previous ? linePoints(previous, point) : [point];
      points.forEach(([x, y]) => paintBrush(image, x, y, settings.brushSize, color));
    }

    surface.context.putImageData(image, 0, 0);
    renderTiledSurface(surface, currentAtlas, tileRepeatsRef.current);
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
    activeTileRef.current = null;
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
      const hit = paintHitFromEvent(surface, event, atlas, tileRepeatsRef.current);
      if (!hit) return;
      setSurfacePaintSettings({ islandIndex: hit.islandIndex });

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
      activeTileRef.current = hit.tileKey;
      lastPointRef.current = hit.point;
      changedRef.current = changed;
      const target = event.target as CapturableTarget;
      target.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event) => {
      if (activePointerRef.current !== event.pointerId) return;
      blockEvent(event);
      const hit = paintHitFromEvent(surface, event, atlas, tileRepeatsRef.current);
      if (!hit) {
        activeIslandRef.current = null;
        activeTileRef.current = null;
        lastPointRef.current = null;
        return;
      }

      const sameIsland = activeIslandRef.current === hit.islandIndex;
      const sameTile = sameIsland && activeTileRef.current === hit.tileKey;
      if (!sameIsland) setSurfacePaintSettings({ islandIndex: hit.islandIndex });
      changedRef.current = paintAt(
        hit.point,
        sameTile ? lastPointRef.current : null,
        hit.atlas,
        hit.islandIndex
      ) || changedRef.current;
      activeIslandRef.current = hit.islandIndex;
      activeTileRef.current = hit.tileKey;
      lastPointRef.current = hit.point;
    },
    onPointerUp: finishStroke,
    onPointerCancel: finishStroke
  };
}
