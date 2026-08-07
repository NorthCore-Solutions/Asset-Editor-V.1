import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import { findAppleCutterSurfaceSnap } from '../src/editor/appleCutter/appleCutterSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;

const withPosition = (object: SceneObjectData, position: Vec3): SceneObjectData => ({
  ...object,
  position
});

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Welt-Bounds für ${object.type}.`);
  return bounds;
}

function boxAt(id: string, x: number): SceneObjectData {
  const object = createSceneObject('box');
  object.id = id;
  object.position = [x, object.position[1], object.position[2]];
  return object;
}

function expectOuterContact(
  source: SceneObjectData,
  target: SceneObjectData,
  result: ReturnType<typeof findAppleCutterSurfaceSnap>
): void {
  expect(result.targetId).toBe(target.id);
  expect(result.sourceAnchorId).toBeTruthy();
  expect(result.targetAnchorId).toBeTruthy();
  expect(result.sourceAnchorId).not.toMatch(/^internal:/);
  expect(result.targetAnchorId).not.toMatch(/^internal:/);

  const sourceBounds = requiredBounds(withPosition(source, result.position));
  const targetBounds = requiredBounds(target);
  expect(sourceBounds.max.x).toBeCloseTo(targetBounds.min.x, 5);
}

function expectInternalSnap(
  target: SceneObjectData,
  result: ReturnType<typeof findAppleCutterSurfaceSnap>,
  expectedX: number
): void {
  expect(result.targetId).toBe(target.id);
  expect(result.sourceAnchorId).toMatch(/^internal:/);
  expect(result.targetAnchorId).toMatch(/^internal:/);
  expect(result.position[0]).toBeCloseTo(expectedX, 6);
}

describe.each(['Desktop', 'Android'])('kombinierter Formen-Snap auf %s', () => {
  it('fängt den äußeren Oberflächenpunkt zusätzlich wieder ein', () => {
    const target = boxAt('target-box', 0);
    const previous = boxAt('source-box', -1.1);
    const candidate = boxAt('source-box', -0.9);

    const result = findAppleCutterSurfaceSnap(
      candidate,
      [previous, target],
      STEP
    );

    expectOuterContact(candidate, target, result);
    expect(result.position[0]).toBeCloseTo(-1, 6);
  });

  it('behält den ersten inneren 0,25-Schnitt bei', () => {
    const target = boxAt('target-box', 0);
    const source = boxAt('source-box', -0.75);

    const result = findAppleCutterSurfaceSnap(source, [target], STEP);

    expectInternalSnap(target, result, -0.75);
  });

  it('behält auch den nächsten inneren 0,25-Schnitt bei', () => {
    const target = boxAt('target-box', 0);
    const source = boxAt('source-box', -0.5);

    const result = findAppleCutterSurfaceSnap(source, [target], STEP);

    expectInternalSnap(target, result, -0.5);
  });

  it('lässt sich vom äußeren Kontakt wieder wegziehen', () => {
    const target = boxAt('target-box', 0);
    const previous = boxAt('source-box', -1);
    const candidate = boxAt('source-box', -1.35);

    const result = findAppleCutterSurfaceSnap(
      candidate,
      [previous, target],
      STEP
    );

    expect(result.targetId).toBeNull();
    expect(result.position[0]).toBeCloseTo(candidate.position[0], 6);
  });
});
