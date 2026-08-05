import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import {
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from './surfaceSnapTopology';

const EPSILON = 0.000001;

interface SweepCandidate {
  position: Vec3;
  targetId: string;
  distance: number;
  travel: number;
  lateralDistance: number;
  normalAlignment: number;
}

function matrixForSceneObject(object: SceneObjectData): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
}

function unchangedRotationAndScale(
  source: SceneObjectData,
  previous: SceneObjectData
): boolean {
  return source.rotation.every((value, index) => (
    Math.abs(value - (previous.rotation[index] ?? value)) <= EPSILON
  )) && source.scale.every((value, index) => (
    Math.abs(value - (previous.scale[index] ?? value)) <= EPSILON
  ));
}

function previousTranslatedSource(
  source: SceneObjectData,
  objects: readonly SceneObjectData[]
): SceneObjectData | null {
  const previous = objects.find((object) => object.id === source.id);
  if (
    !previous
    || previous.type !== source.type
    || !unchangedRotationAndScale(source, previous)
  ) return null;

  const movement = new THREE.Vector3(...source.position)
    .sub(new THREE.Vector3(...previous.position));
  return movement.lengthSq() > EPSILON * EPSILON ? previous : null;
}

function hashCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function hashKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function buildAnchorHash(
  anchors: readonly SurfaceSnapAnchor[],
  cellSize: number
): Map<string, SurfaceSnapAnchor[]> {
  const hash = new Map<string, SurfaceSnapAnchor[]>();
  for (const anchor of anchors) {
    const key = hashKey(
      hashCoordinate(anchor.position.x, cellSize),
      hashCoordinate(anchor.position.y, cellSize),
      hashCoordinate(anchor.position.z, cellSize)
    );
    const bucket = hash.get(key);
    if (bucket) bucket.push(anchor);
    else hash.set(key, [anchor]);
  }
  return hash;
}

function anchorsInsideBounds(
  hash: Map<string, SurfaceSnapAnchor[]>,
  bounds: THREE.Box3,
  cellSize: number
): SurfaceSnapAnchor[] {
  const minimumX = hashCoordinate(bounds.min.x, cellSize);
  const minimumY = hashCoordinate(bounds.min.y, cellSize);
  const minimumZ = hashCoordinate(bounds.min.z, cellSize);
  const maximumX = hashCoordinate(bounds.max.x, cellSize);
  const maximumY = hashCoordinate(bounds.max.y, cellSize);
  const maximumZ = hashCoordinate(bounds.max.z, cellSize);
  const result: SurfaceSnapAnchor[] = [];

  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        const bucket = hash.get(hashKey(x, y, z));
        if (bucket) result.push(...bucket);
      }
    }
  }
  return result;
}

function worldBounds(target: SurfaceSnapTarget, padding: number): THREE.Box3 {
  return target.localBounds.clone()
    .applyMatrix4(target.matrixWorld)
    .expandByScalar(padding);
}

function targetsForSweep(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[]
): SurfaceSnapTarget[] {
  return [
    ...objects.flatMap((object) => {
      if (object.id === source.id) return [];
      const target = surfaceSnapTargetFromSceneObject(object, positionStep);
      return target ? [target] : [];
    }),
    ...additionalTargets
  ];
}

function betterCandidate(
  candidate: SweepCandidate,
  current: SweepCandidate | null
): boolean {
  if (!current) return true;
  if (candidate.travel < current.travel - EPSILON) return true;
  if (Math.abs(candidate.travel - current.travel) > EPSILON) return false;
  if (candidate.lateralDistance < current.lateralDistance - EPSILON) return true;
  if (Math.abs(candidate.lateralDistance - current.lateralDistance) > EPSILON) return false;
  return candidate.normalAlignment < current.normalAlignment;
}

export function findSweptObjectSurfaceSnap(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult | null {
  const previous = previousTranslatedSource(source, objects);
  if (!previous) return null;

  const sourceTarget = surfaceSnapTargetFromSceneObject(source, positionStep);
  if (!sourceTarget) return null;

  const previousAnchors = transformSurfaceSnapAnchors(
    sourceTarget.anchors,
    matrixForSceneObject(previous)
  );
  const currentAnchors = transformSurfaceSnapAnchors(
    sourceTarget.anchors,
    sourceTarget.matrixWorld
  );
  if (previousAnchors.length !== currentAnchors.length) return null;

  const sourcePosition = new THREE.Vector3(...source.position);
  const previousPosition = new THREE.Vector3(...previous.position);
  const movement = sourcePosition.clone().sub(previousPosition);
  const movementLength = movement.length();
  if (movementLength <= EPSILON) return null;

  const direction = movement.clone().divideScalar(movementLength);
  const tangentialTolerance = Math.max(0.08, Math.abs(positionStep) * 0.9);
  const hashCellSize = Math.max(0.1, tangentialTolerance);
  const targets = targetsForSweep(source, objects, positionStep, additionalTargets);
  let best: SweepCandidate | null = null;

  for (const target of targets) {
    if (!target.visible || target.anchors.length === 0) continue;

    const targetAnchors = transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
    const targetHash = buildAnchorHash(targetAnchors, hashCellSize);
    const expandedTargetBounds = worldBounds(target, tangentialTolerance);

    for (let index = 0; index < currentAnchors.length; index += 1) {
      const currentAnchor = currentAnchors[index];
      const previousAnchor = previousAnchors[index];
      if (!currentAnchor || !previousAnchor) continue;

      const segmentBounds = new THREE.Box3()
        .setFromPoints([previousAnchor.position, currentAnchor.position])
        .expandByScalar(tangentialTolerance);
      if (!segmentBounds.intersectsBox(expandedTargetBounds)) continue;
      segmentBounds.intersect(expandedTargetBounds);

      for (const targetAnchor of anchorsInsideBounds(targetHash, segmentBounds, hashCellSize)) {
        const relative = targetAnchor.position.clone().sub(previousAnchor.position);
        const travel = relative.dot(direction) / movementLength;
        if (travel < -EPSILON || travel > 1 + EPSILON) continue;

        const closestPoint = previousAnchor.position.clone()
          .addScaledVector(direction, travel * movementLength);
        const lateralDistance = closestPoint.distanceTo(targetAnchor.position);
        if (lateralDistance > tangentialTolerance + EPSILON) continue;

        const targetProjection = targetAnchor.position.dot(direction);
        const currentProjection = currentAnchor.position.dot(direction);
        const correctionAlongMovement = targetProjection - currentProjection;
        if (correctionAlongMovement > EPSILON) continue;

        const correctedPosition = sourcePosition.clone()
          .addScaledVector(direction, correctionAlongMovement);
        const candidate: SweepCandidate = {
          position: [correctedPosition.x, correctedPosition.y, correctedPosition.z],
          targetId: target.id,
          distance: Math.abs(correctionAlongMovement),
          travel,
          lateralDistance,
          normalAlignment: currentAnchor.normal.dot(targetAnchor.normal)
        };
        if (betterCandidate(candidate, best)) best = candidate;
      }
    }
  }

  return best
    ? {
      position: best.position,
      targetId: best.targetId,
      distance: best.distance
    }
    : null;
}

export { surfaceSnapTargetFromObject3D };
