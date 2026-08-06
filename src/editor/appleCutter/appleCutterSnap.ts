import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  findObjectSurfaceSnap,
  type ObjectSurfaceSnapResult,
  type SurfaceSnapTarget
} from '../snapping/objectSurfaceSnap';
import { findSweptObjectSurfaceSnap } from '../snapping/sweptObjectSurfaceSnap';

const EPSILON = 0.000001;

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
 * Zustandsloser Apfelschneider-Solver für Skalierung und direkte
 * Geometrieprüfungen. Pointer-Drags verwenden den gemeinsamen
 * Translation-Controller mit eigener Hysterese.
 */
export function findAppleCutterSurfaceSnap(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
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

  return findObjectSurfaceSnap(
    source,
    objects.filter((object) => object.id !== source.id),
    positionStep,
    additionalTargets
  );
}

export function snapAppleCutterSurfaces(
  source: SceneObjectData,
  objects: readonly SceneObjectData[],
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
