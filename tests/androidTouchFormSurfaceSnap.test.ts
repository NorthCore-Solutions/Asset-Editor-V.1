import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import {
  createTranslationSurfaceSnapSession,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession
} from '../src/editor/snapping/translationSurfaceSnap';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;

function withPosition(object: SceneObjectData, position: Vec3): SceneObjectData {
  return { ...object, position };
}

function boxAt(id: string, x: number): SceneObjectData {
  const object = createSceneObject('box');
  object.id = id;
  object.position = [x, object.position[1], object.position[2]];
  return object;
}

describe.each(['Maus', 'Touch'])('gemeinsamer Formen-Snap für %s', () => {
  it('fängt den äußeren Oberflächenpunkt mit demselben Solver', () => {
    const target = boxAt('target-box', 0);
    const source = boxAt('source-box', -1.1);
    const candidate = boxAt('source-box', -0.9);
    const resolution = resolveTranslationSurfaceSnap(
      candidate,
      [source, target],
      STEP,
      candidate.position,
      createTranslationSurfaceSnapSession()
    );

    expect(resolution.result.targetId).toBe(target.id);
    expect(resolution.result.targetAnchorId).toBeTruthy();
    expect(resolution.result.targetAnchorId).not.toMatch(/^internal:/);
    expect(resolution.result.position[0]).toBeCloseTo(-1, 6);
  });

  it('fängt weiterhin den nächsten inneren Cutter-Schnitt', () => {
    const target = boxAt('target-box', 0);
    const source = boxAt('source-box', -0.75);
    const candidate = boxAt('source-box', -0.4);
    const resolution = resolveTranslationSurfaceSnap(
      candidate,
      [source, target],
      STEP,
      candidate.position,
      createTranslationSurfaceSnapSession()
    );

    expect(resolution.result.targetId).toBe(target.id);
    expect(resolution.result.targetAnchorId).toMatch(/^internal:/);
    expect(resolution.result.sourceAnchorId).toMatch(/^internal:/);
    expect(resolution.result.position[0]).toBeCloseTo(-0.5, 6);
  });

  it('hält einen Kontakt bei kleinen kontinuierlichen Rohbewegungen', () => {
    const session: TranslationSurfaceSnapSession = {
      active: {
        targetId: 'target-box',
        targetAnchorId: 'internal:target-box:x:0',
        sourceAnchorId: 'internal:source-box:x:3',
        captureRawPosition: [1, 2, 3],
        acceptedPosition: [0.75, 2, 3]
      },
      suppressed: null,
      previousCompositeTarget: null
    };
    const source = createSceneObject('box');
    source.position = [0.8, 2, 3];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [1.08, 2, 3],
      session
    );

    expect(resolution.result.targetId).toBe('target-box');
    expect(resolution.result.position).toEqual([0.75, 2, 3]);
    expect(resolution.session.active).not.toBeNull();
  });

  it('gibt den Kontakt nach Verlassen des Fangbereichs ohne Blockade frei', () => {
    const session: TranslationSurfaceSnapSession = {
      active: {
        targetId: 'target-box',
        targetAnchorId: 'internal:target-box:x:0',
        sourceAnchorId: 'internal:source-box:x:3',
        captureRawPosition: [1, 2, 3],
        acceptedPosition: [0.75, 2, 3]
      },
      suppressed: null,
      previousCompositeTarget: null
    };
    const source = createSceneObject('box');
    source.position = [1.25, 2, 3];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [1.25, 2, 3],
      session
    );

    expect(resolution.result.targetId).toBeNull();
    expect(resolution.result.position).toEqual(source.position);
    expect(resolution.session.active).toBeNull();
    expect(resolution.session.suppressed?.targetAnchorId).toBe('internal:target-box:x:0');
    expect(resolution.session.suppressed?.sourceAnchorId).toBe('internal:source-box:x:3');
  });
});
