import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData, Vec3 } from '../../types/editor';

const AXES = ['x', 'y', 'z'] as const;
const BOUNDS_EPSILON = 0.000001;
type Axis = (typeof AXES)[number];

export interface ObjectSurfaceSnapResult {
  position: Vec3;
  targetId: string | null;
  distance: number;
}

export interface SurfaceSnapTarget {
  id: string;
  visible: boolean;
  localBounds: THREE.Box3;
  matrixWorld: THREE.Matrix4;
}

interface ScaleInteraction {
  active: boolean;
  direction: THREE.Vector3 | null;
}

interface ChangedScaleAxis {
  axis: Axis;
  delta: number;
}

const axisValue = (vector: THREE.Vector3, axis: Axis): number => vector[axis];
const setAxisValue = (vector: THREE.Vector3, axis: Axis, value: number): void => {
  vector[axis] = value;
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

const hasFiniteBounds = (bounds: THREE.Box3): boolean => [
  bounds.min.x,
  bounds.min.y,
  bounds.min.z,
  bounds.max.x,
  bounds.max.y,
  bounds.max.z
].every(Number.isFinite) && !bounds.isEmpty();

const matrixForSceneObject = (object: SceneObjectData): THREE.Matrix4 => {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    quaternion,
    new THREE.Vector3(...object.scale)
  );
};

const localBoundsForSceneObject = (object: SceneObjectData): THREE.Box3 | null => {
  const geometry = createGeometry(object);
  try {
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox?.clone();
    return bounds && hasFiniteBounds(bounds) ? bounds : null;
  } finally {
    geometry.dispose();
  }
};

export function surfaceSnapTargetFromSceneObject(object: SceneObjectData): SurfaceSnapTarget | null {
  const localBounds = localBoundsForSceneObject(object);
  if (!localBounds) return null;
  return {
    id: object.id,
    visible: object.visible,
    localBounds,
    matrixWorld: matrixForSceneObject(object)
  };
}

export function surfaceSnapTargetFromObject3D(
  root: THREE.Object3D,
  id: string = root.uuid
): SurfaceSnapTarget | null {
  root.updateWorldMatrix(true, true);
  const inverseRootMatrix = root.matrixWorld.clone().invert();
  const localBounds = new THREE.Box3().makeEmpty();

  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return;

    mesh.geometry.computeBoundingBox();
    const geometryBounds = mesh.geometry.boundingBox;
    if (!geometryBounds || !hasFiniteBounds(geometryBounds)) return;

    const meshToRoot = inverseRootMatrix.clone().multiply(mesh.matrixWorld);
    for (const corner of boxCorners(geometryBounds)) {
      localBounds.expandByPoint(corner.applyMatrix4(meshToRoot));
    }
  });

  if (!hasFiniteBounds(localBounds)) return null;
  return {
    id,
    visible: root.visible,
    localBounds,
    matrixWorld: root.matrixWorld.clone()
  };
}

const overlapsWithTolerance = (
  source: THREE.Box3,
  target: THREE.Box3,
  axis: Axis,
  tolerance: number
): boolean => axisValue(source.max, axis) >= axisValue(target.min, axis) - tolerance
  && axisValue(source.min, axis) <= axisValue(target.max, axis) + tolerance;

const overlapsWithoutGap = (source: THREE.Box3, target: THREE.Box3, axis: Axis): boolean =>
  Math.min(axisValue(source.max, axis), axisValue(target.max, axis))
    - Math.max(axisValue(source.min, axis), axisValue(target.min, axis)) >= -BOUNDS_EPSILON;

const snapInsideTargetGrid = (value: number, minimum: number, step: number): number => {
  if (!Number.isFinite(step) || step <= 0) return value;
  return minimum + Math.round((value - minimum) / step) * step;
};

const gridPlanes = (minimum: number, maximum: number, step: number): number[] => {
  if (!Number.isFinite(step) || step <= 0 || maximum <= minimum) return [minimum, maximum];

  const planes = [minimum];
  const count = Math.min(2048, Math.floor((maximum - minimum) / step));
  for (let index = 1; index <= count; index += 1) {
    const coordinate = minimum + index * step;
    if (coordinate >= maximum - BOUNDS_EPSILON) break;
    planes.push(coordinate);
  }
  planes.push(maximum);
  return planes;
};

const localAxisVector = (axis: Axis): THREE.Vector3 => {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0);
  if (axis === 'y') return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
};

const matrixScale = (matrix: THREE.Matrix4): THREE.Vector3 => {
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return new THREE.Vector3(
    Math.max(0.0001, Math.abs(scale.x)),
    Math.max(0.0001, Math.abs(scale.y)),
    Math.max(0.0001, Math.abs(scale.z))
  );
};

