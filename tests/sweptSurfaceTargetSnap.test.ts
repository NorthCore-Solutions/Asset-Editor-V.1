import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects,
  type SurfaceSnapTarget
} from '../src/editor/snapping/objectSurfaceSnap';
import {
  createTranslationSurfaceSnapSession,
  resolveCompositeTranslationSurfaceSnap
} from '../src/editor/snapping/translationSurfaceSnap';
import { findSweptSurfaceTargetSnap } from '../src/editor/snapping/sweptSurfaceTargetSnap';
import type { SceneObjectData } from '../src/types/editor';

const STEP = 0.25;

function boxAt(id: string, x: number): SceneObjectData {
  const object = createSceneObject('box');
  object.id = id;
  object.position = [x, object.position[1], object.position[2]];
  return object;
}

function compositeAt(id: string, x: number): SurfaceSnapTarget {
  const target = surfaceSnapTargetFromSceneObjects([boxAt(`${id}-part`, x)], id);
  if (!target) throw new Error(`Keine Composite-Topologie für ${id}.`);
  return target;
}

function fixedBox(): { object: SceneObjectData; target: SurfaceSnapTarget } {
  const object = boxAt('target-box', 0);
  const target = surfaceSnapTargetFromSceneObject(object);
  if (!target) throw new Error('Keine Zieltopologie für Würfel.');
  return { object, target };
}

function center(target: SurfaceSnapTarget): [number, number, number] {
  const value = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
  return [value.x, value.y, value.z];
}

describe('kombinierter Composite-Snap', () => {
  it('fängt den äußeren Kontakt wieder ein', () => {
    const previous = compositeAt('moving-composite', -1.1);
    const crossed = compositeAt('moving-composite', -0.9);
    const { object, target } = fixedBox();

    const result = findSweptSurfaceTargetSnap(previous, crossed, [target], STEP);

    expect(result?.targetId).toBe(object.id);
    expect(result?.targetAnchorId).toBeTruthy();
    expect(result?.targetAnchorId).not.toMatch(/^internal:/);
    expect(result?.position[0]).toBeCloseTo(-1, 6);
  });

  it('behält den inneren Cutter-Snap zusätzlich bei', () => {
    const source = compositeAt('moving-composite', -0.75);
    const { object, target } = fixedBox();

    const result = resolveCompositeTranslationSurfaceSnap(
      source,
      [target],
      center(source),
      createTranslationSurfaceSnapSession(),
      STEP
    );

    expect(result.result.targetId).toBe(object.id);
    expect(result.result.targetAnchorId).toMatch(/^internal:/);
    expect(result.result.sourceAnchorId).toMatch(/^internal:/);
    expect(result.result.position[0]).toBeCloseTo(-0.75, 6);
  });

  it('führt den äußeren Sweep über dieselbe Drag-Sitzung aus', () => {
    const previous = compositeAt('moving-composite', -1.1);
    const current = compositeAt('moving-composite', -0.9);
    const { object, target } = fixedBox();

    const initial = resolveCompositeTranslationSurfaceSnap(
      previous,
      [target],
      center(previous),
      createTranslationSurfaceSnapSession(),
      STEP
    );
    expect(initial.result.targetId).toBeNull();

    const crossed = resolveCompositeTranslationSurfaceSnap(
      current,
      [target],
      center(current),
      initial.session,
      STEP
    );

    expect(crossed.result.targetId).toBe(object.id);
    expect(crossed.result.position[0]).toBeCloseTo(-1, 6);
    expect(crossed.session.previousCompositeTarget).not.toBeNull();
  });

  it('lässt eine Gruppe vom äußeren Punkt wieder wegziehen', () => {
    const previous = compositeAt('moving-composite', -1);
    const away = compositeAt('moving-composite', -1.35);
    const { target } = fixedBox();

    expect(findSweptSurfaceTargetSnap(
      previous,
      away,
      [target],
      STEP
    )).toBeNull();
  });
});
