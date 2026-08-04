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

function maximumPositionDifference(
  first: ReturnType<typeof createGeometry>,
  second: ReturnType<typeof createGeometry>
): number {
  const firstPosition = first.getAttribute('position');
  const secondPosition = second.getAttribute('position');
  expect(firstPosition.count).toBe(secondPosition.count);

  let maximum = 0;
  for (let index = 0; index < firstPosition.count; index += 1) {
    maximum = Math.max(
      maximum,
      Math.abs(firstPosition.getX(index) - secondPosition.getX(index)),
      Math.abs(firstPosition.getY(index) - secondPosition.getY(index)),
      Math.abs(firstPosition.getZ(index) - secondPosition.getZ(index))
    );
  }
  return maximum;
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

  it('lässt die ursprüngliche Box bei beiden Reglern auf null unverändert', () => {
    const object = createSceneObject('box');
    object.geometry = {
      ...object.geometry,
      cornerRoundness: 0,
      edgeRoundness: 0
    };
    const geometry = createGeometry(object);

    try {
      expect(triangleCount(geometry)).toBe(12);
      expect(cornerRoundnessValue(object.geometry)).toBe(0);
      expect(edgeRoundnessValue(object.geometry)).toBe(0);
    } finally {
      geometry.dispose();
    }
  });

  it('behält beim kombinierten Abrunden die Außenmaße und sechs Malflächen', () => {
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

  it('verändert Eckkanten als echten Radius bei gleicher Auflösung', () => {
    const object = createSceneObject('box');
    const lowEdgeRadius = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 35, edgeRoundness: 5 }
    });
    const highEdgeRadius = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 35, edgeRoundness: 90 }
    });

    try {
      expect(triangleCount(lowEdgeRadius)).toBe(triangleCount(highEdgeRadius));
      expect(maximumPositionDifference(lowEdgeRadius, highEdgeRadius)).toBeGreaterThan(0.05);
      expect(lowEdgeRadius.boundingBox?.min.x).toBeCloseTo(highEdgeRadius.boundingBox?.min.x ?? 0, 5);
      expect(lowEdgeRadius.boundingBox?.max.x).toBeCloseTo(highEdgeRadius.boundingBox?.max.x ?? 0, 5);
    } finally {
      lowEdgeRadius.dispose();
      highEdgeRadius.dispose();
    }
  });

  it('verändert Ecken unabhängig vom Kantenradius', () => {
    const object = createSceneObject('box');
    const lowCornerRadius = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 5, edgeRoundness: 40 }
    });
    const highCornerRadius = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 90, edgeRoundness: 40 }
    });

    try {
      expect(triangleCount(lowCornerRadius)).toBe(triangleCount(highCornerRadius));
      expect(maximumPositionDifference(lowCornerRadius, highCornerRadius)).toBeGreaterThan(0.05);
      expect(lowCornerRadius.boundingBox?.min.y).toBeCloseTo(highCornerRadius.boundingBox?.min.y ?? 0, 5);
      expect(lowCornerRadius.boundingBox?.max.y).toBeCloseTo(highCornerRadius.boundingBox?.max.y ?? 0, 5);
    } finally {
      lowCornerRadius.dispose();
      highCornerRadius.dispose();
    }
  });

  it('begrenzt Radius sicher und hält die Auflösung konstant', () => {
    expect(roundedBoxSegments(-100)).toBe(8);
    expect(roundedBoxSegments(1000)).toBe(8);
    expect(roundedBoxRadius(2, 1, 3, -10)).toBe(0);
    expect(roundedBoxRadius(2, 1, 3, 1000)).toBeCloseTo(0.499, 6);
  });
});
