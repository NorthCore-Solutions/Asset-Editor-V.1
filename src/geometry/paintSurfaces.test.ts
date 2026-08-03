import { describe, expect, it } from 'vitest';
import { getSurfaceUvAtlas } from './uvAtlas';
import { createGeometry, createSceneObject, SHAPE_DEFINITIONS } from './factory';

describe('Paint-Flächen der Inventarformen', () => {
  it.each(SHAPE_DEFINITIONS)('$label erzeugt eine nutzbare UV-Flächenstruktur', ({ type }) => {
    const object = createSceneObject(type);
    const geometry = createGeometry(object);
    const atlas = getSurfaceUvAtlas(geometry);

    expect(geometry.getAttribute('uv')).toBeDefined();
    expect(atlas.islands.length).toBeGreaterThan(0);
    expect(atlas.islands.every((island) => island.uMax > island.uMin && island.vMax > island.vMin)).toBe(true);

    geometry.dispose();
  });
});
