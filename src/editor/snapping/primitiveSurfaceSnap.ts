import type { PrimitiveType, SceneObjectData, Vec3 } from '../../types/editor';
import { findAppleCutterSurfaceSnap } from '../appleCutter/appleCutterSnap';
import {
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';

export type {
  ObjectSurfaceSnapResult as FormSurfaceSnapResult,
  SurfaceSnapTarget
};

export {
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects
};

/**
 * Übergangsadapter für bestehende Viewport-Aufrufstellen. Der eigentliche
 * Solver liegt ausschließlich im Apfelschneider-Modul und enthält keinen
 * globalen Desktop- oder Android-Sonderzustand.
 */
export function resetFormSurfaceSnapSessions(): void {
  // Kein globaler Snap-Zustand vorhanden.
}

export function findFormSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  return findAppleCutterSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets
  );
}

export function findTouchFormSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  _transactionToken: unknown,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  return findAppleCutterSurfaceSnap(
    source,
    objects,
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
  return findAppleCutterSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets
  ).position;
}

export const snapObjectToObjectSurfaces = snapFormToFormSurfaces;

/** Oberflächen-Snap gilt für alle registrierten Editorformen. */
export const isFormType = (type: PrimitiveType): boolean => {
  void type;
  return true;
};
