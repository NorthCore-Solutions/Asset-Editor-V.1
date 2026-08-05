import { describe, expect, it } from 'vitest';
import { EDITOR_VERSION } from '../src/app/version';

describe('sichtbare Editor-Version', () => {
  it('verwendet für OTA-Bundle .15 die Version 0.2.5', () => {
    expect(EDITOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(EDITOR_VERSION).toBe('0.2.5');
  });
});
