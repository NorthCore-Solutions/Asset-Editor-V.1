import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';

const BASE_ZOOM_SPEED = 1.25;
const MAX_ZOOM_SPEED = 3.75;
const MAX_VIEWPORT_PIXEL_RATIO = 1.5;
const INTERACTION_PIXEL_RATIO = 1;
const RESOLUTION_RESTORE_DELAY_MS = 140;

interface OrbitControlApi {
  target: THREE.Vector3;
  zoomSpeed: number;
  zoomToCursor: boolean;
  minDistance: number;
  maxDistance: number;
  dampingFactor: number;
  addEventListener: (type: 'start' | 'end', listener: () => void) => void;
  removeEventListener: (type: 'start' | 'end', listener: () => void) => void;
}

interface ViewportPerformanceEntry {
  references: number;
  gl: THREE.WebGLRenderer;
  controls: OrbitControlApi;
  restoreTimer: number | null;
  previousPixelRatio: number;
  previousShadowAutoUpdate: boolean;
  previousZoomSpeed: number;
  previousZoomToCursor: boolean;
  previousMinDistance: number;
  previousMaxDistance: number;
  previousDampingFactor: number;
  startInteraction: () => void;
  endInteraction: () => void;
  handleWheel: () => void;
}

const viewportPerformanceEntries = new WeakMap<THREE.Scene, ViewportPerformanceEntry>();

export function cappedViewportPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return THREE.MathUtils.clamp(devicePixelRatio, 1, MAX_VIEWPORT_PIXEL_RATIO);
}

export function zoomSpeedForDistance(distance: number): number {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 10;
  return THREE.MathUtils.clamp(
    BASE_ZOOM_SPEED + 1.5 / (safeDistance + 0.5),
    BASE_ZOOM_SPEED,
    MAX_ZOOM_SPEED
  );
}

function preferredPixelRatio(): number {
  return cappedViewportPixelRatio(window.devicePixelRatio || 1);
}

function setPixelRatio(gl: THREE.WebGLRenderer, value: number): void {
  if (Math.abs(gl.getPixelRatio() - value) < 0.001) return;
  gl.setPixelRatio(value);
}

export function useViewportPerformance(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry
): void {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;

  useEffect(() => {
    if (!controls) return;

    let entry = viewportPerformanceEntries.get(scene);
    if (!entry) {
      const previousPixelRatio = gl.getPixelRatio();
      const previousShadowAutoUpdate = gl.shadowMap.autoUpdate;
      const previousZoomSpeed = controls.zoomSpeed;
      const previousZoomToCursor = controls.zoomToCursor;
      const previousMinDistance = controls.minDistance;
      const previousMaxDistance = controls.maxDistance;
      const previousDampingFactor = controls.dampingFactor;

      const restoreResolution = (): void => {
        const current = viewportPerformanceEntries.get(scene);
        if (!current) return;
        current.restoreTimer = null;
        setPixelRatio(gl, preferredPixelRatio());
      };

      const startInteraction = (): void => {
        const current = viewportPerformanceEntries.get(scene);
        if (!current) return;
        if (current.restoreTimer !== null) {
          window.clearTimeout(current.restoreTimer);
          current.restoreTimer = null;
        }
        setPixelRatio(gl, INTERACTION_PIXEL_RATIO);
      };

      const endInteraction = (): void => {
        const current = viewportPerformanceEntries.get(scene);
        if (!current) return;
        if (current.restoreTimer !== null) window.clearTimeout(current.restoreTimer);
        current.restoreTimer = window.setTimeout(restoreResolution, RESOLUTION_RESTORE_DELAY_MS);
      };

      const handleWheel = (): void => {
        controls.zoomSpeed = zoomSpeedForDistance(camera.position.distanceTo(controls.target));
        startInteraction();
      };

      entry = {
        references: 0,
        gl,
        controls,
        restoreTimer: null,
        previousPixelRatio,
        previousShadowAutoUpdate,
        previousZoomSpeed,
        previousZoomToCursor,
        previousMinDistance,
        previousMaxDistance,
        previousDampingFactor,
        startInteraction,
        endInteraction,
        handleWheel
      };
      viewportPerformanceEntries.set(scene, entry);

      controls.zoomSpeed = zoomSpeedForDistance(camera.position.distanceTo(controls.target));
      controls.zoomToCursor = true;
      controls.minDistance = 0.08;
      controls.maxDistance = 500;
      controls.dampingFactor = 0.1;
      controls.addEventListener('start', startInteraction);
      controls.addEventListener('end', endInteraction);
      gl.domElement.addEventListener('wheel', handleWheel, { capture: true, passive: true });

      setPixelRatio(gl, preferredPixelRatio());
      gl.shadowMap.autoUpdate = false;
      gl.shadowMap.needsUpdate = true;
    }

    entry.references += 1;

    return () => {
      const current = viewportPerformanceEntries.get(scene);
      if (!current) return;
      current.references -= 1;
      if (current.references > 0) return;

      if (current.restoreTimer !== null) window.clearTimeout(current.restoreTimer);
      current.controls.removeEventListener('start', current.startInteraction);
      current.controls.removeEventListener('end', current.endInteraction);
      current.gl.domElement.removeEventListener('wheel', current.handleWheel, true);
      current.controls.zoomSpeed = current.previousZoomSpeed;
      current.controls.zoomToCursor = current.previousZoomToCursor;
      current.controls.minDistance = current.previousMinDistance;
      current.controls.maxDistance = current.previousMaxDistance;
      current.controls.dampingFactor = current.previousDampingFactor;
      current.gl.shadowMap.autoUpdate = current.previousShadowAutoUpdate;
      current.gl.shadowMap.needsUpdate = true;
      setPixelRatio(current.gl, current.previousPixelRatio);
      viewportPerformanceEntries.delete(scene);
    };
  }, [camera, controls, gl, scene]);

  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [
    geometry,
    gl,
    object.material.opacity,
    object.material.paintTexture?.dataUrl,
    object.position[0],
    object.position[1],
    object.position[2],
    object.rotation[0],
    object.rotation[1],
    object.rotation[2],
    object.scale[0],
    object.scale[1],
    object.scale[2],
    object.visible
  ]);
}
