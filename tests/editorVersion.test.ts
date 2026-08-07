import { describe, expect, it } from 'vitest';
import { EDITOR_VERSION } from '../src/app/version';

describe('sichtbare Editor-Version', () => {
  it('verwendet auf Desktop und Android die Version 0.3.0', () => {
    expect(EDITOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(EDITOR_VERSION).toBe('0.3.0');
  });
});
