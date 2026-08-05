import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData, Vec3 } from '../../types/editor';

export function hasFiniteWorldBounds(bounds: THREE.Box3): boolean {
  return [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z
  ].every(Number.isFinite) && !bounds.isEmpty();
}

export function worldBoundsFromSceneObject(
  object: SceneObjectData,
  position: Vec3 = object.position
): THREE.Box3 | null {
  const geometry = createGeometry({ type: object.type, geometry: object.geometry });

  try {
    geometry.computeBoundingBox();
    const localBounds = geometry.boundingBox?.clone();
    if (!localBounds || !hasFiniteWorldBounds(localBounds)) return null;

    const worldMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
      new THREE.Vector3(...object.scale)
    );
    const worldBounds = localBounds.applyMatrix4(worldMatrix);
    return hasFiniteWorldBounds(worldBounds) ? worldBounds : null;
  } finally {
    geometry.dispose();
  }
}

export function worldBoundsFromObject3D(root: THREE.Object3D): THREE.Box3 | null {
  root.updateWorldMatrix(true, true);
  const worldBounds = new THREE.Box3().setFromObject(root, true);
  return hasFiniteWorldBounds(worldBounds) ? worldBounds : null;
}

export function combineWorldBounds(
  entries: Iterable<THREE.Box3 | null | undefined>
): THREE.Box3 | null {
  const combined = new THREE.Box3();
  let hasEntry = false;

  for (const entry of entries) {
    if (!entry || !hasFiniteWorldBounds(entry)) continue;
    combined.union(entry);
    hasEntry = true;
  }

  return hasEntry && hasFiniteWorldBounds(combined) ? combined : null;
}

export function translatedWorldBounds(
  bounds: THREE.Box3,
  translation: THREE.Vector3
): THREE.Box3 {
  return bounds.clone().translate(translation);
}
