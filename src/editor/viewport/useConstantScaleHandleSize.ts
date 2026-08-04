import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';

const AXIS_HANDLE_WORLD_SIZE = 0.06;
const CORNER_HANDLE_WORLD_SIZE = 0.0648;
const CENTER_HANDLE_WORLD_SIZE = 0.06;
const SCAN_INTERVAL_MS = 8;

interface HandleSizing {
  visualSize: number;
  worldSize: number;
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
      return { visualSize: 0.72, worldSize: AXIS_HANDLE_WORLD_SIZE };
    }
  }

  if (object instanceof THREE.Mesh && object.renderOrder === 1001 && object.geometry instanceof THREE.PlaneGeometry) {
    const parameters = object.geometry.parameters;
    if (approximately(parameters.width, 1.05) && approximately(parameters.height, 1.05)) {
      return { visualSize: 1.05, worldSize: CORNER_HANDLE_WORLD_SIZE };
    }
  }

  if (object instanceof THREE.Group && object.renderOrder === Number.POSITIVE_INFINITY && object.children.length === 2) {
    const radii = object.children
      .map(octahedronRadius)
      .filter((radius): radius is number => radius !== null)
      .sort((left, right) => left - right);
    if (radii.length === 2 && approximately(radii[0], 0.1) && approximately(radii[1], 0.2)) {
      return { visualSize: 0.2, worldSize: CENTER_HANDLE_WORLD_SIZE };
    }
  }

  return null;
}

function patchHandleScale(object: THREE.Object3D, sizing: HandleSizing): void {
  if (patchedHandles.has(object)) return;

  const scale = object.scale;
  const originalSetScalar = scale.setScalar;

  scale.setScalar = function setConstantWorldSize(this: THREE.Vector3): THREE.Vector3 {
    return originalSetScalar.call(this, sizing.worldSize / sizing.visualSize);
  };

  patchedHandles.add(object);
}

export function useConstantScaleHandleSize(): void {
  const scene = useThree((state) => state.scene);
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
      if (sizing) patchHandleScale(candidate, sizing);
    });
  });
}
