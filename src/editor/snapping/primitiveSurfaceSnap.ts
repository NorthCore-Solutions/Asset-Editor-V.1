import type { PrimitiveType, SceneObjectData, Vec3 } from '../../types/editor';
import {
  findObjectSurfaceSnap as findNearbyObjectSurfaceSnap,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findSweptObjectSurfaceSnap } from './sweptObjectSurfaceSnap';

const EPSILON = 0.000001;

export type {
  ObjectSurfaceSnapResult as FormSurfaceSnapResult,
  SurfaceSnapTarget
};

export {
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject
};

function sameRotationAndScale(
  source: SceneObjectData,
  previous: SceneObjectData
): boolean {
  return source.rotation.every((value, index) => (
    Math.abs(value - (previous.rotation[index] ?? value)) <= EPSILON
  )) && source.scale.every((value, index) => (
    Math.abs(value - (previous.scale[index] ?? value)) <= EPSILON
  ));
}

function positionChanged(
  source: SceneObjectData,
  previous: SceneObjectData
): boolean {
  return source.position.some((value, index) => (
    Math.abs(value - (previous.position[index] ?? value)) > EPSILON
  ));
}

function unchangedResult(source: SceneObjectData): ObjectSurfaceSnapResult {
  return {
    position: [...source.position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY
  };
}

export function findFormSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const previous = objects.find((object) => object.id === source.id);

  if (previous && sameRotationAndScale(source, previous)) {
    if (!positionChanged(source, previous)) return unchangedResult(source);

    return findSweptObjectSurfaceSnap(
      source,
      objects,
      positionStep,
      additionalTargets
    ) ?? unchangedResult(source);
  }

  return findNearbyObjectSurfaceSnap(
    source,
    objects.filter((object) => object.id !== source.id),
    positionStep,
    additionalTargets
  );
}

export const findObjectSurfaceSnap = findFormSurfaceSnap;

export function snapFormToFormSurfaces(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): Vec3 {
  return findFormSurfaceSnap(source, objects, positionStep, additionalTargets).position;
}

export const snapObjectToObjectSurfaces = snapFormToFormSurfaces;

/**
 * Kompatibilitätsfunktion für bestehende Viewport-Aufrufstellen.
 * Oberflächen-Snap ist nicht mehr auf eine feste Typenliste begrenzt.
 */
export const isFormType = (type: PrimitiveType): boolean => {
  void type;
  return true;
};
