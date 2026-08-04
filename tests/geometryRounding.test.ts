import { describe, expect, it } from 'vitest';
import { createGeometry, createSceneObject } from '../src/geometry/factory';
import {
  cornerRoundnessValue,
  edgeRoundnessValue,
  supportsGeometryRounding
} from '../src/geometry/rounding';
import { getSurfaceUvAtlas } from '../src/geometry/uvAtlas';

function triangleCount(geometry: ReturnType<typeof createGeometry>): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

describe('Geometrie-Abrundung', () => {
  it('behält die Regler für quaderbasierte Formen sichtbar', () => {
    expect(supportsGeometryRounding('box')).toBe(true);
    expect(supportsGeometryRounding('cuboid')).toBe(true);
    expect(supportsGeometryRounding('wall')).toBe(true);
    expect(supportsGeometryRounding('floor')).toBe(true);
    expect(supportsGeometryRounding('flatRoof')).toBe(true);
    expect(supportsGeometryRounding('door')).toBe(true);
    expect(supportsGeometryRounding('window')).toBe(true);
    expect(supportsGeometryRounding('chimney')).toBe(true);
    expect(supportsGeometryRounding('sphere')).toBe(false);
    expect(supportsGeometryRounding('stairs')).toBe(false);
  });

  it('behält und begrenzt die gespeicherten Reglerwerte', () => {
    expect(cornerRoundnessValue({ cornerRoundness: 65 })).toBe(65);
    expect(edgeRoundnessValue({ edgeRoundness: 75 })).toBe(75);
    expect(cornerRoundnessValue({ cornerRoundness: -10 })).toBe(0);
    expect(edgeRoundnessValue({ edgeRoundness: 500 })).toBe(100);
  });

  it('erzeugt unabhängig von beiden Reglerwerten eine normale Box', () => {
    const object = createSceneObject('cuboid');
    const sharp = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 0, edgeRoundness: 0 }
    });
    const storedRoundness = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 100, edgeRoundness: 100 }
    });

    try {
      expect(triangleCount(sharp)).toBe(12);
      expect(triangleCount(storedRoundness)).toBe(12);
      expect(sharp.getAttribute('position').array).toEqual(storedRoundness.getAttribute('position').array);
      expect(getSurfaceUvAtlas(storedRoundness).islands).toHaveLength(6);
    } finally {
      sharp.dispose();
      storedRoundness.dispose();
    }
  });
});
