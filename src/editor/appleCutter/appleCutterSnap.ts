import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
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

function internalTargets(
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

/**
 * Formen-Snap verwendet ausschließlich die inneren Apfelschneider-Schnitte.
 * Außenflächen bleiben sichtbar, sind aber keine Fangziele.
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
  const threshold = Math.min(0.12, Math.max(0.04, Math.abs(positionStep) * 0.4));
  return findInternalCutterTargetSnap(
    sourceTarget,
    internalTargets(source, objects, additionalTargets),
    new THREE.Vector3(...source.position),
    threshold
  );
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
