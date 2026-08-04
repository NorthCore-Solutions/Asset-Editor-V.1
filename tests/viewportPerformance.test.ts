import { describe, expect, it } from 'vitest';
import {
  cappedViewportPixelRatio,
  zoomSpeedForDistance
} from '../src/editor/viewport/useViewportPerformance';

describe('Viewport-Performance', () => {
  it('begrenzt hohe Geräteauflösungen ohne normale Displays zu verschlechtern', () => {
    expect(cappedViewportPixelRatio(1)).toBe(1);
    expect(cappedViewportPixelRatio(1.25)).toBe(1.25);
    expect(cappedViewportPixelRatio(2)).toBe(1.5);
    expect(cappedViewportPixelRatio(4)).toBe(1.5);
    expect(cappedViewportPixelRatio(0)).toBe(1);
    expect(cappedViewportPixelRatio(Number.NaN)).toBe(1);
  });

  it('beschleunigt den Zoom in Zielnähe kontrolliert', () => {
    const near = zoomSpeedForDistance(0.1);
    const medium = zoomSpeedForDistance(2);
    const far = zoomSpeedForDistance(20);

    expect(near).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(3.75);
    expect(far).toBeGreaterThanOrEqual(1.25);
  });

  it('behandelt ungültige Entfernungen stabil', () => {
    expect(Number.isFinite(zoomSpeedForDistance(Number.NaN))).toBe(true);
    expect(Number.isFinite(zoomSpeedForDistance(Number.POSITIVE_INFINITY))).toBe(true);
    expect(zoomSpeedForDistance(-10)).toBe(zoomSpeedForDistance(0));
  });
});
