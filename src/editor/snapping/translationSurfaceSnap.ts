import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  findSurfaceTargetSnap,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findInternalCutterTargetSnap } from './internalCutterSnap';
import { findSweptObjectSurfaceSnap } from './sweptObjectSurfaceSnap';
import { findSweptSurfaceTargetSnap } from './sweptSurfaceTargetSnap';

const RELEASE_DISTANCE = 0.14;
const REARM_DISTANCE = 0.35;
const MAX_WORLD_THRESHOLD = 0.12;

export interface TranslationSurfaceSnapContact {
  targetId: string;
  targetAnchorId: string | null;
  sourceAnchorId: string | null;
  captureRawPosition: Vec3;
  acceptedPosition: Vec3;
}

export interface TranslationSurfaceSnapSuppression {
  targetAnchorId: string;
  sourceAnchorId: string | null;
  rawOrigin: Vec3;
}

export interface TranslationSurfaceSnapSession {
  active: TranslationSurfaceSnapContact | null;
  suppressed: TranslationSurfaceSnapSuppression | null;
  previousCompositeTarget: SurfaceSnapTarget | null;
}

export interface TranslationSurfaceSnapResolution {
  result: ObjectSurfaceSnapResult;
  session: TranslationSurfaceSnapSession;
}

export function createTranslationSurfaceSnapSession(): TranslationSurfaceSnapSession {
  return {
    active: null,
    suppressed: null,
    previousCompositeTarget: null
  };
}

function distance(left: Vec3, right: Vec3): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  );
}

function unchanged(position: Vec3): ObjectSurfaceSnapResult {
  return {
    position: [...position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY,
    sourceAnchorId: null,
    targetAnchorId: null
  };
}

function nearerResult(
  first: ObjectSurfaceSnapResult,
  second: ObjectSurfaceSnapResult
): ObjectSurfaceSnapResult {
  if (!first.targetId) return second;
  if (!second.targetId) return first;
  return first.distance <= second.distance ? first : second;
}

function holdOrReleaseContact(
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession
): {
  held: TranslationSurfaceSnapResolution | null;
  active: TranslationSurfaceSnapContact | null;
  suppressed: TranslationSurfaceSnapSuppression | null;
} {
  let active = currentSession.active;
  let suppressed = currentSession.suppressed;

  if (active) {
    if (distance(rawPosition, active.captureRawPosition) <= RELEASE_DISTANCE) {
      return {
        held: {
          result: {
            position: [...active.acceptedPosition] as Vec3,
            targetId: active.targetId,
            distance: 0,
            sourceAnchorId: active.sourceAnchorId,
            targetAnchorId: active.targetAnchorId
          },
          session: {
            active,
            suppressed: null,
            previousCompositeTarget: currentSession.previousCompositeTarget
          }
        },
        active,
        suppressed: null
      };
    }

    suppressed = active.targetAnchorId
      ? {
        targetAnchorId: active.targetAnchorId,
        sourceAnchorId: active.sourceAnchorId,
        rawOrigin: [...rawPosition] as Vec3
      }
      : null;
    active = null;
  }

  if (suppressed && distance(rawPosition, suppressed.rawOrigin) >= REARM_DISTANCE) {
    suppressed = null;
  }
  return { held: null, active, suppressed };
}

function capturedResolution(
  snapped: ObjectSurfaceSnapResult | null,
  rawPosition: Vec3,
  unchangedPosition: Vec3,
  suppressed: TranslationSurfaceSnapSuppression | null,
  previousCompositeTarget: SurfaceSnapTarget | null
): TranslationSurfaceSnapResolution {
  if (!snapped?.targetId) {
    return {
      result: unchanged(unchangedPosition),
      session: {
        active: null,
        suppressed,
        previousCompositeTarget
      }
    };
  }

  const active: TranslationSurfaceSnapContact = {
    targetId: snapped.targetId,
    targetAnchorId: snapped.targetAnchorId ?? null,
    sourceAnchorId: snapped.sourceAnchorId ?? null,
    captureRawPosition: [...rawPosition] as Vec3,
    acceptedPosition: [...snapped.position] as Vec3
  };
  return {
    result: snapped,
    session: {
      active,
      suppressed: null,
      previousCompositeTarget
    }
  };
}

function compositeTargetAtPosition(
  target: SurfaceSnapTarget,
  position: Vec3
): SurfaceSnapTarget {
  const matrixWorld = target.matrixWorld.clone();
  matrixWorld.setPosition(position[0], position[1], position[2]);
  return {
    ...target,
    matrixWorld
  };
}

function compositeDistances(value: number): {
  positionStep: number;
  worldThreshold: number;
} {
  const magnitude = Math.max(0.0001, Math.abs(value));
  if (magnitude > MAX_WORLD_THRESHOLD) {
    return {
      positionStep: magnitude,
      worldThreshold: Math.min(
        MAX_WORLD_THRESHOLD,
        Math.max(0.04, magnitude * 0.4)
      )
    };
  }

  return {
    positionStep: Math.max(0.1, magnitude / 0.4),
    worldThreshold: magnitude
  };
}

/** Gemeinsame Freigabelogik für äußere und innere Formen-Snaps auf Maus und Touch. */
export function resolveTranslationSurfaceSnap(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): TranslationSurfaceSnapResolution {
  const contact = holdOrReleaseContact(rawPosition, currentSession);
  if (contact.held) return contact.held;

  const snapped = findSweptObjectSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets,
    {
      ignoredTargetAnchorId: contact.suppressed?.targetAnchorId ?? null,
      ignoredSourceAnchorId: contact.suppressed?.sourceAnchorId ?? null
    }
  );
  return capturedResolution(
    snapped,
    rawPosition,
    source.position,
    contact.suppressed,
    null
  );
}

