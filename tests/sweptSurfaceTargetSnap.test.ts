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

describe('kontinuierlicher innerer Composite-Snap', () => {
  it('ignoriert beim Durchziehen den reinen Außenkontakt', () => {
    const previous = compositeAt('moving-composite', -1.1);
    const outerContact = compositeAt('moving-composite', -1);
    const { target } = fixedBox();

    expect(findSweptSurfaceTargetSnap(
      previous,
      outerContact,
      [target],
      STEP
    )).toBeNull();
  });

  it('stoppt eine Gruppe am ersten inneren Cutter-Schnitt', () => {
    const previous = compositeAt('moving-composite', -1.1);
    const current = compositeAt('moving-composite', -0.6);
    const { object, target } = fixedBox();
    const result = findSweptSurfaceTargetSnap(previous, current, [target], STEP);

    expect(result?.targetId).toBe(object.id);
    expect(result?.targetAnchorId).toMatch(/^internal:/);
    expect(result?.sourceAnchorId).toMatch(/^internal:/);
    expect(result?.position[0]).toBeCloseTo(-0.75, 6);
  });

  it('führt denselben inneren Sweep über die gemeinsame Drag-Sitzung aus', () => {
    const previous = compositeAt('moving-composite', -1.1);
    const current = compositeAt('moving-composite', -0.6);
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
    expect(crossed.result.position[0]).toBeCloseTo(-0.75, 6);
    expect(crossed.session.previousCompositeTarget).not.toBeNull();
  });

  it('lässt eine Gruppe aus einem inneren Schnitt wieder herausziehen', () => {
    const previous = compositeAt('moving-composite', -0.75);
    const away = compositeAt('moving-composite', -1.1);
    const { target } = fixedBox();

    expect(findSweptSurfaceTargetSnap(
      previous,
      away,
      [target],
      STEP
    )).toBeNull();
  });
});
