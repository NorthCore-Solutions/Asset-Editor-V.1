import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import type { PrimitiveType, SceneObjectData, Vec3 } from '../../types/editor';

const FORM_TYPES = new Set<PrimitiveType>([
  'box',
  'cuboid',
  'sphere',
  'hemisphere',
  'cylinder',
  'cone',
  'pyramid',
  'plane',
  'torus',
  'wedge',
  'prism'
]);

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

export interface FormSurfaceSnapResult {
  position: Vec3;
  targetId: string | null;
  distance: number;
}

interface ScaleInteraction {
  active: boolean;
  direction: THREE.Vector3 | null;
}

const axisValue = (vector: THREE.Vector3, axis: Axis): number => vector[axis];
const setAxisValue = (vector: THREE.Vector3, axis: Axis, value: number): void => {
  vector[axis] = value;
};

const matrixForObject = (object: SceneObjectData): THREE.Matrix4 => {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    quaternion,
    new THREE.Vector3(...object.scale)
  );
};

const geometryBounds = (object: SceneObjectData): THREE.Box3 => {
  const geometry = createGeometry(object);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone()
    ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  geometry.dispose();
  return bounds;
};

const boxCorners = (box: THREE.Box3): THREE.Vector3[] => [
  new THREE.Vector3(box.min.x, box.min.y, box.min.z),
  new THREE.Vector3(box.min.x, box.min.y, box.max.z),
  new THREE.Vector3(box.min.x, box.max.y, box.min.z),
  new THREE.Vector3(box.min.x, box.max.y, box.max.z),
  new THREE.Vector3(box.max.x, box.min.y, box.min.z),
  new THREE.Vector3(box.max.x, box.min.y, box.max.z),
  new THREE.Vector3(box.max.x, box.max.y, box.min.z),
  new THREE.Vector3(box.max.x, box.max.y, box.max.z)
];

const overlapsWithTolerance = (
  source: THREE.Box3,
  target: THREE.Box3,
  axis: Axis,
  tolerance: number
): boolean => axisValue(source.max, axis) >= axisValue(target.min, axis) - tolerance
  && axisValue(source.min, axis) <= axisValue(target.max, axis) + tolerance;

const snapInsideTargetGrid = (value: number, minimum: number, step: number): number => {
  if (!Number.isFinite(step) || step <= 0) return value;
  return minimum + Math.round((value - minimum) / step) * step;
};

const localAxisVector = (axis: Axis): THREE.Vector3 => {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0);
  if (axis === 'y') return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
};

const detectScaleInteraction = (source: SceneObjectData, objects: SceneObjectData[]): ScaleInteraction => {
  const storedSource = objects.find((object) => object.id === source.id);
  if (!storedSource) return { active: false, direction: null };

  const scaleDeltas = source.scale.map((value, index) => value - storedSource.scale[index]);
  const changedAxes = AXES
    .map((axis, index) => ({ axis, index, delta: scaleDeltas[index] }))
    .filter((entry) => Math.abs(entry.delta) > 0.000001)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  if (changedAxes.length === 0) return { active: false, direction: null };

  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...source.rotation));
  const positionDelta = new THREE.Vector3(
    source.position[0] - storedSource.position[0],
    source.position[1] - storedSource.position[1],
    source.position[2] - storedSource.position[2]
  );

  if (changedAxes.length === 1 || Math.abs(changedAxes[0].delta) > Math.abs(changedAxes[1].delta) * 1.8) {
    const dominant = changedAxes[0];
    const worldAxis = localAxisVector(dominant.axis).applyQuaternion(quaternion).normalize();
    const positionAlongAxis = positionDelta.dot(worldAxis);
    const side = Math.abs(positionAlongAxis) > 0.000001
      ? Math.sign(positionAlongAxis / dominant.delta)
      : 1;
    return {
      active: true,
      direction: worldAxis.multiplyScalar(side || 1).normalize()
    };
  }

  const averageScaleDelta = changedAxes.reduce((sum, entry) => sum + entry.delta, 0) / changedAxes.length;
  if (positionDelta.lengthSq() > 0.00000001) {
    const direction = positionDelta.normalize();
    if (averageScaleDelta < 0) direction.multiplyScalar(-1);
    return { active: true, direction };
  }

  const fallback = localAxisVector(changedAxes[0].axis).applyQuaternion(quaternion).normalize();
  return { active: true, direction: fallback };
};

