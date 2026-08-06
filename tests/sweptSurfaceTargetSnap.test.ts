import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects
} from '../src/editor/snapping/objectSurfaceSnap';
import { findSweptSurfaceTargetSnap } from '../src/editor/snapping/sweptSurfaceTargetSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { PrimitiveType, SceneObjectData } from '../src/types/editor';

const STEP = 0.25;

function requiredBounds(object: SceneObjectData): THREE.Box3 {
  const bounds = worldBoundsFromSceneObject(object);
  if (!bounds) throw new Error(`Keine Bounds für ${object.type}.`);
  return bounds;
}

function crossingSetup(targetType: PrimitiveType) {
  const target = createSceneObject(targetType);
  target.id = `target-${targetType}`;
  const targetBounds = requiredBounds(target);
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());

  const source = createSceneObject('sphere');
  source.id = 'source-component';
  const sourceBounds = requiredBounds(source);
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  source.position = [
    source.position[0],
    source.position[1] + targetCenter.y - sourceCenter.y,
    source.position[2] + targetCenter.z - sourceCenter.z
  ];
  const alignedBounds = requiredBounds(source);
  const previousObject: SceneObjectData = {
    ...source,
    position: [
      source.position[0] + targetBounds.min.x - 0.05 - alignedBounds.max.x,
      source.position[1],
      source.position[2]
    ]
  };
  const currentObject: SceneObjectData = {
    ...previousObject,
    position: [
      previousObject.position[0] + 0.8,
      previousObject.position[1],
      previousObject.position[2]
    ]
  };

  const previousTarget = surfaceSnapTargetFromSceneObjects(
    [previousObject],
    'moving-composite'
  );
  const currentTarget = surfaceSnapTargetFromSceneObjects(
    [currentObject],
    'moving-composite'
  );
  const fixedTarget = surfaceSnapTargetFromSceneObject(target);
  if (!previousTarget || !currentTarget || !fixedTarget) {
    throw new Error('Composite-Sweep-Testtopologie konnte nicht erzeugt werden.');
  }

  return {
    target,
    targetBounds,
    previousObject,
    currentObject,
    previousTarget,
    currentTarget,
    fixedTarget
  };
}

function correctedObject(
  object: SceneObjectData,
  currentCenter: THREE.Vector3,
  snappedCenter: [number, number, number]
): SceneObjectData {
  const correction = new THREE.Vector3(...snappedCenter).sub(currentCenter);
  return {
    ...object,
    position: [
      object.position[0] + correction.x,
      object.position[1] + correction.y,
      object.position[2] + correction.z
    ]
  };
}

describe('kontinuierlicher äußerer Composite-Snap', () => {
  it.each(['box', 'cylinder'] as const)(
    'stoppt eine Gruppe trotz übersprungener Fangzone an %s',
    (targetType) => {
      const setup = crossingSetup(targetType);
      expect(requiredBounds(setup.currentObject).max.x)
        .toBeGreaterThan(setup.targetBounds.min.x);

      const result = findSweptSurfaceTargetSnap(
        setup.previousTarget,
        setup.currentTarget,
        [setup.fixedTarget],
        STEP
      );

      expect(result?.targetId).toBe(setup.target.id);
      if (!result) return;
      const currentCenter = new THREE.Vector3().setFromMatrixPosition(
        setup.currentTarget.matrixWorld
      );
      const snapped = correctedObject(
        setup.currentObject,
        currentCenter,
        result.position
      );
      expect(requiredBounds(snapped).max.x)
        .toBeCloseTo(setup.targetBounds.min.x, 4);
    }
  );

  it('lässt eine Gruppe beim Wegziehen frei', () => {
    const setup = crossingSetup('box');
    const awayObject: SceneObjectData = {
      ...setup.previousObject,
      position: [
        setup.previousObject.position[0] - 0.5,
        setup.previousObject.position[1],
        setup.previousObject.position[2]
      ]
    };
    const awayTarget = surfaceSnapTargetFromSceneObjects(
      [awayObject],
      'moving-composite'
    );
    expect(awayTarget).not.toBeNull();
    if (!awayTarget) return;

    expect(findSweptSurfaceTargetSnap(
      setup.previousTarget,
      awayTarget,
      [setup.fixedTarget],
      STEP
    )).toBeNull();
  });
});
