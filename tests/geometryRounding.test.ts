import { describe, expect, it } from 'vitest';
import { createGeometry, createSceneObject } from '../src/geometry/factory';
import {
  cornerRoundnessValue,
  edgeRoundnessValue,
  roundedBoxRadius,
  roundedBoxSegments,
  supportsGeometryRounding
} from '../src/geometry/rounding';
import { getSurfaceUvAtlas } from '../src/geometry/uvAtlas';

function triangleCount(geometry: ReturnType<typeof createGeometry>): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

describe('Geometrie-Abrundung', () => {
  it('aktiviert die Regler nur für quaderbasierte Formen', () => {
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

  it('lässt die ursprüngliche Box bei null Prozent unverändert', () => {
    const object = createSceneObject('box');
    object.geometry = {
      ...object.geometry,
      cornerRoundness: 0,
      edgeRoundness: 100
    };
    const geometry = createGeometry(object);

    try {
      expect(triangleCount(geometry)).toBe(12);
      expect(cornerRoundnessValue(object.geometry)).toBe(0);
      expect(edgeRoundnessValue(object.geometry)).toBe(100);
    } finally {
      geometry.dispose();
    }
  });

  it('behält beim Abrunden die Außenmaße und sechs Malflächen', () => {
    const object = createSceneObject('cuboid');
    object.geometry = {
      ...object.geometry,
      cornerRoundness: 65,
      edgeRoundness: 75
    };
    const geometry = createGeometry(object);

    try {
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      expect(bounds).not.toBeNull();
      expect(bounds?.min.x).toBeCloseTo(-1, 5);
      expect(bounds?.max.x).toBeCloseTo(1, 5);
      expect(bounds?.min.y).toBeCloseTo(-0.5, 5);
      expect(bounds?.max.y).toBeCloseTo(0.5, 5);
      expect(bounds?.min.z).toBeCloseTo(-0.5, 5);
      expect(bounds?.max.z).toBeCloseTo(0.5, 5);
      expect(getSurfaceUvAtlas(geometry).islands).toHaveLength(6);
      expect(triangleCount(geometry)).toBeGreaterThan(12);
    } finally {
      geometry.dispose();
    }
  });

  it('erhöht mit Eckkanten-Abrundung nur die Kurvenauflösung', () => {
    const object = createSceneObject('box');
    const coarse = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 50, edgeRoundness: 0 }
    });
    const smooth = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 50, edgeRoundness: 100 }
    });

    try {
      coarse.computeBoundingBox();
      smooth.computeBoundingBox();
      expect(triangleCount(smooth)).toBeGreaterThan(triangleCount(coarse));
      expect(smooth.boundingBox?.getSize({ x: 0, y: 0, z: 0 } as never)).toBeDefined();
      expect(coarse.boundingBox?.min.x).toBeCloseTo(smooth.boundingBox?.min.x ?? 0, 5);
      expect(coarse.boundingBox?.max.x).toBeCloseTo(smooth.boundingBox?.max.x ?? 0, 5);
      expect(coarse.boundingBox?.min.y).toBeCloseTo(smooth.boundingBox?.min.y ?? 0, 5);
      expect(coarse.boundingBox?.max.y).toBeCloseTo(smooth.boundingBox?.max.y ?? 0, 5);
      expect(coarse.boundingBox?.min.z).toBeCloseTo(smooth.boundingBox?.min.z ?? 0, 5);
      expect(coarse.boundingBox?.max.z).toBeCloseTo(smooth.boundingBox?.max.z ?? 0, 5);
    } finally {
      coarse.dispose();
      smooth.dispose();
    }
  });

  it('begrenzt Radius und Segmentzahl sicher', () => {
    expect(roundedBoxSegments(-100)).toBe(1);
    expect(roundedBoxSegments(1000)).toBe(8);
    expect(roundedBoxRadius(2, 1, 3, -10)).toBe(0);
    expect(roundedBoxRadius(2, 1, 3, 1000)).toBeCloseTo(0.499, 6);
  });
});
