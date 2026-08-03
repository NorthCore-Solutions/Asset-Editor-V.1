import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { CameraView, SceneObjectData } from '../../types/editor';
import { getSurfaceUvAtlas, type SurfaceUvAtlas } from '../../geometry/uvAtlas';
import {
  composeSurfaceAtlasCanvas,
  createPaintTextureData,
  getSurfaceRasterMetrics,
  loadSurfaceCanvases,
  resizeSurfaceCanvases,
  surfaceMetricsKey,
  surfacePointFromUv,
  type SurfaceRasterMetric
} from './surfacePaintGrid';
import {
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
  layers: HTMLCanvasElement[];
}

interface PaintHit {
  point: [number, number];
  islandIndex: number;
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

function createSurface(): PaintSurface {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D-Kontext für Oberflächenbemalung nicht verfügbar.');
  context.imageSmoothingEnabled = false;
  const texture = new THREE.CanvasTexture(canvas);
  configureTexture(texture);
  return { canvas, context, texture, layers: [] };
}

function renderAtlas(
  surface: PaintSurface,
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): void {
  const composed = composeSurfaceAtlasCanvas(surface.layers, atlas, metrics, baseColor);
  if (surface.canvas.width !== composed.width || surface.canvas.height !== composed.height) {
    surface.canvas.width = composed.width;
    surface.canvas.height = composed.height;
    surface.context.imageSmoothingEnabled = false;
  }
  surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
  surface.context.drawImage(composed, 0, 0);
  surface.texture.needsUpdate = true;
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
    case 'front': return { position: target.clone().add(new THREE.Vector3(0, 0, distance)), up };
    case 'back': return { position: target.clone().add(new THREE.Vector3(0, 0, -distance)), up };
    case 'left': return { position: target.clone().add(new THREE.Vector3(-distance, 0, 0)), up };
    case 'right': return { position: target.clone().add(new THREE.Vector3(distance, 0, 0)), up };
    case 'top': return {
      position: target.clone().add(new THREE.Vector3(0, distance, 0.001)),
      up: new THREE.Vector3(0, 0, -1)
    };
    case 'bottom': return {
      position: target.clone().add(new THREE.Vector3(0, -distance, 0.001)),
      up: new THREE.Vector3(0, 0, 1)
    };
    default: return null;
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
  const [surface] = useState<PaintSurface>(createSurface);
  const [textureReady, setTextureReady] = useState(false);
  const atlas = useMemo(() => getSurfaceUvAtlas(geometry), [geometry]);
  const metrics = useMemo(
    () => getSurfaceRasterMetrics(geometry, object.scale, atlas),
    [atlas, geometry, object.scale[0], object.scale[1], object.scale[2]]
  );
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const metricsKey = surfaceMetricsKey(metrics);

  const loadedDataUrlRef = useRef<string | null | undefined>(undefined);
  const requestedDataUrlRef = useRef<string | null | undefined>(undefined);
  const loadRequestRef = useRef(0);
  const persistTimeoutRef = useRef<number | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeIslandRef = useRef<number | null>(null);
  const lastPointRef = useRef<[number, number] | null>(null);
  const changedRef = useRef(false);
  const wasActiveRef = useRef(false);
  const handledCameraRequestRef = useRef(settings.cameraRequestId);
  const cameraTransitionRef = useRef<CameraTransition | null>(null);
  const paintTexture = object.material.paintTexture;
  const active = settings.enabled && selected && object.visible && !object.locked;
  const textureVisible = active || Boolean(paintTexture);

  const persist = (): void => {
    const created = createPaintTextureData(
      surface.layers,
      atlas,
      metricsRef.current,
      object.material.color
    );
    const data = created.surfaceGrid
      ? {
          ...created,
          surfaceGrid: {
            ...created.surfaceGrid,
            baseColor: object.material.color.toUpperCase()
          }
        }
      : created;
    loadedDataUrlRef.current = data.dataUrl;
    requestedDataUrlRef.current = null;
    updateMaterial(object.id, { paintTexture: data }, false);
  };

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
    loadRequestRef.current += 1;
    if (persistTimeoutRef.current !== null) window.clearTimeout(persistTimeoutRef.current);
    if (activePointerRef.current !== null) {
      activePointerRef.current = null;
      activeIslandRef.current = null;
      endTransaction();
    }
    surface.texture.dispose();
  }, [endTransaction, surface]);

  useEffect(() => {
    const dataUrl = paintTexture?.dataUrl ?? null;
    if (surface.layers.length > 0 && loadedDataUrlRef.current === dataUrl) return;
    if (requestedDataUrlRef.current === dataUrl) return;

    const requestId = ++loadRequestRef.current;
    requestedDataUrlRef.current = dataUrl;
    setTextureReady(false);
    void loadSurfaceCanvases(paintTexture, atlas, metricsRef.current, object.material.color)
      .then((layers) => {
        if (loadRequestRef.current !== requestId) return;
        surface.layers = layers;
        renderAtlas(surface, atlas, metricsRef.current, object.material.color);
        requestedDataUrlRef.current = null;
        loadedDataUrlRef.current = dataUrl;
        setTextureReady(true);

        if (paintTexture) {
          const currentGrid = paintTexture.surfaceGrid;
          const needsMigration = !currentGrid
            || currentGrid.atlasSignature !== atlas.signature
            || currentGrid.baseColor?.toUpperCase() !== object.material.color.toUpperCase()
            || !currentGrid.sourceDataUrl
            || !currentGrid.sourceWidth
            || !currentGrid.sourceHeight
            || currentGrid.surfaces.length !== metricsRef.current.length
            || currentGrid.surfaces.some((stored, index) => {
              const metric = metricsRef.current[index];
              return !metric
                || stored.width !== metric.width
                || stored.height !== metric.height
                || Math.abs(stored.coverageU - metric.coverageU) > 0.000001
                || Math.abs(stored.coverageV - metric.coverageV) > 0.000001;
            });
          if (needsMigration) persist();
        }
      })
      .catch(() => {
        if (loadRequestRef.current === requestId) {
          requestedDataUrlRef.current = null;
          setTextureReady(false);
        }
      });
  }, [atlas, object.material.color, paintTexture?.dataUrl, paintTexture?.height, paintTexture?.width, surface]);

  useEffect(() => {
    if (surface.layers.length === 0) return;
    surface.layers = resizeSurfaceCanvases(surface.layers, metrics, object.material.color);
    renderAtlas(surface, atlas, metrics, object.material.color);
    setTextureReady(true);

    if (!paintTexture) return;
    if (persistTimeoutRef.current !== null) window.clearTimeout(persistTimeoutRef.current);
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null;
      persist();
    }, 140);
  }, [atlas, metricsKey, object.material.color, surface]);

  const paintAt = (islandIndex: number, point: [number, number], previous: [number, number] | null): boolean => {
    const layer = surface.layers[islandIndex];
    const context = layer?.getContext('2d', { willReadFrequently: true });
    if (!layer || !context) return false;
    const image = context.getImageData(0, 0, layer.width, layer.height);

    if (settings.tool === 'eyedropper') {
      const sampled = samplePixel(image, point[0], point[1]);
      if (sampled.a > 0) setSurfacePaintSettings({ color: rgbaToHex(sampled) });
      return false;
    }

    if (settings.tool === 'fill') {
      floodFill(image, point[0], point[1], hexToRgba(settings.color));
    } else {
      const color = settings.tool === 'eraser'
        ? hexToRgba('#000000', 0)
        : hexToRgba(settings.color);
      const points = previous ? linePoints(previous, point) : [point];
      points.forEach(([x, y]) => paintBrush(image, x, y, settings.brushSize, color));
    }

    context.putImageData(image, 0, 0);
    renderAtlas(surface, atlas, metricsRef.current, object.material.color);
    return true;
  };

  const hitFromEvent = (event: ThreeEvent<PointerEvent>): PaintHit | null => {
    if (!event.uv || !(event.object instanceof THREE.Mesh)) return null;
    return surfacePointFromUv(atlas, metricsRef.current, event.uv);
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
    texture: textureVisible && textureReady ? surface.texture : null,
    onPointerDown: (event) => {
      if (!active || event.button !== 0) return;
      blockEvent(event);
      const hit = hitFromEvent(event);
      if (!hit) return;
      setSurfacePaintSettings({ islandIndex: hit.islandIndex });

      if (settings.tool === 'eyedropper') {
        paintAt(hit.islandIndex, hit.point, null);
        return;
      }

      beginTransaction();
      const changed = paintAt(hit.islandIndex, hit.point, null);
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
      const hit = hitFromEvent(event);
      if (!hit) {
        activeIslandRef.current = null;
        lastPointRef.current = null;
        return;
      }

      const sameIsland = activeIslandRef.current === hit.islandIndex;
      if (!sameIsland) setSurfacePaintSettings({ islandIndex: hit.islandIndex });
      changedRef.current = paintAt(
        hit.islandIndex,
        hit.point,
        sameIsland ? lastPointRef.current : null
      ) || changedRef.current;
      activeIslandRef.current = hit.islandIndex;
      lastPointRef.current = hit.point;
    },
    onPointerUp: finishStroke,
    onPointerCancel: finishStroke
  };
}
