import { describe, expect, it } from 'vitest';
import { isAndroidMarqueePointer } from '../src/editor/viewport/androidMarqueeSelection';

describe('Android-Bereichsauswahl', () => {
  it('aktiviert Touch-Eingaben nur im nativen Android-Auswahlmodus', () => {
    expect(isAndroidMarqueePointer(true, true, 'touch')).toBe(true);
    expect(isAndroidMarqueePointer(true, false, 'touch')).toBe(false);
    expect(isAndroidMarqueePointer(false, true, 'touch')).toBe(false);
  });

  it('unterstützt Touch und Stift, aber keine Maus als Android-Ersatz für STRG', () => {
    expect(isAndroidMarqueePointer(true, true, 'pen')).toBe(true);
    expect(isAndroidMarqueePointer(true, true, 'mouse')).toBe(false);
  });
});
