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
const AWAY_RELEASE_DISTANCE = 0.015;
const SIDE_RELEASE_DISTANCE = 0.07;

interface TranslationSnapLock {
  targetId: string;
  rawOrigin: Vec3;
  acceptedOrigin: Vec3;
  releaseDirection: Vec3;
}

interface TranslationSnapSession {
  transactionToken: unknown;
  rawPosition: Vec3;
  acceptedPosition: Vec3;
  rotation: Vec3;
  scale: Vec3;
  lock: TranslationSnapLock | null;
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

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2]
  ];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const vectorLength = length(vector);
  if (vectorLength > EPSILON) {
    return [
      vector[0] / vectorLength,
      vector[1] / vectorLength,
      vector[2] / vectorLength
    ];
  }

  const fallbackLength = length(fallback);
  if (fallbackLength <= EPSILON) return [1, 0, 0];
  return [
    fallback[0] / fallbackLength,
    fallback[1] / fallbackLength,
    fallback[2] / fallbackLength
  ];
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

function activeObjectsForTransaction(
  sourceId: string,
  fallbackObjects: SceneObjectData[],
  transactionToken: unknown
): SceneObjectData[] {
  if (!transactionToken) return fallbackObjects;

  const liveObjects = useEditorStore.getState().objects;
  return liveObjects.some((object) => object.id === sourceId)
    ? liveObjects
    : fallbackObjects;
}

function validSession(
  source: SceneObjectData,
  previous: SceneObjectData,
  transactionToken: unknown
): TranslationSnapSession | null {
  const session = translationSnapSessions.get(source.id);
  if (
    !session
    || session.transactionToken !== transactionToken
    || !sameVector(previous.position, session.acceptedPosition)
    || !sameVector(source.rotation, session.rotation)
    || !sameVector(source.scale, session.scale)
  ) return null;

  return session;
}

function incrementalTranslationSource(
  source: SceneObjectData,
  previous: SceneObjectData,
  session: TranslationSnapSession | null
): SceneObjectData {
  if (!session) return source;

  return {
    ...source,
    position: add(
      previous.position,
      subtract(source.position, session.rawPosition)
    )
  };
}

function lockedTranslationSource(
  source: SceneObjectData,
  lock: TranslationSnapLock
): SceneObjectData {
  return {
    ...source,
    position: add(
      lock.acceptedOrigin,
      subtract(source.position, lock.rawOrigin)
    )
  };
}

function breakawayDistance(positionStep: number): number {
  return Math.min(0.3, Math.max(0.16, Math.abs(positionStep) * 0.75));
}

function shouldReleaseLock(
  source: SceneObjectData,
  lock: TranslationSnapLock,
  positionStep: number
): boolean {
  const rawDelta = subtract(source.position, lock.rawOrigin);
  const totalDistance = length(rawDelta);
  if (totalDistance > breakawayDistance(positionStep)) return true;

  const awayDistance = dot(rawDelta, lock.releaseDirection);
  if (awayDistance > AWAY_RELEASE_DISTANCE) return true;

  const sideDistanceSquared = Math.max(
    0,
    totalDistance * totalDistance - awayDistance * awayDistance
  );
  return Math.sqrt(sideDistanceSquared) > SIDE_RELEASE_DISTANCE;
}

function createLock(
  rawSource: SceneObjectData,
  evaluatedSource: SceneObjectData,
  previous: SceneObjectData,
  result: ObjectSurfaceSnapResult
): TranslationSnapLock | null {
  if (!result.targetId) return null;

  const awayFromSurface = subtract(evaluatedSource.position, result.position);
  const oppositeMovement = subtract(previous.position, evaluatedSource.position);
  return {
    targetId: result.targetId,
    rawOrigin: [...rawSource.position] as Vec3,
    acceptedOrigin: [...result.position] as Vec3,
    releaseDirection: normalize(awayFromSurface, oppositeMovement)
  };
}

function rememberTranslationStep(
  rawSource: SceneObjectData,
  acceptedPosition: Vec3,
  transactionToken: unknown,
  lock: TranslationSnapLock | null
): void {
  translationSnapSessions.set(rawSource.id, {
    transactionToken,
    rawPosition: [...rawSource.position] as Vec3,
    acceptedPosition: [...acceptedPosition] as Vec3,
    rotation: [...rawSource.rotation] as Vec3,
    scale: [...rawSource.scale] as Vec3,
    lock
  });
}

function statelessTranslationSnap(
  source: SceneObjectData,
  previous: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[]
): ObjectSurfaceSnapResult {
  if (sameVector(source.position, previous.position)) {
    return unchangedResult(source, previous.position);
  }

  return findSweptObjectSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets
  ) ?? unchangedResult(source);
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
  const transactionToken = currentTransactionToken();
  const activeObjects = activeObjectsForTransaction(
    source.id,
    objects,
    transactionToken
  );
  const previous = activeObjects.find((object) => object.id === source.id);

  if (previous && sameRotationAndScale(source, previous)) {
    if (!transactionToken) {
      translationSnapSessions.delete(source.id);
      return statelessTranslationSnap(
        source,
        previous,
        activeObjects,
        positionStep,
        additionalTargets
      );
    }

    const session = validSession(source, previous, transactionToken);
    if (session?.lock) {
      if (!shouldReleaseLock(source, session.lock, positionStep)) {
        rememberTranslationStep(
          source,
          session.lock.acceptedOrigin,
          transactionToken,
          session.lock
        );
        return {
          position: [...session.lock.acceptedOrigin] as Vec3,
          targetId: session.lock.targetId,
          distance: 0
        };
      }

      const releasedSource = lockedTranslationSource(source, session.lock);
      const released = unchangedResult(releasedSource);
      rememberTranslationStep(
        source,
        released.position,
        transactionToken,
        null
      );
      return released;
    }

    const incrementalSource = incrementalTranslationSource(
      source,
      previous,
      session
    );
    const result = statelessTranslationSnap(
      incrementalSource,
      previous,
      activeObjects,
      positionStep,
      additionalTargets
    );
    const lock = createLock(source, incrementalSource, previous, result);

    rememberTranslationStep(
      source,
      result.position,
      transactionToken,
      lock
    );
    return result;
  }

  translationSnapSessions.delete(source.id);
  return findNearbyObjectSurfaceSnap(
    source,
    activeObjects.filter((object) => object.id !== source.id),
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
