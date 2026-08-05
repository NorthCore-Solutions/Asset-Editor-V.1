import type { PrimitiveType, SceneObjectData, Vec3 } from '../../types/editor';
import {
  findObjectSurfaceSnap as findNearbyObjectSurfaceSnap,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findSweptObjectSurfaceSnap } from './sweptObjectSurfaceSnap';

export type {
  ObjectSurfaceSnapResult as FormSurfaceSnapResult,
  SurfaceSnapTarget
};

export {
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject
};

export function findFormSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const swept = findSweptObjectSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets
  );
  if (swept) return swept;

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
