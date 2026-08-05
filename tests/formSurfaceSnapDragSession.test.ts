import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  findFormSurfaceSnap,
  resetFormSurfaceSnapSessions
} from '../src/editor/snapping/primitiveSurfaceSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import { useEditorStore } from '../src/store/editorStore';
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

function boxGapSetup(gap: number): {
  target: SceneObjectData;
  previous: SceneObjectData;
  targetBounds: THREE.Box3;
} {
  const target = createSceneObject('box');
  target.id = 'target-box';
  const targetBounds = requiredBounds(target);
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());

  const source = createSceneObject('box');
  source.id = 'source-box';
  const sourceBounds = requiredBounds(source);
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const aligned = withPosition(source, [
    source.position[0],
    source.position[1] + targetCenter.y - sourceCenter.y,
    source.position[2] + targetCenter.z - sourceCenter.z
  ]);
  const alignedBounds = requiredBounds(aligned);
  const previous = withPosition(aligned, [
    aligned.position[0] + targetBounds.min.x - gap - alignedBounds.max.x,
    aligned.position[1],
    aligned.position[2]
  ]);

  return { target, previous, targetBounds };
}

function acceptedSource(
  rawSource: SceneObjectData,
  acceptedPosition: Vec3
): SceneObjectData {
  return withPosition(rawSource, acceptedPosition);
}

function beginViewportDrag(objects: SceneObjectData[]): void {
  useEditorStore.setState({ objects, transactionStart: null });
  useEditorStore.getState().beginTransaction();
}

beforeEach(() => {
  resetFormSurfaceSnapSessions();
  useEditorStore.setState({ objects: [], transactionStart: null });
});

afterEach(() => {
  useEditorStore.setState({ objects: [], transactionStart: null });
  resetFormSurfaceSnapSessions();
});

describe.each(['Desktop', 'Android'])('mehrstufiger Formen-Snap im Viewport auf %s', (platform) => {
  void platform;

  it('löst sich nach einem Snap sofort wieder, sobald der Pointer zurückgezogen wird', () => {
    const { target, previous, targetBounds } = boxGapSetup(0.2);
    beginViewportDrag([previous, target]);

    const rawApproach = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const first = findFormSurfaceSnap(rawApproach, [previous, target], STEP);
    expect(first.targetId).toBe(target.id);
    expect(requiredBounds(acceptedSource(rawApproach, first.position)).max.x)
      .toBeCloseTo(targetBounds.min.x, 4);

    const firstAccepted = acceptedSource(rawApproach, first.position);
    const rawFurtherInside = withPosition(rawApproach, [
      rawApproach.position[0] + 0.15,
      rawApproach.position[1],
      rawApproach.position[2]
    ]);
    const second = findFormSurfaceSnap(
      rawFurtherInside,
      [firstAccepted, target],
      STEP
    );
    expect(second.targetId).toBe(target.id);

    const secondAccepted = acceptedSource(rawFurtherInside, second.position);
    const rawPointerBack = withPosition(rawFurtherInside, [
      rawFurtherInside.position[0] - 0.25,
      rawFurtherInside.position[1],
      rawFurtherInside.position[2]
    ]);
    const released = findFormSurfaceSnap(
      rawPointerBack,
      [secondAccepted, target],
      STEP
    );

    expect(released.targetId).toBeNull();
    expect(released.position[0]).toBeCloseTo(second.position[0] - 0.25, 6);
    expect(requiredBounds(acceptedSource(rawPointerBack, released.position)).max.x)
      .toBeLessThan(targetBounds.min.x - 0.2);
  });

  it('verschiebt nach dem Einrasten seitlich ab der sichtbaren Elementposition', () => {
    const { target, previous } = boxGapSetup(0.2);
    beginViewportDrag([previous, target]);

    const rawApproach = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const snapped = findFormSurfaceSnap(rawApproach, [previous, target], STEP);
    expect(snapped.targetId).toBe(target.id);

    const accepted = acceptedSource(rawApproach, snapped.position);
    const rawSideStep = withPosition(rawApproach, [
      rawApproach.position[0],
      rawApproach.position[1] + 0.3,
      rawApproach.position[2]
    ]);
    const moved = findFormSurfaceSnap(rawSideStep, [accepted, target], STEP);

    expect(moved.targetId).toBeNull();
    expect(moved.position[0]).toBeCloseTo(snapped.position[0], 6);
    expect(moved.position[1]).toBeCloseTo(snapped.position[1] + 0.3, 6);
  });
});
