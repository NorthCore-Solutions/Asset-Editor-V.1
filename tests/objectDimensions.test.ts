import { describe, expect, it } from 'vitest';
import { calculateObjectDimensionLayout } from '../src/editor/measurement/useObjectDimensionsOverlay';
import { createGeometry, createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';

describe('Objektmaße', () => {
  it('berechnet Länge, Höhe und Tiefe eines skalierten Würfels', () => {
    const object = createSceneObject('box');
    const geometry = createGeometry(object);

    try {
      const layout = calculateObjectDimensionLayout(geometry, [2, 3, 4]);
      expect(layout.length).toBeCloseTo(2, 6);
      expect(layout.height).toBeCloseTo(3, 6);
      expect(layout.depth).toBeCloseTo(4, 6);
    } finally {
      geometry.dispose();
    }
  });

  it.each(SHAPE_DEFINITIONS)('$label liefert gültige Maßlinien', ({ type }) => {
    const object = createSceneObject(type);
    const geometry = createGeometry(object);

    try {
      const layout = calculateObjectDimensionLayout(geometry, object.scale);
      const values = [
        layout.length,
        layout.height,
        layout.depth,
        layout.offset,
        layout.labelLift,
        layout.labelWidth,
        layout.labelHeight,
        layout.dashSize,
        layout.gapSize
      ];

      values.forEach((value) => {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      });
      expect(layout.max.x).toBeGreaterThanOrEqual(layout.min.x);
      expect(layout.max.y).toBeGreaterThanOrEqual(layout.min.y);
      expect(layout.max.z).toBeGreaterThanOrEqual(layout.min.z);
    } finally {
      geometry.dispose();
    }
  });
});
