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

  it('formt Eckkanten bei gleichem Radius von einer Fase zu einem C-Bogen', () => {
    const object = createSceneObject('box');
    const bevel = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 100, edgeRoundness: 0 }
    });
    const cCurve = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 100, edgeRoundness: 100 }
    });

    try {
      expect(triangleCount(bevel)).toBe(triangleCount(cCurve));
      expect(maximumPositionDifference(bevel, cCurve)).toBeGreaterThan(0.03);
      expect(bevel.boundingBox?.min.x).toBeCloseTo(cCurve.boundingBox?.min.x ?? 0, 5);
      expect(bevel.boundingBox?.max.x).toBeCloseTo(cCurve.boundingBox?.max.x ?? 0, 5);
      expect(bevel.boundingBox?.min.y).toBeCloseTo(cCurve.boundingBox?.min.y ?? 0, 5);
      expect(bevel.boundingBox?.max.y).toBeCloseTo(cCurve.boundingBox?.max.y ?? 0, 5);
    } finally {
      bevel.dispose();
      cCurve.dispose();
    }
  });

  it('verändert die acht Eckbereiche unabhängig vom C-Profil der Kanten', () => {
    const object = createSceneObject('box');
    const angularCorners = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 0, edgeRoundness: 100 }
    });
    const roundedCorners = createGeometry({
      type: object.type,
      geometry: { ...object.geometry, cornerRoundness: 100, edgeRoundness: 100 }
    });

    try {
      expect(triangleCount(angularCorners)).toBe(triangleCount(roundedCorners));
      expect(maximumPositionDifference(angularCorners, roundedCorners)).toBeGreaterThan(0.03);
      expect(angularCorners.boundingBox?.min.z).toBeCloseTo(roundedCorners.boundingBox?.min.z ?? 0, 5);
      expect(angularCorners.boundingBox?.max.z).toBeCloseTo(roundedCorners.boundingBox?.max.z ?? 0, 5);
    } finally {
      angularCorners.dispose();
      roundedCorners.dispose();
    }
  });

  it('begrenzt Radius sicher und hält die Auflösung konstant', () => {
    expect(roundedBoxSegments(-100)).toBe(8);
    expect(roundedBoxSegments(1000)).toBe(8);
    expect(roundedBoxRadius(2, 1, 3, -10)).toBe(0);
    expect(roundedBoxRadius(2, 1, 3, 1000)).toBeCloseTo(0.499, 6);
  });
});
