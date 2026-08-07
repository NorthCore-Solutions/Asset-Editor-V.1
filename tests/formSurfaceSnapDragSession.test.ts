import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import {
  createTranslationSurfaceSnapSession,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession
} from '../src/editor/snapping/translationSurfaceSnap';

const STEP = 0.25;

function activeSession(): TranslationSurfaceSnapSession {
  return {
    active: {
      targetId: 'target',
      targetAnchorId: 'target:anchor:1',
      sourceAnchorId: 'source:anchor:1',
      captureRawPosition: [0, 0, 0],
      acceptedPosition: [2, 3, 4]
    },
    suppressed: null,
    previousCompositeTarget: null
  };
}

describe('lokale Formen-Snap-Sitzung des Viewports', () => {
  it('ist pro Drag neu und besitzt keinen globalen Plattformzustand', () => {
    const first = createTranslationSurfaceSnapSession();
    const second = createTranslationSurfaceSnapSession();

    expect(first).not.toBe(second);
    expect(first).toEqual({
      active: null,
      suppressed: null,
      previousCompositeTarget: null
    });
    expect(second).toEqual({
      active: null,
      suppressed: null,
      previousCompositeTarget: null
    });
  });

  it('hält wie das normale 0,25-Snapping bis knapp vor den nächsten Schritt', () => {
    const source = createSceneObject('box');
    source.position = [20, 20, 20];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [0.24, 0, 0],
      activeSession()
    );

    expect(resolution.result.position).toEqual([2, 3, 4]);
    expect(resolution.result.targetId).toBe('target');
    expect(resolution.session.active).not.toBeNull();
  });

  it('gibt den Punkt erst oberhalb eines vollständigen 0,25-Schritts frei', () => {
    const source = createSceneObject('box');
    source.position = [2, 3.26, 4];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [0, 0.26, 0],
      activeSession()
    );

    expect(resolution.result.targetId).toBeNull();
    expect(resolution.result.position).toEqual(source.position);
    expect(resolution.session.active).toBeNull();
  });

  it('unterdrückt nach Freigabe nur das konkrete Cutter-Paar', () => {
    const source = createSceneObject('box');
    source.position = [2.26, 3, 4];
    const resolution = resolveTranslationSurfaceSnap(
      source,
      [],
      STEP,
      [0.26, 0, 0],
      activeSession()
    );

    expect(resolution.session.suppressed).toEqual({
      targetAnchorId: 'target:anchor:1',
      sourceAnchorId: 'source:anchor:1',
      rawOrigin: [0.26, 0, 0]
    });
  });
});
