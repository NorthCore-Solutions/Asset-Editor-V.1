import { describe, expect, it } from 'vitest';
import { shouldConnectStroke } from './strokeContinuity';

describe('Paint-Strich-Kontinuität', () => {
  it('verbindet normale benachbarte Pointerbewegungen', () => {
    expect(shouldConnectStroke(
      { pixel: [40, 40], client: [100, 100] },
      { pixel: [52, 46], client: [103, 102] },
      128,
      128,
      2
    )).toBe(true);
  });

  it('verbindet nicht über eine UV-Naht', () => {
    expect(shouldConnectStroke(
      { pixel: [124, 64], client: [200, 120] },
      { pixel: [3, 65], client: [202, 121] },
      128,
      128,
      2
    )).toBe(false);
  });

  it('verbindet keinen unplausiblen Sprung nach verlorenem Flächentreffer', () => {
    expect(shouldConnectStroke(
      { pixel: [30, 30], client: [100, 100] },
      { pixel: [92, 88], client: [101, 101] },
      256,
      256,
      1
    )).toBe(false);
  });

  it('erlaubt schnelle echte Bewegungen bei entsprechend großer Mausbewegung', () => {
    expect(shouldConnectStroke(
      { pixel: [20, 20], client: [100, 100] },
      { pixel: [96, 70], client: [110, 106] },
      256,
      256,
      2
    )).toBe(true);
  });
});
