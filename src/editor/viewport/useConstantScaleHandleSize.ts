import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';

const AXIS_HANDLE_PIXELS = 10;
const CORNER_HANDLE_PIXELS = 11;
const CENTER_HANDLE_PIXELS = 10;
const MIN_VIEWPORT_HEIGHT = 1;
const SCAN_INTERVAL_MS = 8;

interface HandleSizing {
  visualSize: number;
  pixels: number;
}

const lastSceneScan = new WeakMap<THREE.Scene, number>();
const patchedHandles = new WeakSet<THREE.Object3D>();

function approximately(value: number | undefined, expected: number): boolean {
  return typeof value === 'number' && Math.abs(value - expected) < 0.0001;
}

function octahedronRadius(object: THREE.Object3D): number | null {
  if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.OctahedronGeometry)) {
    return null;
  }
  const parameters = object.geometry.parameters as { radius?: number };
  return typeof parameters.radius === 'number' ? parameters.radius : null;
}

function handleSizing(object: THREE.Object3D): HandleSizing | null {
  if (object instanceof THREE.Mesh && object.renderOrder === 1000 && object.geometry instanceof THREE.BoxGeometry) {
    const parameters = object.geometry.parameters;
    if (
      approximately(parameters.width, 0.72)
      && approximately(parameters.height, 0.72)
      && approximately(parameters.depth, 0.72)
    ) {
      return { visualSize: 0.72, pixels: AXIS_HANDLE_PIXELS };
    }
  }

  if (object instanceof THREE.Mesh && object.renderOrder === 1001 && object.geometry instanceof THREE.PlaneGeometry) {
    const parameters = object.geometry.parameters;
    if (approximately(parameters.width, 1.05) && approximately(parameters.height, 1.05)) {
      return { visualSize: 1.05, pixels: CORNER_HANDLE_PIXELS };
    }
  }

  if (object instanceof THREE.Group && object.renderOrder === Number.POSITIVE_INFINITY && object.children.length === 2) {
    const radii = object.children
      .map(octahedronRadius)
      .filter((radius): radius is number => radius !== null)
      .sort((left, right) => left - right);
    if (radii.length === 2 && approximately(radii[0], 0.1) && approximately(radii[1], 0.2)) {
      return { visualSize: 0.2, pixels: CENTER_HANDLE_PIXELS };
    }
  }

  return null;
}

export function worldSizeForScreenPixels(
  camera: THREE.Camera,
  worldPosition: THREE.Vector3,
  viewportHeight: number,
  pixels: number
): number {
  const safeHeight = Math.max(MIN_VIEWPORT_HEIGHT, viewportHeight);

  if (camera instanceof THREE.PerspectiveCamera) {
    const distance = Math.max(0.0001, camera.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition));
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
    return Math.max(0.0001, visibleHeight * pixels / safeHeight);
  }

  if (camera instanceof THREE.OrthographicCamera) {
    const visibleHeight = Math.abs(camera.top - camera.bottom) / Math.max(0.0001, camera.zoom);
    return Math.max(0.0001, visibleHeight * pixels / safeHeight);
  }

  return Math.max(0.0001, pixels / safeHeight);
}

function patchHandleScale(
  object: THREE.Object3D,
  sizing: HandleSizing,
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer
): void {
  if (patchedHandles.has(object)) return;

  const scale = object.scale;
  const originalSetScalar = scale.setScalar;
  const worldPosition = new THREE.Vector3();

  scale.setScalar = function setConstantScreenSize(this: THREE.Vector3): THREE.Vector3 {
    object.getWorldPosition(worldPosition);
    const viewportHeight = renderer.domElement.clientHeight || renderer.domElement.height;
    const worldSize = worldSizeForScreenPixels(camera, worldPosition, viewportHeight, sizing.pixels);
    return originalSetScalar.call(this, worldSize / sizing.visualSize);
  };

  patchedHandles.add(object);
}

export function useConstantScaleHandleSize(): void {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.gl);
  const tool = useEditorStore((state) => state.tool);
  const selectedCount = useEditorStore((state) => state.selectedIds.length);

  useFrame(() => {
    if (tool !== 'scale' || selectedCount !== 1) return;

    const now = performance.now();
    const lastScan = lastSceneScan.get(scene) ?? Number.NEGATIVE_INFINITY;
    if (now - lastScan < SCAN_INTERVAL_MS) return;
    lastSceneScan.set(scene, now);

    scene.traverse((candidate) => {
      const sizing = handleSizing(candidate);
      if (sizing) patchHandleScale(candidate, sizing, camera, renderer);
    });
  });
}
