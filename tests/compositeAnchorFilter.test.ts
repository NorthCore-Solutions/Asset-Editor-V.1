import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { removeOpposingCoincidentAnchors } from '../src/editor/snapping/compositeAnchorFilter';
import type { SurfaceSnapAnchor } from '../src/editor/snapping/surfaceSnapTopology';

function anchor(
  position: [number, number, number],
  normal: [number, number, number]
): SurfaceSnapAnchor {
  return {
    position: new THREE.Vector3(...position),
    normal: new THREE.Vector3(...normal).normalize()
  };
}

describe('Composite-Ankerfilter', () => {
  it('entfernt beide Richtungen einer deckungsgleichen inneren Kontaktfläche', () => {
    const internalNegative = anchor([0, 0.25, 0.25], [-1, 0, 0]);
    const internalPositive = anchor([0, 0.25, 0.25], [1, 0, 0]);
    const exterior = anchor([-1, 0.25, 0.25], [-1, 0, 0]);

    expect(removeOpposingCoincidentAnchors([
      internalNegative,
      internalPositive,
      exterior
    ])).toEqual([exterior]);
  });

  it('behält verschiedene Außenflächennormalen an einer gemeinsamen Kante', () => {
    const side = anchor([-1, 0.5, 0], [-1, 0, 0]);
    const top = anchor([-1, 0.5, 0], [0, 1, 0]);

    expect(removeOpposingCoincidentAnchors([side, top])).toEqual([side, top]);
  });

  it('entfernt gleichgerichtete Punkte derselben Außenfläche nicht', () => {
    const first = anchor([1, 0.25, 0.25], [1, 0, 0]);
    const second = anchor([1, 0.25, 0.25], [1, 0, 0]);

    expect(removeOpposingCoincidentAnchors([first, second])).toEqual([first, second]);
  });
});
