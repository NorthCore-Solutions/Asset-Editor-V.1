import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  findSurfaceTargetSnap,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findSweptObjectSurfaceSnap } from './sweptObjectSurfaceSnap';
import { findSweptSurfaceTargetSnap } from './sweptSurfaceTargetSnap';

const RELEASE_DISTANCE = 0.14;
const REARM_DISTANCE = 0.35;

export interface TranslationSurfaceSnapContact {
  targetId: string;
  targetAnchorId: string | null;
  sourceAnchorId: string | null;
  captureRawPosition: Vec3;
  acceptedPosition: Vec3;
}

export interface TranslationSurfaceSnapSuppression {
  targetAnchorId: string;
  rawOrigin: Vec3;
}

export interface TranslationSurfaceSnapSession {
  active: TranslationSurfaceSnapContact | null;
  suppressed: TranslationSurfaceSnapSuppression | null;
}

export interface TranslationSurfaceSnapResolution {
  result: ObjectSurfaceSnapResult;
  session: TranslationSurfaceSnapSession;
}

export function createTranslationSurfaceSnapSession(): TranslationSurfaceSnapSession {
  return { active: null, suppressed: null };
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
          session: { active, suppressed: null }
        },
        active,
        suppressed: null
      };
    }

    suppressed = active.targetAnchorId
      ? { targetAnchorId: active.targetAnchorId, rawOrigin: [...rawPosition] as Vec3 }
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
  suppressed: TranslationSurfaceSnapSuppression | null
): TranslationSurfaceSnapResolution {
  if (!snapped?.targetId) {
    return {
      result: unchanged(unchangedPosition),
      session: { active: null, suppressed }
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
    session: { active, suppressed: null }
  };
}

/** Gemeinsame magnetische Freigabelogik für einzelne Formen auf Maus und Touch. */
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
    { ignoredTargetAnchorId: contact.suppressed?.targetAnchorId ?? null }
  );
  return capturedResolution(
    snapped,
    rawPosition,
    source.position,
    contact.suppressed
  );
}

/**
 * Dieselbe Hysterese für das äußere Raster einer Gruppe oder eines Imports.
 * Der vorherige und aktuelle Composite-Zustand werden als vollständige
 * Ziehbahn geprüft; ein 0,25-Rasterschritt kann den Kontakt nicht überspringen.
 */
export function resolveCompositeTranslationSurfaceSnap(
  sourceTarget: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession,
  positionStep: number,
  previousSourceTarget: SurfaceSnapTarget | null = null
): TranslationSurfaceSnapResolution {
  const contact = holdOrReleaseContact(rawPosition, currentSession);
  if (contact.held) return contact.held;

  const filteredTargets = contact.suppressed
    ? targets.map((target) => ({
      ...target,
      anchors: target.anchors.filter((anchor) => (
        anchor.id !== contact.suppressed?.targetAnchorId
      ))
    }))
    : targets;
  const sourcePosition = new THREE.Vector3().setFromMatrixPosition(sourceTarget.matrixWorld);
  const swept = previousSourceTarget
    ? findSweptSurfaceTargetSnap(
      previousSourceTarget,
      sourceTarget,
      filteredTargets,
      positionStep,
      { ignoredTargetAnchorId: contact.suppressed?.targetAnchorId ?? null }
    )
    : null;
  const threshold = Math.min(0.12, Math.max(0.04, Math.abs(positionStep) * 0.4));
  const nearby = swept ?? findSurfaceTargetSnap(
    sourceTarget,
    filteredTargets,
    sourcePosition,
    threshold
  );
  return capturedResolution(
    nearby.targetId ? nearby : null,
    rawPosition,
    [sourcePosition.x, sourcePosition.y, sourcePosition.z],
    contact.suppressed
  );
}
