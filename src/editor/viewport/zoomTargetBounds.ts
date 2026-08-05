import * as THREE from 'three';

export {
  combineWorldBounds,
  worldBoundsFromObject3D,
  worldBoundsFromSceneObject
} from '../spatial/worldBounds';

export interface ZoomTargetBounds {
  focus: THREE.Vector3;
  minimumDepth: number;
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
