import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects,
  type SurfaceSnapTarget
} from '../src/editor/snapping/objectSurfaceSnap';
import {
  minimumSurfaceProjection,
  transformSurfaceSupportPoints
} from '../src/editor/snapping/surfaceSupport';
import {
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from '../src/editor/snapping/surfaceSnapTopology';
import {
  createTranslationSurfaceSnapSession,
  resolveCompositeTranslationSurfaceSnap
} from '../src/editor/snapping/translationSurfaceSnap';
import { findSweptSurfaceTargetSnap } from '../src/editor/snapping/sweptSurfaceTargetSnap';
import type { PrimitiveType, SceneObjectData } from '../src/types/editor';

const STEP = 0.25;

function worldAnchors(target: SurfaceSnapTarget): SurfaceSnapAnchor[] {
  return transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
}

function targetCenter(target: { matrixWorld: THREE.Matrix4 }): [number, number, number] {
  const center = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
  return [center.x, center.y, center.z];
}

function crossingSetup(targetType: PrimitiveType, gap: number = 0.05) {
  const target = createSceneObject(targetType);
  target.id = `target-${targetType}`;
  const fixedTarget = surfaceSnapTargetFromSceneObject(target);
  if (!fixedTarget) throw new Error(`Keine Zieltopologie für ${targetType}.`);

  const source = createSceneObject('sphere');
  source.id = 'source-component';
  const initialSourceTarget = surfaceSnapTargetFromSceneObjects(
    [source],
    'moving-composite'
  );
  if (!initialSourceTarget) throw new Error('Keine Composite-Quelltopologie.');

  const sourceAnchors = worldAnchors(initialSourceTarget)
    .filter((anchor) => anchor.normal.x > 0.25);
  const targetAnchors = worldAnchors(fixedTarget)
    .filter((anchor) => anchor.normal.x < -0.25);
  if (sourceAnchors.length === 0 || targetAnchors.length === 0) {
    throw new Error(`Keine Composite-Punktbahn zu ${targetType}.`);
  }

  let sourceAnchor = sourceAnchors[0];
  let targetAnchor = targetAnchors[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidateSource of sourceAnchors) {
    for (const candidateTarget of targetAnchors) {
      const score = (1 + candidateSource.normal.dot(candidateTarget.normal)) * 10
        + Math.hypot(
          candidateSource.position.y - candidateTarget.position.y,
          candidateSource.position.z - candidateTarget.position.z
        );
      if (score >= bestScore) continue;
      bestScore = score;
      sourceAnchor = candidateSource;
      targetAnchor = candidateTarget;
    }
  }
  if (!sourceAnchor || !targetAnchor) throw new Error('Ungültiges Composite-Punktpaar.');

  const desiredSourceAnchor = targetAnchor.position.clone()
    .addScaledVector(targetAnchor.normal, gap);
  const translation = desiredSourceAnchor.sub(sourceAnchor.position);
  const previousObject: SceneObjectData = {
    ...source,
    position: [
      source.position[0] + translation.x,
      source.position[1] + translation.y,
      source.position[2] + translation.z
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
  if (!previousTarget || !currentTarget) {
    throw new Error('Composite-Sweep-Testtopologie konnte nicht erzeugt werden.');
  }

  return {
    target,
    previousObject,
    currentObject,
    previousTarget,
    currentTarget,
    fixedTarget
  };
}

function expectPhysicalCompositeContact(
  currentTarget: SurfaceSnapTarget,
  fixedTarget: SurfaceSnapTarget,
  result: NonNullable<ReturnType<typeof findSweptSurfaceTargetSnap>>
): void {
  const targetAnchor = worldAnchors(fixedTarget)
    .find((anchor) => anchor.id === result.targetAnchorId);
  expect(targetAnchor).toBeDefined();
  if (!targetAnchor) return;

  const correctedMatrix = currentTarget.matrixWorld.clone();
  correctedMatrix.setPosition(...result.position);
  const localSupport = currentTarget.supportPoints?.length
    ? currentTarget.supportPoints
    : currentTarget.anchors.map((anchor) => anchor.position);
  const worldSupport = transformSurfaceSupportPoints(localSupport, correctedMatrix);

  expect(minimumSurfaceProjection(worldSupport, targetAnchor.normal))
    .toBeCloseTo(targetAnchor.position.dot(targetAnchor.normal), 4);
}

describe('kontinuierlicher äußerer Composite-Snap', () => {
  it.each(['box', 'cylinder'] as const)(
    'stoppt eine Gruppe trotz übersprungener Fangzone an %s',
    (targetType) => {
      const setup = crossingSetup(targetType);
      const result = findSweptSurfaceTargetSnap(
        setup.previousTarget,
        setup.currentTarget,
        [setup.fixedTarget],
        STEP
      );

      expect(result?.targetId).toBe(setup.target.id);
      if (!result) return;
      expect(result.position[0]).toBeGreaterThan(setup.previousTarget.matrixWorld.elements[12] ?? -Infinity);
      expect(result.position[0]).toBeLessThan(setup.currentTarget.matrixWorld.elements[12] ?? Infinity);
      expectPhysicalCompositeContact(setup.currentTarget, setup.fixedTarget, result);
    }
  );

  it('führt den Sweep über die gemeinsame Drag-Sitzung ohne Viewport-Sonderzustand aus', () => {
    const setup = crossingSetup('box', 0.2);
    const initial = resolveCompositeTranslationSurfaceSnap(
      setup.previousTarget,
      [setup.fixedTarget],
      targetCenter(setup.previousTarget),
      createTranslationSurfaceSnapSession(),
      0.1
    );
    expect(initial.result.targetId).toBeNull();

    const crossed = resolveCompositeTranslationSurfaceSnap(
      setup.currentTarget,
      [setup.fixedTarget],
      targetCenter(setup.currentTarget),
      initial.session,
      0.1
    );

    expect(crossed.result.targetId).toBe(setup.target.id);
    expect(crossed.session.previousCompositeTarget).not.toBeNull();
  });

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
