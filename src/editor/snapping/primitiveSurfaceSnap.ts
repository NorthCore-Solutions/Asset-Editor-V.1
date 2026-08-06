import type { PrimitiveType, SceneObjectData, Vec3 } from '../../types/editor';
import {
  findObjectSurfaceSnap as findNearbyObjectSurfaceSnap,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects,
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
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects
};

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

/**
 * Kompatibilitätsfunktion. Der zustandsbehaftete Android-/Desktop-Sonderpfad
 * wurde entfernt; Drag-Sitzungen werden jetzt ausschließlich im Viewport über
 * den gemeinsamen Translation-Controller geführt.
 */
export function resetFormSurfaceSnapSessions(): void {
  // Kein globaler Snap-Zustand mehr vorhanden.
}

export function findFormSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
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

  return findNearbyObjectSurfaceSnap(
    source,
    objects.filter((object) => object.id !== source.id),
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
  return findFormSurfaceSnap(source, objects, positionStep, additionalTargets);
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

/** Oberflächen-Snap gilt für alle registrierten Formen. */
export const isFormType = (type: PrimitiveType): boolean => {
  void type;
  return true;
};
