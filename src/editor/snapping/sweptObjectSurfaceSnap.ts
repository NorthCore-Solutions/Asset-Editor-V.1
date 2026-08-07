import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';
import {
  surfaceSnapTargetFromSceneObject,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findSweptInternalCutterTargetSnap } from './internalCutterSnap';

const EPSILON = 0.000001;

export interface SweptObjectSurfaceSnapOptions {
  ignoredTargetAnchorId?: string | null;
  ignoredSourceAnchorId?: string | null;
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

export function previousTranslatedSource(
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

function targetsForSweep(
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
 * Kontinuierlicher Formen-Snap ausschließlich über innere Cutter-Ebenen.
 * Außenflächen werden weder als Kontakt noch als Fangziel ausgewertet.
 */
export function findSweptObjectSurfaceSnap(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = [],
  options: SweptObjectSurfaceSnapOptions = {}
): ObjectSurfaceSnapResult | null {
  const previous = previousTranslatedSource(source, objects);
  if (!previous) return null;

  const previousTarget = surfaceSnapTargetFromSceneObject(previous);
  const currentTarget = surfaceSnapTargetFromSceneObject(source);
  if (!previousTarget || !currentTarget) return null;

  return findSweptInternalCutterTargetSnap(
    previousTarget,
    currentTarget,
    targetsForSweep(source, objects, additionalTargets),
    positionStep,
    options
  );
}
