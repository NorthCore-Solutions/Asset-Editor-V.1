import type { SceneObjectData, Vec3 } from '../../types/editor';
import type { ObjectSurfaceSnapResult, SurfaceSnapTarget } from './objectSurfaceSnap';
import { findSweptObjectSurfaceSnap } from './sweptObjectSurfaceSnap';

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

/**
 * Gemeinsame magnetische Freigabelogik für Maus und Touch. Die kontinuierliche
 * rohe Bewegung bleibt vom Bewegungsraster getrennt. Ein Kontakt wird sichtbar
 * gehalten, bis der Pointer den Freigabebereich verlässt; danach wird nur der
 * konkrete Apfelschneider-Punkt vorübergehend unterdrückt.
 */
export function resolveTranslationSurfaceSnap(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
  positionStep: number,
  rawPosition: Vec3,
  currentSession: TranslationSurfaceSnapSession,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): TranslationSurfaceSnapResolution {
  let active = currentSession.active;
  let suppressed = currentSession.suppressed;

  if (active) {
    if (distance(rawPosition, active.captureRawPosition) <= RELEASE_DISTANCE) {
      return {
        result: {
          position: [...active.acceptedPosition] as Vec3,
          targetId: active.targetId,
          distance: 0,
          sourceAnchorId: active.sourceAnchorId,
          targetAnchorId: active.targetAnchorId
        },
        session: { active, suppressed: null }
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

  const snapped = findSweptObjectSurfaceSnap(
    source,
    objects,
    positionStep,
    additionalTargets,
    { ignoredTargetAnchorId: suppressed?.targetAnchorId ?? null }
  );
  if (!snapped) {
    return {
      result: unchanged(source.position),
      session: { active: null, suppressed }
    };
  }

  active = {
    targetId: snapped.targetId ?? '',
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
