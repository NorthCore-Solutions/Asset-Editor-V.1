import { describe, expect, it } from 'vitest';
import { invertHexColor } from '../src/utils/color';

describe('Kontrastfarbener Mittelpunkt', () => {
  it('invertiert helle und dunkle Grundfarben', () => {
    expect(invertHexColor('#FFFFFF')).toBe('#000000');
    expect(invertHexColor('#000000')).toBe('#FFFFFF');
  });

  it('invertiert die RGB-Grundfarben exakt', () => {
    expect(invertHexColor('#FF0000')).toBe('#00FFFF');
    expect(invertHexColor('#00FF00')).toBe('#FF00FF');
    expect(invertHexColor('#0000FF')).toBe('#FFFF00');
  });

  it('verarbeitet Kurzschreibweise und ungültige Werte stabil', () => {
    expect(invertHexColor('#abc')).toBe('#554433');
    expect(invertHexColor('ungültig')).toBe('#000000');
  });
});
