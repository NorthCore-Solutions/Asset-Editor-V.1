import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import { findAppleCutterSurfaceSnap } from '../src/editor/appleCutter/appleCutterSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { PrimitiveType, SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;
const OUTER_GAP = 0.1;

const withPosition = (object: SceneObjectData, position: Vec3): SceneObjectData => ({
  ...object,
  position
});

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Welt-Bounds für ${object.type}.`);
  return bounds;
}

function alignedCrossing(
  sourceType: PrimitiveType,
  targetType: PrimitiveType
): {
  previous: SceneObjectData;
  outerContact: SceneObjectData;
  internalCandidate: SceneObjectData;
  target: SceneObjectData;
} {
  const target = createSceneObject(targetType);
  target.id = `target-${targetType}`;
  const targetBounds = requiredBounds(target);
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());

  const source = createSceneObject(sourceType);
  source.id = `source-${sourceType}`;
  const sourceBounds = requiredBounds(source);
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const aligned = withPosition(source, [
    source.position[0],
    source.position[1] + targetCenter.y - sourceCenter.y,
    source.position[2] + targetCenter.z - sourceCenter.z
  ]);
  const alignedBounds = requiredBounds(aligned);
  const previous = withPosition(aligned, [
    aligned.position[0] + targetBounds.min.x - OUTER_GAP - alignedBounds.max.x,
    aligned.position[1],
    aligned.position[2]
  ]);
  const outerContact = withPosition(previous, [
    previous.position[0] + OUTER_GAP,
    previous.position[1],
    previous.position[2]
  ]);
  const internalCandidate = withPosition(previous, [
    previous.position[0] + 1,
    previous.position[1],
    previous.position[2]
  ]);

  return { previous, outerContact, internalCandidate, target };
}

function expectUnchanged(
  candidate: SceneObjectData,
  result: ReturnType<typeof findAppleCutterSurfaceSnap>
): void {
  expect(result.targetId).toBeNull();
  expect(result.position[0]).toBeCloseTo(candidate.position[0], 6);
  expect(result.position[1]).toBeCloseTo(candidate.position[1], 6);
  expect(result.position[2]).toBeCloseTo(candidate.position[2], 6);
}

function expectInternalOverlap(
  candidate: SceneObjectData,
  target: SceneObjectData,
  result: ReturnType<typeof findAppleCutterSurfaceSnap>
): void {
  expect(result.targetId).toBe(target.id);
  expect(result.sourceAnchorId).toMatch(/^internal:/);
  expect(result.targetAnchorId).toMatch(/^internal:/);

  const snappedBounds = requiredBounds(withPosition(candidate, result.position));
  const targetBounds = requiredBounds(target);
  const overlapX = Math.min(snappedBounds.max.x, targetBounds.max.x)
    - Math.max(snappedBounds.min.x, targetBounds.min.x);
  expect(overlapX).toBeGreaterThan(0.00001);
}

describe.each(['Desktop', 'Android'])('innerer Formen-Snap auf %s', () => {
  it('ignoriert den reinen Außenkontakt vollständig', () => {
    const setup = alignedCrossing('box', 'box');
    const result = findAppleCutterSurfaceSnap(
      setup.outerContact,
      [setup.previous, setup.target],
      STEP
    );

    expectUnchanged(setup.outerContact, result);
  });

  it('fängt beim Durchziehen den ersten inneren 0,25-Schnitt', () => {
    const setup = alignedCrossing('box', 'box');
    const result = findAppleCutterSurfaceSnap(
      setup.internalCandidate,
      [setup.previous, setup.target],
      STEP
    );

    expectInternalOverlap(setup.internalCandidate, setup.target, result);
    expect(result.position[0]).toBeCloseTo(-0.75, 6);
  });

  it('kann nach dem ersten Fang zum nächsten inneren Schnitt weitergezogen werden', () => {
    const target = createSceneObject('box');
    target.id = 'target-box';
    const previous = createSceneObject('box');
    previous.id = 'source-box';
    previous.position = [-0.75, target.position[1], target.position[2]];
    const candidate = withPosition(previous, [
      -0.4,
      previous.position[1],
      previous.position[2]
    ]);

    const result = findAppleCutterSurfaceSnap(candidate, [previous, target], STEP);

    expectInternalOverlap(candidate, target, result);
    expect(result.position[0]).toBeCloseTo(-0.5, 6);
  });

  it('lässt sich aus einem inneren Schnitt wieder nach außen wegziehen', () => {
    const target = createSceneObject('box');
    target.id = 'target-box';
    const previous = createSceneObject('box');
    previous.id = 'source-box';
    previous.position = [-0.75, target.position[1], target.position[2]];
    const candidate = withPosition(previous, [
      -1.1,
      previous.position[1],
      previous.position[2]
    ]);

    expectUnchanged(candidate, findAppleCutterSurfaceSnap(candidate, [previous, target], STEP));
  });
});

describe('innere Durchquerung für alle Editorformen', () => {
  it.each(SHAPE_DEFINITIONS)("zieht '$label' durch einen Würfel und fängt erst im Körper", ({ type }) => {
    const setup = alignedCrossing(type, 'box');
    const outer = findAppleCutterSurfaceSnap(
      setup.outerContact,
      [setup.previous, setup.target],
      STEP
    );
    expectUnchanged(setup.outerContact, outer);

    const internal = findAppleCutterSurfaceSnap(
      setup.internalCandidate,
      [setup.previous, setup.target],
      STEP
    );
    expectInternalOverlap(setup.internalCandidate, setup.target, internal);
  });

  it.each(SHAPE_DEFINITIONS)("zieht einen Würfel durch '$label' und fängt einen inneren Ziel-Schnitt", ({ type }) => {
    const setup = alignedCrossing('box', type);
    const result = findAppleCutterSurfaceSnap(
      setup.internalCandidate,
      [setup.previous, setup.target],
      STEP
    );

    expectInternalOverlap(setup.internalCandidate, setup.target, result);
  });
});
