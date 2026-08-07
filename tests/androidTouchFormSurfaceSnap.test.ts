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

function internalBoxCrossing(): {
  source: SceneObjectData;
  candidate: SceneObjectData;
  target: SceneObjectData;
} {
  const target = createSceneObject('box');
  target.id = 'target-box';
  const source = createSceneObject('box');
  source.id = 'source-box';
  source.position = [-1.1, target.position[1], target.position[2]];
  const candidate = withPosition(source, [-0.6, source.position[1], source.position[2]]);
  return { source, candidate, target };
}

describe.each(['Maus', 'Touch'])('gemeinsamer Formen-Snap für %s', () => {
  it('ignoriert die Außenhaut und fängt erst einen inneren Cutter-Schnitt', () => {
    const { source, candidate, target } = internalBoxCrossing();
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
    expect(resolution.result.position[0]).toBeCloseTo(-0.75, 6);
    expect(resolution.result.position[0]).toBeGreaterThan(-1);
  });

  it('hält einen inneren Kontakt bei kleinen kontinuierlichen Rohbewegungen', () => {
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
