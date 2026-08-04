import { describe, expect, it } from 'vitest';
import {
  atlasRegionPixelSize,
  chooseAtlasCellPixelSize,
  chooseAtlasInnerPixelSize
} from '../src/editor/paint/surfaceAtlasSizing';

const MAX_SURFACE_PIXELS = 384;
const ATLAS_PADDING = 0.07;

describe('Paint-Atlasgrößen', () => {
  it('bildet eine 32-Pixel-Würfelfläche ohne 32-zu-34-Streckung ab', () => {
    const inner = chooseAtlasInnerPixelSize([32, 32, 32, 32, 32, 32], MAX_SURFACE_PIXELS);
    const cell = chooseAtlasCellPixelSize(inner, ATLAS_PADDING);

    expect(inner).toBe(32);
    expect(cell).toBe(36);
    expect(atlasRegionPixelSize(cell, ATLAS_PADDING)).toBe(32);
  });

  it('verwendet bei verschiedenen Flächenmaßen ein gemeinsames ganzzahliges Vielfaches', () => {
    const inner = chooseAtlasInnerPixelSize([24, 32], MAX_SURFACE_PIXELS);
    const cell = chooseAtlasCellPixelSize(inner, ATLAS_PADDING);
    const region = atlasRegionPixelSize(cell, ATLAS_PADDING);

    expect(inner).toBe(96);
    expect(region).toBe(96);
    expect(region % 24).toBe(0);
    expect(region % 32).toBe(0);
  });

  it('begrenzt nicht praktikable gemeinsame Vielfache auf die bestehende Obergrenze', () => {
    expect(chooseAtlasInnerPixelSize([31, 32], MAX_SURFACE_PIXELS)).toBe(MAX_SURFACE_PIXELS);
  });
});