const detectScaleInteraction = (source: SceneObjectData, objects: SceneObjectData[]): ScaleInteraction => {
  const storedSource = objects.find((object) => object.id === source.id);
  if (!storedSource) return { active: false, direction: null };

  const scaleDeltas: Vec3 = [
    source.scale[0] - storedSource.scale[0],
    source.scale[1] - storedSource.scale[1],
    source.scale[2] - storedSource.scale[2]
  ];
  const changedAxes: ChangedScaleAxis[] = AXES
    .map((axis, index): ChangedScaleAxis => ({ axis, delta: scaleDeltas[index] ?? 0 }))
    .filter((entry) => Math.abs(entry.delta) > BOUNDS_EPSILON)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  const [dominant, secondary] = changedAxes;
  if (!dominant) return { active: false, direction: null };

  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...source.rotation));
  const positionDelta = new THREE.Vector3(
    source.position[0] - storedSource.position[0],
    source.position[1] - storedSource.position[1],
    source.position[2] - storedSource.position[2]
  );

  if (!secondary || Math.abs(dominant.delta) > Math.abs(secondary.delta) * 1.8) {
    const worldAxis = localAxisVector(dominant.axis).applyQuaternion(quaternion).normalize();
    const positionAlongAxis = positionDelta.dot(worldAxis);
    const side = Math.abs(positionAlongAxis) > BOUNDS_EPSILON
      ? Math.sign(positionAlongAxis / dominant.delta)
      : 1;
    return {
      active: true,
      direction: worldAxis.multiplyScalar(side || 1).normalize()
    };
  }

  const averageScaleDelta = changedAxes.reduce((sum, entry) => sum + entry.delta, 0) / changedAxes.length;
  if (positionDelta.lengthSq() > BOUNDS_EPSILON * BOUNDS_EPSILON) {
    const direction = positionDelta.normalize();
    if (averageScaleDelta < 0) direction.multiplyScalar(-1);
    return { active: true, direction };
  }

  const fallback = localAxisVector(dominant.axis).applyQuaternion(quaternion).normalize();
  return { active: true, direction: fallback };
};

export function findObjectSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const unchanged: ObjectSurfaceSnapResult = {
    position: [...source.position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY
  };
  const sourceTarget = surfaceSnapTargetFromSceneObject(source);
  if (!sourceTarget) return unchanged;

  const sourceWorldCorners = boxCorners(sourceTarget.localBounds)
    .map((corner) => corner.applyMatrix4(sourceTarget.matrixWorld));
  const sourcePosition = new THREE.Vector3(...source.position);
  const worldThreshold = Math.max(0.4, Math.abs(positionStep) * 2);
  const scaleInteraction = detectScaleInteraction(source, objects);
  const targets = [
    ...objects.flatMap((object) => {
      const target = surfaceSnapTargetFromSceneObject(object);
      return target ? [target] : [];
    }),
    ...additionalTargets
  ];
  let bestPosition: THREE.Vector3 | null = null;
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    if (target.id === source.id || !target.visible || !hasFiniteBounds(target.localBounds)) continue;

    const targetBounds = target.localBounds;
    const targetMatrix = target.matrixWorld;
    const inverseTargetMatrix = targetMatrix.clone().invert();
    const sourceInTarget = new THREE.Box3().setFromPoints(
      sourceWorldCorners.map((corner) => corner.clone().applyMatrix4(inverseTargetMatrix))
    );
    const targetScale = matrixScale(targetMatrix);

    if (scaleInteraction.active && scaleInteraction.direction) {
      const targetOriginWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(targetMatrix);
      const localOrigin = targetOriginWorld.clone().applyMatrix4(inverseTargetMatrix);
      const localDirectionPerWorld = targetOriginWorld
        .clone()
        .add(scaleInteraction.direction)
        .applyMatrix4(inverseTargetMatrix)
        .sub(localOrigin);

      for (const axis of AXES) {
        const directionComponent = axisValue(localDirectionPerWorld, axis);
        if (Math.abs(directionComponent) < BOUNDS_EPSILON) continue;

        const localThreshold = worldThreshold * Math.abs(directionComponent);
        const otherAxes = AXES.filter((candidate) => candidate !== axis);
        if (!otherAxes.every((otherAxis) => overlapsWithTolerance(
          sourceInTarget,
          targetBounds,
          otherAxis,
          localThreshold * 0.75
        ))) continue;

        const activeSourceFace = directionComponent > 0
          ? axisValue(sourceInTarget.max, axis)
          : axisValue(sourceInTarget.min, axis);
        const localStep = positionStep > 0
          ? positionStep / axisValue(targetScale, axis)
          : 0;

        for (const plane of gridPlanes(
          axisValue(targetBounds.min, axis),
          axisValue(targetBounds.max, axis),
          localStep
        )) {
          const localDistance = plane - activeSourceFace;
          const worldDistanceAlongDrag = localDistance / directionComponent;
          const distance = Math.abs(worldDistanceAlongDrag);
          if (distance > worldThreshold || distance >= bestDistance) continue;

          bestDistance = distance;
          bestPosition = sourcePosition
            .clone()
            .addScaledVector(scaleInteraction.direction, worldDistanceAlongDrag);
          bestTargetId = target.id;
        }
      }

      continue;
    }

    const sourceCenter = sourceInTarget.getCenter(new THREE.Vector3());
    for (const axis of AXES) {
      const axisScale = axisValue(targetScale, axis);
      const localThreshold = worldThreshold / axisScale;
      const otherAxes = AXES.filter((candidate) => candidate !== axis);
      if (!otherAxes.every((otherAxis) => overlapsWithTolerance(
        sourceInTarget,
        targetBounds,
        otherAxis,
        localThreshold * 0.75
      ))) continue;

      const faceOffsets = [
        axisValue(targetBounds.min, axis) - axisValue(sourceInTarget.max, axis),
        axisValue(targetBounds.max, axis) - axisValue(sourceInTarget.min, axis)
      ];

      for (const faceOffset of faceOffsets) {
        if (Math.abs(faceOffset) > localThreshold) continue;
        if (
          Math.abs(faceOffset) <= BOUNDS_EPSILON
          && !otherAxes.every((otherAxis) => overlapsWithoutGap(sourceInTarget, targetBounds, otherAxis))
        ) continue;

        const localOffset = new THREE.Vector3();
        setAxisValue(localOffset, axis, faceOffset);

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

        const targetOriginWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(targetMatrix);
        const offsetWorld = localOffset.clone().applyMatrix4(targetMatrix).sub(targetOriginWorld);
        const distance = offsetWorld.length();
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

export function snapObjectToObjectSurfaces(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): Vec3 {
  return findObjectSurfaceSnap(source, objects, positionStep, additionalTargets).position;
}
