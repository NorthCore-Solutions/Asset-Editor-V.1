import { describe, expect, it } from 'vitest';
import { EDITOR_VERSION } from './version';

describe('Editor-Version', () => {
  it('entspricht dem OTA-Bundle .10', () => {
    expect(EDITOR_VERSION).toBe('0.2.0');
  });
});
