import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  findFormSurfaceSnap,
  resetFormSurfaceSnapSessions,
  type FormSurfaceSnapResult
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

function commitViewportStep(
  rawSource: SceneObjectData,
  result: FormSurfaceSnapResult,
  target: SceneObjectData
): SceneObjectData {
  const accepted = acceptedSource(rawSource, result.position);
  useEditorStore.setState({ objects: [accepted, target] });
  return accepted;
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
    const staleRenderObjects = [previous, target];
    beginViewportDrag(staleRenderObjects);

    const rawApproach = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const first = findFormSurfaceSnap(rawApproach, staleRenderObjects, STEP);
    expect(first.targetId).toBe(target.id);
    expect(requiredBounds(acceptedSource(rawApproach, first.position)).max.x)
      .toBeCloseTo(targetBounds.min.x, 4);
    commitViewportStep(rawApproach, first, target);

    const rawFurtherInside = withPosition(rawApproach, [
      rawApproach.position[0] + 0.15,
      rawApproach.position[1],
      rawApproach.position[2]
    ]);
    const second = findFormSurfaceSnap(
      rawFurtherInside,
      staleRenderObjects,
      STEP
    );
    expect(second.targetId).toBe(target.id);
    commitViewportStep(rawFurtherInside, second, target);

    const rawPointerBack = withPosition(rawFurtherInside, [
      rawFurtherInside.position[0] - 0.25,
      rawFurtherInside.position[1],
      rawFurtherInside.position[2]
    ]);
    const released = findFormSurfaceSnap(
      rawPointerBack,
      staleRenderObjects,
      STEP
    );

    expect(released.targetId).toBeNull();
    expect(released.position[0]).toBeCloseTo(second.position[0] - 0.1, 6);
    expect(requiredBounds(acceptedSource(rawPointerBack, released.position)).max.x)
      .toBeLessThan(targetBounds.min.x - 0.05);
  });

  it('verschiebt nach dem Einrasten seitlich ab der sichtbaren Elementposition', () => {
    const { target, previous } = boxGapSetup(0.2);
    const staleRenderObjects = [previous, target];
    beginViewportDrag(staleRenderObjects);

    const rawApproach = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const snapped = findFormSurfaceSnap(rawApproach, staleRenderObjects, STEP);
    expect(snapped.targetId).toBe(target.id);
    commitViewportStep(rawApproach, snapped, target);

    const rawSideStep = withPosition(rawApproach, [
      rawApproach.position[0],
      rawApproach.position[1] + 0.1,
      rawApproach.position[2]
    ]);
    const moved = findFormSurfaceSnap(rawSideStep, staleRenderObjects, STEP);

    expect(moved.targetId).toBeNull();
    expect(moved.position[0]).toBeCloseTo(snapped.position[0], 6);
    expect(moved.position[1]).toBeCloseTo(snapped.position[1] + 0.1, 6);
  });

  it('löst auch bei vielen kleinen Schritten in die Form und springt nicht nach', () => {
    const { target, previous } = boxGapSetup(0.2);
    const staleRenderObjects = [previous, target];
    beginViewportDrag(staleRenderObjects);

    const rawApproach = withPosition(previous, [
      previous.position[0] + 0.15,
      previous.position[1],
      previous.position[2]
    ]);
    const snapped = findFormSurfaceSnap(rawApproach, staleRenderObjects, STEP);
    expect(snapped.targetId).toBe(target.id);
    commitViewportStep(rawApproach, snapped, target);

    let released: FormSurfaceSnapResult | null = null;
    let releasedRaw: SceneObjectData | null = null;
    for (let index = 1; index <= 15; index += 1) {
      const rawStep = withPosition(rawApproach, [
        rawApproach.position[0] + index * 0.02,
        rawApproach.position[1],
        rawApproach.position[2]
      ]);
      const result = findFormSurfaceSnap(rawStep, staleRenderObjects, STEP);
      commitViewportStep(rawStep, result, target);

      if (!result.targetId) {
        released = result;
        releasedRaw = rawStep;
        break;
      }
    }

    expect(released).not.toBeNull();
    expect(releasedRaw).not.toBeNull();
    expect(released?.position[0]).toBeGreaterThan(snapped.position[0] + 0.15);

    const nextRaw = withPosition(releasedRaw as SceneObjectData, [
      (releasedRaw as SceneObjectData).position[0] + 0.04,
      (releasedRaw as SceneObjectData).position[1],
      (releasedRaw as SceneObjectData).position[2]
    ]);
    const continued = findFormSurfaceSnap(nextRaw, staleRenderObjects, STEP);

    expect(continued.targetId).toBeNull();
    expect(continued.position[0]).toBeCloseTo((released as FormSurfaceSnapResult).position[0] + 0.04, 6);
  });
});
