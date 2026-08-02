import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGeometry } from './factory';
import { atlasIslandAtUv, getSurfaceUvAtlas } from './uvAtlas';

function groupIsland(geometry: THREE.BufferGeometry, start: number): number {
  const uv = geometry.getAttribute('uv');
  const point = new THREE.Vector2(
    (uv.getX(start) + uv.getX(start + 1) + uv.getX(start + 2)) / 3,
    (uv.getY(start) + uv.getY(start + 1) + uv.getY(start + 2)) / 3
  );
  return atlasIslandAtUv(getSurfaceUvAtlas(geometry), point);
}

describe('Oberflächen-UV-Atlas', () => {
  it('ordnet den sechs Würfelseiten sechs getrennte UV-Inseln zu', () => {
    const geometry = createGeometry({
      type: 'box',
      geometry: { width: 1, height: 1, depth: 1 }
    });
    const atlas = getSurfaceUvAtlas(geometry);
    const islands = new Set(geometry.groups.map((group) => groupIsland(geometry, group.start)));

    expect(atlas.mode).toBe('groups');
    expect(atlas.islands).toHaveLength(6);
    expect(islands.size).toBe(6);
    geometry.dispose();
  });

  it('trennt bei einer Treppe Stufen, Setzflächen und Seiten', () => {
    const geometry = createGeometry({
      type: 'stairs',
      geometry: { width: 2, height: 1.4, depth: 1.6, steps: 5 }
    });
    const atlas = getSurfaceUvAtlas(geometry);

    expect(atlas.mode).toBe('planar');
    expect(atlas.islands.length).toBeGreaterThan(6);
    geometry.dispose();
  });

  it('behält Kugeln als durchgehende Oberfläche', () => {
    const geometry = createGeometry({
      type: 'sphere',
      geometry: { radius: 1, widthSegments: 12, heightSegments: 8 }
    });
    const atlas = getSurfaceUvAtlas(geometry);

    expect(atlas.mode).toBe('native');
    expect(atlas.islands).toHaveLength(1);
    geometry.dispose();
  });
});
