import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import { findObjectSurfaceSnap } from '../src/editor/snapping/objectSurfaceSnap';
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

function expectStopsAtFirstLeftSurface(
  source: SceneObjectData,
  targetBounds: THREE.Box3,
  resultPosition: Vec3
): void {
  const snappedBounds = requiredBounds(withPosition(source, resultPosition));
  expect(snappedBounds.max.x).toBeCloseTo(targetBounds.min.x, 4);
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

    const result = findObjectSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsAtFirstLeftSurface(candidate, targetBounds, result.position);
  });

  it('hält den Kontakt auch beim nächsten Ziehschritt in die Form hinein', () => {
    const { target, targetBounds, previous, candidate } = crossingSetup('sphere', 'box');
    const first = findObjectSurfaceSnap(candidate, [previous, target], STEP);
    expect(first.targetId).toBe(target.id);

    const snappedPrevious = withPosition(candidate, first.position);
    const deeperCandidate = withPosition(candidate, [
      candidate.position[0] + STEP * 2,
      candidate.position[1],
      candidate.position[2]
    ]);
    const second = findObjectSurfaceSnap(deeperCandidate, [snappedPrevious, target], STEP);

    expect(second.targetId).toBe(target.id);
    expectStopsAtFirstLeftSurface(deeperCandidate, targetBounds, second.position);
  });
});

describe('gleiche Durchquerungsbedingung für alle Elemente', () => {
  it.each(SHAPE_DEFINITIONS)("stoppt '$label' als bewegtes Element am Würfel", ({ type }) => {
    const { target, targetBounds, previous, candidate } = crossingSetup(type, 'box');
    const result = findObjectSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsAtFirstLeftSurface(candidate, targetBounds, result.position);
  });

  it.each(SHAPE_DEFINITIONS)("stoppt eine Kugel an '$label' als Zielelement", ({ type }) => {
    const { target, targetBounds, previous, candidate } = crossingSetup('sphere', type);
    const result = findObjectSurfaceSnap(candidate, [previous, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectStopsAtFirstLeftSurface(candidate, targetBounds, result.position);
  });
});