export const isFormType = (type: PrimitiveType): boolean => FORM_TYPES.has(type);

export function findFormSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number
): FormSurfaceSnapResult {
  const unchanged: FormSurfaceSnapResult = {
    position: [...source.position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY
  };
  if (!isFormType(source.type)) return unchanged;

  const sourceBounds = geometryBounds(source);
  const sourceMatrix = matrixForObject(source);
  const sourceWorldCorners = boxCorners(sourceBounds).map((corner) => corner.applyMatrix4(sourceMatrix));
  const sourcePosition = new THREE.Vector3(...source.position);
  const worldThreshold = Math.max(0.4, Math.abs(positionStep) * 2);
  const scaleInteraction = detectScaleInteraction(source, objects);
  let bestPosition: THREE.Vector3 | null = null;
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of objects) {
    if (target.id === source.id || !target.visible || !isFormType(target.type)) continue;

    const targetBounds = geometryBounds(target);
    const targetMatrix = matrixForObject(target);
    const inverseTargetMatrix = targetMatrix.clone().invert();
    const sourceInTarget = new THREE.Box3().setFromPoints(
      sourceWorldCorners.map((corner) => corner.clone().applyMatrix4(inverseTargetMatrix))
    );
    const targetScale = new THREE.Vector3(
      Math.max(0.0001, Math.abs(target.scale[0])),
      Math.max(0.0001, Math.abs(target.scale[1])),
      Math.max(0.0001, Math.abs(target.scale[2]))
    );
    const sourceCenter = sourceInTarget.getCenter(new THREE.Vector3());

    for (const axis of AXES) {
      const axisScale = axisValue(targetScale, axis);
      const localThreshold = worldThreshold / axisScale;
      const otherAxes = AXES.filter((candidate) => candidate !== axis);
      if (!otherAxes.every((otherAxis) => overlapsWithTolerance(sourceInTarget, targetBounds, otherAxis, localThreshold * 0.75))) continue;

      const faceOffsets = [
        axisValue(targetBounds.min, axis) - axisValue(sourceInTarget.max, axis),
        axisValue(targetBounds.max, axis) - axisValue(sourceInTarget.min, axis)
      ];

      for (const faceOffset of faceOffsets) {
        if (Math.abs(faceOffset) > localThreshold) continue;

        const localOffset = new THREE.Vector3();
        setAxisValue(localOffset, axis, faceOffset);

        if (!scaleInteraction.active) {
          for (const otherAxis of otherAxes) {
            const localStep = positionStep > 0 ? positionStep / axisValue(targetScale, otherAxis) : 0;
            const snappedCenter = snapInsideTargetGrid(
              axisValue(sourceCenter, otherAxis),
              axisValue(targetBounds.min, otherAxis),
              localStep
            );
            const gridCorrection = snappedCenter - axisValue(sourceCenter, otherAxis);
            const maximumGridCorrection = localStep > 0 ? localStep * 0.55 : 0;
            if (localStep > 0 && Math.abs(gridCorrection) <= maximumGridCorrection) {
              setAxisValue(localOffset, otherAxis, gridCorrection);
            }
          }
        }

        const targetOriginWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(targetMatrix);
        const offsetWorld = localOffset.clone().applyMatrix4(targetMatrix).sub(targetOriginWorld);
        const distance = offsetWorld.length();
        if (distance <= 0.000001) continue;

        if (scaleInteraction.active && scaleInteraction.direction) {
          const alignment = Math.abs(offsetWorld.clone().normalize().dot(scaleInteraction.direction));
          if (alignment < 0.82) continue;
        }

        if (distance >= bestDistance) continue;

        bestDistance = distance;
        bestPosition = sourcePosition.clone().add(offsetWorld);
        bestTargetId = target.id;
      }
    }
  }

  return bestPosition
    ? {
      position: [bestPosition.x, bestPosition.y, bestPosition.z],
      targetId: bestTargetId,
      distance: bestDistance
    }
    : unchanged;
}

export function snapFormToFormSurfaces(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number
): Vec3 {
  return findFormSurfaceSnap(source, objects, positionStep).position;
}
