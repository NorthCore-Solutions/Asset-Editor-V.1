import { describe, expect, it } from 'vitest';
import { createGeometry } from '../src/geometry/factory';
import { getSurfaceUvAtlas } from '../src/geometry/uvAtlas';
import {
  getSurfaceRasterMetrics,
  surfaceUvWindow
} from '../src/editor/paint/surfacePaintGrid';

function metricsForScale(scale: [number, number, number]) {
  const geometry = createGeometry({
    type: 'box',
    geometry: { width: 1, height: 1, depth: 1 }
  });
  const atlas = getSurfaceUvAtlas(geometry);
  const metrics = getSurfaceRasterMetrics(geometry, scale, atlas);
  geometry.dispose();
  return metrics;
}

describe('unabhängige Bemalungsraster', () => {
  it('führt jede Würfelseite als eigenes 32x32-Raster', () => {
    const metrics = metricsForScale([1, 1, 1]);

    expect(metrics.map((metric) => metric.label)).toEqual([
      'Rechts', 'Links', 'Oben', 'Unten', 'Vorne', 'Hinten'
    ]);
    expect(metrics).toHaveLength(6);
    metrics.forEach((metric) => {
      expect(metric.width).toBe(32);
      expect(metric.height).toBe(32);
      expect(metric.coverageU).toBeCloseTo(1);
      expect(metric.coverageV).toBeCloseTo(1);
    });
  });

  it('berechnet die Rastermaße pro realer Fläche statt pro Gesamtform', () => {
    const metrics = metricsForScale([2.1, 3.25, 0.5]);
    const byLabel = new Map(metrics.map((metric) => [metric.label, metric]));

    expect(byLabel.get('Vorne')).toMatchObject({ width: 68, height: 104 });
    expect(byLabel.get('Hinten')).toMatchObject({ width: 68, height: 104 });
    expect(byLabel.get('Rechts')).toMatchObject({ width: 16, height: 104 });
    expect(byLabel.get('Links')).toMatchObject({ width: 16, height: 104 });
    expect(byLabel.get('Oben')).toMatchObject({ width: 68, height: 16 });
    expect(byLabel.get('Unten')).toMatchObject({ width: 68, height: 16 });
  });

  it('beschneidet bei freien Maßen nur den äußeren Rasteranteil', () => {
    const front = metricsForScale([2.1, 1, 1]).find((metric) => metric.label === 'Vorne');
    expect(front).toBeDefined();
    expect(front?.width).toBe(68);
    expect(front?.coverageU).toBeCloseTo(67.2 / 68, 6);

    const window = surfaceUvWindow(front!);
    expect(window.scaleU).toBeCloseTo(67.2 / 68, 6);
    expect(window.offsetU).toBeCloseTo((1 - 67.2 / 68) / 2, 6);
    expect(window.offsetV).toBe(0);
  });
});
