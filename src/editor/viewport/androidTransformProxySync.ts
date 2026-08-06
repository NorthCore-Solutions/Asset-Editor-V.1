import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData } from '../../types/editor';

interface TransformControlsLike extends THREE.Object3D {
  dragging?: boolean;
  mode?: string;
  object?: THREE.Object3D;
}

export function worldPivotForSceneObject(object: SceneObjectData): THREE.Vector3 {
  const geometry = createGeometry(object);
  try {
    geometry.computeBoundingBox();
    const localCenter = geometry.boundingBox?.getCenter(new THREE.Vector3())
      ?? new THREE.Vector3();
    return localCenter
      .multiply(new THREE.Vector3(...object.scale))
      .applyEuler(new THREE.Euler(...object.rotation))
      .add(new THREE.Vector3(...object.position));
  } finally {
    geometry.dispose();
  }
}

export function syncDraggingTranslateProxy(
  scene: THREE.Scene,
  acceptedPivot: THREE.Vector3
): boolean {
  let synchronized = false;

  scene.traverse((child) => {
    if (synchronized) return;
    const controls = child as TransformControlsLike;
    if (!controls.dragging || controls.mode !== 'translate' || !controls.object) return;

    controls.object.position.copy(acceptedPivot);
    controls.object.updateMatrixWorld(true);
    controls.updateMatrixWorld(true);
    synchronized = true;
  });

  return synchronized;
}
