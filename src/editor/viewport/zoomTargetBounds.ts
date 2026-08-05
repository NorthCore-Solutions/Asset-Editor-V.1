import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData } from '../../types/editor';

export interface ZoomTargetBounds {
  focus: THREE.Vector3;
  minimumDepth: number;
}

function hasFiniteBounds(bounds: THREE.Box3): boolean {
  return [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z
  ].every(Number.isFinite) && !bounds.isEmpty();
}

export function worldBoundsFromSceneObject(object: SceneObjectData): THREE.Box3 | null {
  const geometry = createGeometry({ type: object.type, geometry: object.geometry });

  try {
    geometry.computeBoundingBox();
    const localBounds = geometry.boundingBox?.clone();
    if (!localBounds || !hasFiniteBounds(localBounds)) return null;

    const worldMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...object.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
      new THREE.Vector3(...object.scale)
    );
    const worldBounds = localBounds.applyMatrix4(worldMatrix);
    return hasFiniteBounds(worldBounds) ? worldBounds : null;
  } finally {
    geometry.dispose();
  }
}

export function worldBoundsFromObject3D(root: THREE.Object3D): THREE.Box3 | null {
  root.updateWorldMatrix(true, true);
  const worldBounds = new THREE.Box3().setFromObject(root, true);
  return hasFiniteBounds(worldBounds) ? worldBounds : null;
}

export function combineWorldBounds(
  entries: Iterable<THREE.Box3 | null | undefined>
): THREE.Box3 | null {
  const combined = new THREE.Box3();
  let hasEntry = false;

  for (const entry of entries) {
    if (!entry || !hasFiniteBounds(entry)) continue;
    combined.union(entry);
    hasEntry = true;
  }

  return hasEntry && hasFiniteBounds(combined) ? combined : null;
}

export function zoomTargetFromWorldBounds(
  bounds: THREE.Box3,
  cameraForward: THREE.Vector3,
  cameraNear: number
): ZoomTargetBounds {
  const focus = bounds.getCenter(new THREE.Vector3());
  const halfSize = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const forward = cameraForward.clone();
  if (forward.lengthSq() < 0.000001) forward.set(0, 0, -1);
  forward.normalize();

  const projectedHalfExtent = (
    Math.abs(forward.x) * halfSize.x
    + Math.abs(forward.y) * halfSize.y
    + Math.abs(forward.z) * halfSize.z
  );
  const safeNear = Number.isFinite(cameraNear) && cameraNear > 0 ? cameraNear : 0.05;
  const surfaceMargin = Math.max(0.02, safeNear * 2);

  return {
    focus,
    minimumDepth: Math.max(surfaceMargin, projectedHalfExtent + surfaceMargin)
  };
}