/** Dieselbe kombinierte Außen-/Innensnap-Logik für Gruppen und Importe. */
export function resolveCompositeTranslationSurfaceSnap(
  sourceTarget: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession,
  thresholdOrPositionStep: number = MAX_WORLD_THRESHOLD
): TranslationSurfaceSnapResolution {
  const contact = holdOrReleaseContact(rawPosition, currentSession);
  if (contact.held) return contact.held;

  const sourcePosition = new THREE.Vector3().setFromMatrixPosition(sourceTarget.matrixWorld);
  const distances = compositeDistances(thresholdOrPositionStep);
  const options = {
    ignoredTargetAnchorId: contact.suppressed?.targetAnchorId ?? null,
    ignoredSourceAnchorId: contact.suppressed?.sourceAnchorId ?? null
  };
  const swept = currentSession.previousCompositeTarget
    ? findSweptSurfaceTargetSnap(
      currentSession.previousCompositeTarget,
      sourceTarget,
      targets,
      distances.positionStep,
      options
    )
    : null;
  const internalNearby = findInternalCutterTargetSnap(
    sourceTarget,
    targets,
    sourcePosition,
    distances.worldThreshold,
    options
  );
  const filteredTargets = contact.suppressed
    ? targets.map((target) => ({
      ...target,
      anchors: target.anchors.filter((anchor) => (
        anchor.id !== contact.suppressed?.targetAnchorId
      ))
    }))
    : targets;
  const outerNearby = findSurfaceTargetSnap(
    sourceTarget,
    filteredTargets,
    sourcePosition,
    distances.worldThreshold
  );
  const nearby = nearerResult(outerNearby, internalNearby);
  const candidate = swept ?? (nearby.targetId ? nearby : null);
  const acceptedPosition = candidate?.position
    ?? [sourcePosition.x, sourcePosition.y, sourcePosition.z] as Vec3;
  const acceptedTarget = compositeTargetAtPosition(sourceTarget, acceptedPosition);

  return capturedResolution(
    candidate,
    rawPosition,
    acceptedPosition,
    contact.suppressed,
    acceptedTarget
  );
}
