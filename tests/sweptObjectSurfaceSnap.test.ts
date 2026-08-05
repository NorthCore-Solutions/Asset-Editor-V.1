import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import { findFormSurfaceSnap } from '../src/editor/snapping/primitiveSurfaceSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { PrimitiveType, SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;
const START_GAP = 0.05;

const withPosition = (object: SceneObjectData, position: Vec3): SceneObjectData => ({
  ...object,
  position
});

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Welt-Bounds für ${object.type}.`);
  return bounds;
}

function crossingSetup(sourceType: PrimitiveType, targetType: PrimitiveType) {
  const target = createSceneObject(targetType);
  target.id = `target-${targetType}`;
  const targetBounds = requiredBounds(target);
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());

  const initialSource = createSceneObject(sourceType);
  initialSource.id = `source-${sourceType}`;
  const initialBounds = requiredBounds(initialSource);
  const initialCenter = initialBounds.getCenter(new THREE.Vector3());
  const alignedSource = withPosition(initialSource, [
    initialSource.position[0],
    initialSource.position[1] + targetCenter.y - initialCenter.y,
    initialSource.position[2] + targetCenter.z - initialCenter.z
  ]);
  const alignedBounds = requiredBounds(alignedSource);

  const previous = withPosition(alignedSource, [
    alignedSource.position[0] + targetBounds.min.x - START_GAP - alignedBounds.max.x,
    alignedSource.position[1],
    alignedSource.position[2]
  ]);
  const previousBounds = requiredBounds(previous);
  const sourceWidth = previousBounds.max.x - previousBounds.min.x;
  const overshoot = Math.max(STEP * 3, sourceWidth * 0.65);
  const candidate = withPosition(previous, [
    previous.position[0] + START_GAP + overshoot,
    previous.position[1],
    previous.position[2]
  ]);

  return { target, targetBounds, previous, candidate };
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

function expectStopsAtFirstLeftSurface(
  source: SceneObjectData,
  targetBounds: THREE.Box3,
  resultPosition: Vec3
): void {
  const snappedBounds = requiredBounds(withPosition(source, resultPosition));
  expect(snappedBounds.max.x).toBeCloseTo(targetBounds.min.x, 4);
}

function expectStopsDuringCrossing(
  previous: SceneObjectData,
  candidate: SceneObjectData,
  resultPosition: Vec3
): void {
  expect(resultPosition[0]).toBeGreaterThanOrEqual(previous.position[0] - 0.00001);
  expect(resultPosition[0]).toBeLessThan(candidate.position[0] - 0.00001);
  expect(resultPosition[1]).toBeCloseTo(candidate.position[1], 6);
  expect(resultPosition[2]).toBeCloseTo(candidate.position[2], 6);
}

describe.each(['Desktop', 'Android'])('durchgängiger Formen-Snap auf %s', (platform) => {
  void platform;

  it.each([
    ['Kugel zu Würfel', 'sphere', 'box'],
    ['Kugel zu Zylinder', 'sphere', 'cylinder']
  ] as const)('stoppt %s beim Durchqueren', (_label, sourceType, targetType) => {
    const { target, targetBounds, previous, candidate } = crossingSetup(sourceType, targetType);
    const rawBounds = requiredBounds(candidate);
    expect(rawBounds.max.x).toBeGreaterThan(targetBounds.min.x);

    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsAtFirstLeftSurface(candidate, targetBounds, result.position);
  });

  it('hält den Kontakt auch beim nächsten Ziehschritt in die Form hinein', () => {
    const { target, targetBounds, previous, candidate } = crossingSetup('sphere', 'box');
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
    expectStopsAtFirstLeftSurface(deeperCandidate, targetBounds, second.position);
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
    const { target, targetBounds, previous } = boxGapSetup(0.2);
    const candidate = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsAtFirstLeftSurface(candidate, targetBounds, result.position);
  });
});

describe('gleiche Durchquerungsbedingung für alle Elemente', () => {
  it.each(SHAPE_DEFINITIONS)("stoppt '$label' als bewegtes Element auf der ersten überlappenden Bahn", ({ type }) => {
    const { target, previous, candidate } = crossingSetup(type, 'box');
    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsDuringCrossing(previous, candidate, result.position);
  });

  it.each(SHAPE_DEFINITIONS)("stoppt eine Kugel an '$label' auf ihrer tatsächlichen Ziehbahn", ({ type }) => {
    const { target, previous, candidate } = crossingSetup('sphere', type);
    const result = findFormSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsDuringCrossing(previous, candidate, result.position);
  });
});
