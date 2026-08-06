import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import { surfaceSnapTargetFromSceneObject } from '../src/editor/snapping/objectSurfaceSnap';
import { findFormSurfaceSnap } from '../src/editor/snapping/primitiveSurfaceSnap';
import {
  minimumSurfaceProjection,
  transformSurfaceSupportPoints
} from '../src/editor/snapping/surfaceSupport';
import {
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from '../src/editor/snapping/surfaceSnapTopology';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { PrimitiveType, SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;
const START_GAP = 0.05;
const THIN_DIMENSION = 0.0001;

const withPosition = (object: SceneObjectData, position: Vec3): SceneObjectData => ({
  ...object,
  position
});

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Welt-Bounds für ${object.type}.`);
  return bounds;
}

function worldAnchors(object: SceneObjectData): SurfaceSnapAnchor[] {
  const target = surfaceSnapTargetFromSceneObject(object);
  if (!target) throw new Error(`Keine Snap-Topologie für ${object.type}.`);
  return transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
}

function approachPair(
  source: SceneObjectData,
  target: SceneObjectData
): { sourceAnchor: SurfaceSnapAnchor; targetAnchor: SurfaceSnapAnchor } {
  const sourceAnchors = worldAnchors(source).filter((anchor) => anchor.normal.x > 0.25);
  const targetAnchors = worldAnchors(target).filter((anchor) => anchor.normal.x < -0.25);
  if (sourceAnchors.length === 0 || targetAnchors.length === 0) {
    throw new Error(`Keine X-gerichtete Punktbahn für ${source.type} zu ${target.type}.`);
  }

  let bestSource = sourceAnchors[0];
  let bestTarget = targetAnchors[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const sourceAnchor of sourceAnchors) {
    for (const targetAnchor of targetAnchors) {
      const normalScore = 1 + sourceAnchor.normal.dot(targetAnchor.normal);
      const tangentialScore = Math.hypot(
        sourceAnchor.position.y - targetAnchor.position.y,
        sourceAnchor.position.z - targetAnchor.position.z
      );
      const score = normalScore * 10 + tangentialScore;
      if (score >= bestScore) continue;
      bestScore = score;
      bestSource = sourceAnchor;
      bestTarget = targetAnchor;
    }
  }
  if (!bestSource || !bestTarget) throw new Error('Kein gültiges Punktpaar.');
  return { sourceAnchor: bestSource, targetAnchor: bestTarget };
}

function crossingSetup(sourceType: PrimitiveType, targetType: PrimitiveType) {
  const target = createSceneObject(targetType);
  target.id = `target-${targetType}`;
  const initialSource = createSceneObject(sourceType);
  initialSource.id = `source-${sourceType}`;
  const pair = approachPair(initialSource, target);
  const desiredSourceAnchor = pair.targetAnchor.position.clone()
    .addScaledVector(pair.targetAnchor.normal, START_GAP);
  const sourceTranslation = desiredSourceAnchor.sub(pair.sourceAnchor.position);
  const previous = withPosition(initialSource, [
    initialSource.position[0] + sourceTranslation.x,
    initialSource.position[1] + sourceTranslation.y,
    initialSource.position[2] + sourceTranslation.z
  ]);
  const previousBounds = requiredBounds(previous);
  const sourceWidth = previousBounds.max.x - previousBounds.min.x;
  const overshoot = Math.max(STEP * 3, sourceWidth * 0.65);
  const candidate = withPosition(previous, [
    previous.position[0] + START_GAP + overshoot,
    previous.position[1],
    previous.position[2]
  ]);

  return { target, previous, candidate };
}

function boxGapSetup(gap: number) {
  const target = createSceneObject('box');
  target.id = 'target-box';
  const targetBounds = requiredBounds(target);

  const source = createSceneObject('box');
  source.id = 'source-box';
  const sourceBounds = requiredBounds(source);
  const previous = withPosition(source, [
    source.position[0] + targetBounds.min.x - gap - sourceBounds.max.x,
    source.position[1],
    source.position[2]
  ]);

  return { target, targetBounds, previous };
}

function expectUnchanged(candidate: SceneObjectData, result: ReturnType<typeof findFormSurfaceSnap>) {
  expect(result.targetId).toBeNull();
  expect(result.position[0]).toBeCloseTo(candidate.position[0], 6);
  expect(result.position[1]).toBeCloseTo(candidate.position[1], 6);
  expect(result.position[2]).toBeCloseTo(candidate.position[2], 6);
}

function expectPhysicalContact(
  source: SceneObjectData,
  target: SceneObjectData,
  previous: SceneObjectData,
  candidate: SceneObjectData,
  result: ReturnType<typeof findFormSurfaceSnap>
): void {
  const sourceTarget = surfaceSnapTargetFromSceneObject(withPosition(source, result.position));
  const targetTarget = surfaceSnapTargetFromSceneObject(target);
  expect(sourceTarget).not.toBeNull();
  expect(targetTarget).not.toBeNull();
  if (!sourceTarget || !targetTarget) return;

  const targetAnchor = transformSurfaceSnapAnchors(
    targetTarget.anchors,
    targetTarget.matrixWorld
  ).find((anchor) => anchor.id === result.targetAnchorId);
  expect(targetAnchor).toBeDefined();
  if (!targetAnchor) return;

  const movement = new THREE.Vector3(...candidate.position)
    .sub(new THREE.Vector3(...previous.position))
    .normalize();
  const targetSize = targetTarget.localBounds.getSize(new THREE.Vector3());
  const targetNormal = Math.min(targetSize.x, targetSize.y, targetSize.z) <= THIN_DIMENSION
    ? movement.clone().negate()
    : targetAnchor.normal;
  const localSupport = sourceTarget.supportPoints?.length
    ? sourceTarget.supportPoints
    : sourceTarget.anchors.map((anchor) => anchor.position);
  const worldSupport = transformSurfaceSupportPoints(localSupport, sourceTarget.matrixWorld);

  expect(minimumSurfaceProjection(worldSupport, targetNormal))
    .toBeCloseTo(targetAnchor.position.dot(targetNormal), 4);
}

function expectStopsDuringCrossing(
  previous: SceneObjectData,
  candidate: SceneObjectData,
  resultPosition: Vec3
): void {
  expect(resultPosition[0]).toBeGreaterThanOrEqual(previous.position[0] - 0.00001);
  expect(resultPosition[0]).toBeLessThan(candidate.position[0] - 0.00001);
}

describe.each(['Desktop', 'Android'])('durchgängiger Formen-Snap auf %s', (platform) => {
  void platform;

  it.each([
    ['Kugel zu Würfel', 'sphere', 'box'],
    ['Kugel zu Zylinder', 'sphere', 'cylinder']
  ] as const)('stoppt %s beim Durchqueren', (_label, sourceType, targetType) => {
    const { target, previous, candidate } = crossingSetup(sourceType, targetType);
    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsDuringCrossing(previous, candidate, result.position);
    expectPhysicalContact(candidate, target, previous, candidate, result);
  });

  it('hält den Kontakt auch beim nächsten Ziehschritt in die Form hinein', () => {
    const { target, previous, candidate } = crossingSetup('sphere', 'box');
    const first = findFormSurfaceSnap(candidate, [previous, target], STEP);
    expect(first.targetId).toBe(target.id);

    const snappedPrevious = withPosition(candidate, first.position);
    const deeperCandidate = withPosition(candidate, [
      candidate.position[0] + STEP * 2,
      candidate.position[1],
      candidate.position[2]
    ]);
    const second = findFormSurfaceSnap(deeperCandidate, [snappedPrevious, target], STEP);

    expect(second.targetId).toBe(target.id);
    expectPhysicalContact(deeperCandidate, target, snappedPrevious, deeperCandidate, second);
  });

  it('lässt ein eingerastetes Element wieder von der Fläche wegziehen', () => {
    const { target, previous } = boxGapSetup(0);
    const candidate = withPosition(previous, [
      previous.position[0] - 0.35,
      previous.position[1],
      previous.position[2]
    ]);

    expectUnchanged(candidate, findFormSurfaceSnap(candidate, [previous, target], STEP));
  });

  it('lässt ein Element nahe an einer Fläche seitlich vorbeiziehen', () => {
    const { target, previous } = boxGapSetup(0.05);
    const candidate = withPosition(previous, [
      previous.position[0],
      previous.position[1] + 0.4,
      previous.position[2]
    ]);

    expectUnchanged(candidate, findFormSurfaceSnap(candidate, [previous, target], STEP));
  });

  it('greift bei bloßer Nähe außerhalb der Kontaktzone nicht ein', () => {
    const { target, previous } = boxGapSetup(0.35);
    const candidate = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);

    expectUnchanged(candidate, findFormSurfaceSnap(candidate, [previous, target], STEP));
  });

  it('rastet bei gezielter Annäherung innerhalb der Kontaktzone ein', () => {
    const { target, previous } = boxGapSetup(0.2);
    const candidate = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectPhysicalContact(candidate, target, previous, candidate, result);
  });
});

describe('gleiche Durchquerungsbedingung für alle Elemente', () => {
  it.each(SHAPE_DEFINITIONS)("stoppt '$label' als bewegtes Element auf einer Apfelschneider-Bahn", ({ type }) => {
    const { target, previous, candidate } = crossingSetup(type, 'box');
    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsDuringCrossing(previous, candidate, result.position);
    expectPhysicalContact(candidate, target, previous, candidate, result);
  });

  it.each(SHAPE_DEFINITIONS)("stoppt eine Kugel an '$label' auf einer Apfelschneider-Bahn", ({ type }) => {
    const { target, previous, candidate } = crossingSetup('sphere', type);
    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsDuringCrossing(previous, candidate, result.position);
    expectPhysicalContact(candidate, target, previous, candidate, result);
  });
});
