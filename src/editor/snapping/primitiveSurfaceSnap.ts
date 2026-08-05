import type { PrimitiveType, SceneObjectData, Vec3 } from '../../types/editor';
import { useEditorStore } from '../../store/editorStore';
import {
  findObjectSurfaceSnap as findNearbyObjectSurfaceSnap,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findSweptObjectSurfaceSnap } from './sweptObjectSurfaceSnap';

const EPSILON = 0.000001;

interface TranslationSnapSession {
  transactionToken: unknown;
  rawPosition: Vec3;
  acceptedPosition: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

const translationSnapSessions = new Map<string, TranslationSnapSession>();

export type {
  ObjectSurfaceSnapResult as FormSurfaceSnapResult,
  SurfaceSnapTarget
};

export {
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject
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

function unchangedResult(
  source: SceneObjectData,
  position: Vec3 = source.position
): ObjectSurfaceSnapResult {
  return {
    position: [...position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY
  };
}

function currentTransactionToken(): unknown {
  return useEditorStore.getState().transactionStart;
}

function incrementalTranslationSource(
  source: SceneObjectData,
  previous: SceneObjectData,
  transactionToken: unknown
): SceneObjectData {
  const session = translationSnapSessions.get(source.id);
  const canContinueSession = session
    && session.transactionToken === transactionToken
    && sameVector(previous.position, session.acceptedPosition)
    && sameVector(source.rotation, session.rotation)
    && sameVector(source.scale, session.scale);

  if (!canContinueSession) return source;

  return {
    ...source,
    position: [
      previous.position[0] + source.position[0] - session.rawPosition[0],
      previous.position[1] + source.position[1] - session.rawPosition[1],
      previous.position[2] + source.position[2] - session.rawPosition[2]
    ]
  };
}

function rememberTranslationStep(
  rawSource: SceneObjectData,
  acceptedPosition: Vec3,
  transactionToken: unknown
): void {
  translationSnapSessions.set(rawSource.id, {
    transactionToken,
    rawPosition: [...rawSource.position] as Vec3,
    acceptedPosition: [...acceptedPosition] as Vec3,
    rotation: [...rawSource.rotation] as Vec3,
    scale: [...rawSource.scale] as Vec3
  });
}

export function resetFormSurfaceSnapSessions(): void {
  translationSnapSessions.clear();
}

export function findFormSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const previous = objects.find((object) => object.id === source.id);

  if (previous && sameRotationAndScale(source, previous)) {
    const transactionToken = currentTransactionToken();
    const incrementalSource = incrementalTranslationSource(
      source,
      previous,
      transactionToken
    );

    const result = sameVector(incrementalSource.position, previous.position)
      ? unchangedResult(incrementalSource, previous.position)
      : findSweptObjectSurfaceSnap(
        incrementalSource,
        objects,
        positionStep,
        additionalTargets
      ) ?? unchangedResult(incrementalSource);

    rememberTranslationStep(source, result.position, transactionToken);
    return result;
  }

  translationSnapSessions.delete(source.id);
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
