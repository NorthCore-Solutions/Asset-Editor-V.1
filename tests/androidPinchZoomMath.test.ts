import { describe, expect, it } from 'vitest';
import { calculatePinchZoomStep } from '../src/editor/viewport/androidPinchZoomMath';

describe('Android-Pinch-Zoom', () => {
  it('halbiert die Fokustiefe bei verdoppeltem Fingerabstand', () => {
    const step = calculatePinchZoomStep(10, 100, 200, 1);
    expect(step.nextDepth).toBeCloseTo(5);
    expect(step.movement).toBeCloseTo(5);
  });

  it('kann über mehrere Gesten weiter hineinzoomen', () => {
    const first = calculatePinchZoomStep(10, 100, 200, 1);
    const second = calculatePinchZoomStep(first.nextDepth, 100, 200, 1);
    expect(second.nextDepth).toBeCloseTo(2.5);
    expect(second.movement).toBeGreaterThan(0);
  });

  it('unterschreitet die Mindesttiefe nicht', () => {
    const step = calculatePinchZoomStep(0.12, 100, 300, 1, 0.1);
    expect(step.nextDepth).toBe(0.1);
  });

  it('ignoriert ungültige Pinch-Werte', () => {
    expect(calculatePinchZoomStep(10, 0, 100, 1).movement).toBe(0);
  });
});
