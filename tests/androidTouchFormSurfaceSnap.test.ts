import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  findTouchFormSurfaceSnap,
  resetFormSurfaceSnapSessions
} from '../src/editor/snapping/primitiveSurfaceSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;

function withPosition(object: SceneObjectData, position: Vec3): SceneObjectData {
  return { ...object, position };
}

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Welt-Bounds für ${object.type}.`);
  return bounds;
}

function sphereToBoxGap(gap: number): {
  source: SceneObjectData;
  target: SceneObjectData;
  targetBounds: THREE.Box3;
} {
  const target = createSceneObject('box');
  target.id = 'target-box';
  const targetBounds = requiredBounds(target);
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());

  const sphere = createSceneObject('sphere');
  sphere.id = 'source-sphere';
  const sphereBounds = requiredBounds(sphere);
  const sphereCenter = sphereBounds.getCenter(new THREE.Vector3());
  const aligned = withPosition(sphere, [
    sphere.position[0],
    sphere.position[1] + targetCenter.y - sphereCenter.y,
    sphere.position[2] + targetCenter.z - sphereCenter.z
  ]);
  const alignedBounds = requiredBounds(aligned);
  const source = withPosition(aligned, [
    aligned.position[0] + targetBounds.min.x - gap - alignedBounds.max.x,
    aligned.position[1],
    aligned.position[2]
  ]);

  return { source, target, targetBounds };
}

function acceptedSource(raw: SceneObjectData, position: Vec3): SceneObjectData {
  return withPosition(raw, position);
}

beforeEach(() => resetFormSurfaceSnapSessions());
afterEach(() => resetFormSurfaceSnapSessions());

describe('Android-Touch-Formen-Snap', () => {
  it('rastet einmal ein und lässt den nächsten groben Touch-Schritt durch die Form weiterlaufen', () => {
    const { source, target, targetBounds } = sphereToBoxGap(0.2);
    const transaction = {};
    const rawApproach = withPosition(source, [
      source.position[0] + STEP,
      source.position[1],
      source.position[2]
    ]);

    const snapped = findTouchFormSurfaceSnap(
      rawApproach,
      [source, target],
      STEP,
      transaction
    );
    expect(snapped.targetId).toBe(target.id);
    expect(requiredBounds(acceptedSource(rawApproach, snapped.position)).max.x)
      .toBeCloseTo(targetBounds.min.x, 4);

    const acceptedSnap = acceptedSource(rawApproach, snapped.position);
    const rawInside = withPosition(rawApproach, [
      rawApproach.position[0] + STEP,
      rawApproach.position[1],
      rawApproach.position[2]
    ]);
    const released = findTouchFormSurfaceSnap(
      rawInside,
      [acceptedSnap, target],
      STEP,
      transaction
    );

    expect(released.targetId).toBeNull();
    expect(released.position).toEqual(rawInside.position);
  });

  it('hält nach der Freigabe nicht erneut an derselben Fläche fest', () => {
    const { source, target } = sphereToBoxGap(0.2);
    const transaction = {};
    const rawApproach = withPosition(source, [
      source.position[0] + STEP,
      source.position[1],
      source.position[2]
    ]);
    const snapped = findTouchFormSurfaceSnap(
      rawApproach,
      [source, target],
      STEP,
      transaction
    );
    expect(snapped.targetId).toBe(target.id);

    let accepted = acceptedSource(rawApproach, snapped.position);
    let raw = rawApproach;
    for (let index = 1; index <= 5; index += 1) {
      raw = withPosition(raw, [
        raw.position[0] + STEP,
        raw.position[1],
        raw.position[2]
      ]);
      const result = findTouchFormSurfaceSnap(
        raw,
        [accepted, target],
        STEP,
        transaction
      );

      expect(result.targetId).toBeNull();
      expect(result.position).toEqual(raw.position);
      accepted = acceptedSource(raw, result.position);
    }
  });

  it('lässt den Touch-Pointer nach einem Snap direkt wieder von der Fläche wegziehen', () => {
    const { source, target } = sphereToBoxGap(0.2);
    const transaction = {};
    const rawApproach = withPosition(source, [
      source.position[0] + STEP,
      source.position[1],
      source.position[2]
    ]);
    const snapped = findTouchFormSurfaceSnap(
      rawApproach,
      [source, target],
      STEP,
      transaction
    );
    expect(snapped.targetId).toBe(target.id);

    const acceptedSnap = acceptedSource(rawApproach, snapped.position);
    const rawBack = withPosition(rawApproach, [
      rawApproach.position[0] - STEP,
      rawApproach.position[1],
      rawApproach.position[2]
    ]);
    const released = findTouchFormSurfaceSnap(
      rawBack,
      [acceptedSnap, target],
      STEP,
      transaction
    );

    expect(released.targetId).toBeNull();
    expect(released.position).toEqual(rawBack.position);
  });

  it('verwendet in einer neuen Drag-Transaktion wieder Formen-Snap', () => {
    const { source, target } = sphereToBoxGap(0.2);
    const firstTransaction = {};
    const rawApproach = withPosition(source, [
      source.position[0] + STEP,
      source.position[1],
      source.position[2]
    ]);
    const first = findTouchFormSurfaceSnap(
      rawApproach,
      [source, target],
      STEP,
      firstTransaction
    );
    expect(first.targetId).toBe(target.id);

    resetFormSurfaceSnapSessions();
    const second = findTouchFormSurfaceSnap(
      rawApproach,
      [source, target],
      STEP,
      {}
    );
    expect(second.targetId).toBe(target.id);
  });
});
