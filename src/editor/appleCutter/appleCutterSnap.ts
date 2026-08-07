import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  findSurfaceTargetSnap,
  surfaceSnapTargetFromSceneObject,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from '../snapping/objectSurfaceSnap';
import { findInternalCutterTargetSnap } from '../snapping/internalCutterSnap';
import { findSweptObjectSurfaceSnap } from '../snapping/sweptObjectSurfaceSnap';

const EPSILON = 0.000001;

function sameVector(left: Vec3, right: Vec3): boolean {
  return left.every((value, index) => (
    Math.abs(value - (right[index] ?? value)) <= EPSILON
  ));
}

function sameRotationAndScale(
  source: SceneObjectData,
  previous: SceneObjectData
): boolean {
  return sameVector(source.rotation, previous.rotation)
    && sameVector(source.scale, previous.scale);
}

function unchangedResult(source: SceneObjectData): ObjectSurfaceSnapResult {
  return {
    position: [...source.position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY,
    sourceAnchorId: null,
    targetAnchorId: null
  };
}

function snapTargets(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  additionalTargets: readonly SurfaceSnapTarget[]
): SurfaceSnapTarget[] {
  return [
    ...objects.flatMap((object) => {
      if (object.id === source.id) return [];
      const target = surfaceSnapTargetFromSceneObject(object);
      return target ? [target] : [];
    }),
    ...additionalTargets
  ];
}

function nearerResult(
  first: ObjectSurfaceSnapResult,
  second: ObjectSurfaceSnapResult
): ObjectSurfaceSnapResult {
  if (!first.targetId) return second;
  if (!second.targetId) return first;
  return first.distance <= second.distance + EPSILON ? first : second;
}

/**
 * Formen-Snap kombiniert die äußeren Oberflächen-Snappoints mit den inneren
 * zentrierten Apfelschneider-Schnitten. Beide Ebenen bleiben gleichzeitig aktiv.
 */
export function findAppleCutterSurfaceSnap(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const previous = objects.find((object) => object.id === source.id);

  if (previous && sameRotationAndScale(source, previous)) {
    if (sameVector(source.position, previous.position)) return unchangedResult(source);
    return findSweptObjectSurfaceSnap(
      source,
      objects,
      positionStep,
      additionalTargets
    ) ?? unchangedResult(source);
  }

  const sourceTarget = surfaceSnapTargetFromSceneObject(source);
  if (!sourceTarget) return unchangedResult(source);
  const targets = snapTargets(source, objects, additionalTargets);
  const threshold = Math.min(0.12, Math.max(0.04, Math.abs(positionStep) * 0.4));
  const sourcePosition = new THREE.Vector3(...source.position);
  const internal = findInternalCutterTargetSnap(
    sourceTarget,
    targets,
    sourcePosition,
    threshold
  );
  const outer = findSurfaceTargetSnap(
    sourceTarget,
    targets,
    sourcePosition,
    threshold
  );
  return nearerResult(outer, internal);
}

export function snapAppleCutterSurfaces(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): Vec3 {
  return findAppleCutterSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets
  ).position;
}
