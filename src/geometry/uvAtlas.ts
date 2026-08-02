import * as THREE from 'three';
import type { PrimitiveType } from '../types/editor';

export interface SurfaceUvIsland {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export interface SurfaceUvAtlas {
  version: 1;
  mode: 'native' | 'groups' | 'planar';
  columns: number;
  rows: number;
  padding: number;
  signature: string;
  islands: SurfaceUvIsland[];
}

export interface AtlasPixelRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const ATLAS_KEY = 'northcoreSurfaceUvAtlas';
const CELL_PADDING = 0.07;
const PLANE_QUANTIZATION = 10_000;

export const FULL_SURFACE_UV_ATLAS: SurfaceUvAtlas = {
  version: 1,
  mode: 'native',
  columns: 1,
  rows: 1,
  padding: 0,
  signature: 'native:1:1x1',
  islands: [{ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }]
};

function atlasGrid(count: number, mode: SurfaceUvAtlas['mode']): SurfaceUvAtlas {
  const safeCount = Math.max(1, count);
  const columns = Math.ceil(Math.sqrt(safeCount));
  const rows = Math.ceil(safeCount / columns);
  const cellWidth = 1 / columns;
  const cellHeight = 1 / rows;
  const islands: SurfaceUvIsland[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const padU = cellWidth * CELL_PADDING;
    const padV = cellHeight * CELL_PADDING;
    islands.push({
      uMin: column * cellWidth + padU,
      uMax: (column + 1) * cellWidth - padU,
      vMin: 1 - (row + 1) * cellHeight + padV,
      vMax: 1 - row * cellHeight - padV
    });
  }

  return {
    version: 1,
    mode,
    columns,
    rows,
    padding: CELL_PADDING,
    signature: `${mode}:${safeCount}:${columns}x${rows}`,
    islands
  };
}

function storeAtlas(geometry: THREE.BufferGeometry, atlas: SurfaceUvAtlas): THREE.BufferGeometry {
  geometry.userData[ATLAS_KEY] = atlas;
  return geometry;
}

export function getSurfaceUvAtlas(geometry: THREE.BufferGeometry): SurfaceUvAtlas {
  const stored = geometry.userData[ATLAS_KEY] as SurfaceUvAtlas | undefined;
  return stored ?? FULL_SURFACE_UV_ATLAS;
}

function ensureNonIndexed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometry.index) return geometry;
  const converted = geometry.toNonIndexed();
  geometry.dispose();
  return converted;
}

function groupedAtlas(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const result = ensureNonIndexed(geometry);
  const position = result.getAttribute('position');
  const sourceUv = result.getAttribute('uv');
  const groups = result.groups.filter((group) => group.count > 0);

  if (!position || !sourceUv || groups.length <= 1) {
    return storeAtlas(result, FULL_SURFACE_UV_ATLAS);
  }

  const atlas = atlasGrid(groups.length, 'groups');
  const uv = new Float32Array(position.count * 2);

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    uv[vertex * 2] = sourceUv.getX(vertex);
    uv[vertex * 2 + 1] = sourceUv.getY(vertex);
  }

  groups.forEach((group, islandIndex) => {
    const start = Math.max(0, group.start);
    const end = Math.min(position.count, group.start + group.count);
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;

    for (let vertex = start; vertex < end; vertex += 1) {
      minU = Math.min(minU, sourceUv.getX(vertex));
      maxU = Math.max(maxU, sourceUv.getX(vertex));
      minV = Math.min(minV, sourceUv.getY(vertex));
      maxV = Math.max(maxV, sourceUv.getY(vertex));
    }

    const sourceWidth = Math.max(maxU - minU, 0.000001);
    const sourceHeight = Math.max(maxV - minV, 0.000001);
    const island = atlas.islands[islandIndex];

    for (let vertex = start; vertex < end; vertex += 1) {
      const normalizedU = (sourceUv.getX(vertex) - minU) / sourceWidth;
      const normalizedV = (sourceUv.getY(vertex) - minV) / sourceHeight;
      uv[vertex * 2] = THREE.MathUtils.lerp(island.uMin, island.uMax, normalizedU);
      uv[vertex * 2 + 1] = THREE.MathUtils.lerp(island.vMin, island.vMax, normalizedV);
    }
  });

  result.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return storeAtlas(result, atlas);
}

function planeKey(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, triangle: number): string {
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  if (normal.lengthSq() < 0.0000000001) return `degenerate:${triangle}`;
  normal.normalize();
  const distance = normal.dot(a);
  const quantize = (value: number) => Math.round(value * PLANE_QUANTIZATION);
  return `${quantize(normal.x)}:${quantize(normal.y)}:${quantize(normal.z)}:${quantize(distance)}`;
}

function projectPoint(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, normal: THREE.Vector3): [number, number] {
  const x = position.getX(vertex);
  const y = position.getY(vertex);
  const z = position.getZ(vertex);
  const nx = Math.abs(normal.x);
  const ny = Math.abs(normal.y);
  const nz = Math.abs(normal.z);

  if (nx >= ny && nx >= nz) return [z, y];
  if (ny >= nx && ny >= nz) return [x, z];
  return [x, y];
}

function planarAtlas(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const result = ensureNonIndexed(geometry);
  const position = result.getAttribute('position');
  if (!position || position.count < 3) return storeAtlas(result, FULL_SURFACE_UV_ATLAS);

  const groups = new Map<string, number[]>();
  for (let start = 0, triangle = 0; start + 2 < position.count; start += 3, triangle += 1) {
    const a = new THREE.Vector3().fromBufferAttribute(position, start);
    const b = new THREE.Vector3().fromBufferAttribute(position, start + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, start + 2);
    const key = planeKey(a, b, c, triangle);
    const vertices = groups.get(key) ?? [];
    vertices.push(start, start + 1, start + 2);
    groups.set(key, vertices);
  }

  const islands = [...groups.values()];
  const atlas = atlasGrid(islands.length, 'planar');
  const uv = new Float32Array(position.count * 2);

  islands.forEach((vertices, islandIndex) => {
    const a = new THREE.Vector3().fromBufferAttribute(position, vertices[0]);
    const b = new THREE.Vector3().fromBufferAttribute(position, vertices[1]);
    const c = new THREE.Vector3().fromBufferAttribute(position, vertices[2]);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const projected = vertices.map((vertex) => ({ vertex, point: projectPoint(position, vertex, normal) }));
    const minU = Math.min(...projected.map((entry) => entry.point[0]));
    const maxU = Math.max(...projected.map((entry) => entry.point[0]));
    const minV = Math.min(...projected.map((entry) => entry.point[1]));
    const maxV = Math.max(...projected.map((entry) => entry.point[1]));
    const width = Math.max(maxU - minU, 0.000001);
    const height = Math.max(maxV - minV, 0.000001);
    const island = atlas.islands[islandIndex];

    projected.forEach(({ vertex, point }) => {
      uv[vertex * 2] = THREE.MathUtils.lerp(island.uMin, island.uMax, (point[0] - minU) / width);
      uv[vertex * 2 + 1] = THREE.MathUtils.lerp(island.vMin, island.vMax, (point[1] - minV) / height);
    });
  });

  result.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return storeAtlas(result, atlas);
}

export function applySurfaceUvAtlas(geometry: THREE.BufferGeometry, type: PrimitiveType): THREE.BufferGeometry {
  if (type === 'sphere' || type === 'torus') {
    return storeAtlas(geometry, FULL_SURFACE_UV_ATLAS);
  }

  if (
    type === 'box'
    || type === 'cuboid'
    || type === 'wall'
    || type === 'floor'
    || type === 'flatRoof'
    || type === 'door'
    || type === 'window'
    || type === 'chimney'
    || type === 'cylinder'
    || type === 'cone'
    || type === 'pyramid'
    || type === 'column'
    || type === 'hemisphere'
  ) {
    return groupedAtlas(geometry);
  }

  return planarAtlas(geometry);
}

export function atlasIslandAtUv(atlas: SurfaceUvAtlas, uv: THREE.Vector2): number {
  const epsilon = 0.00001;
  const direct = atlas.islands.findIndex((island) =>
    uv.x >= island.uMin - epsilon
    && uv.x <= island.uMax + epsilon
    && uv.y >= island.vMin - epsilon
    && uv.y <= island.vMax + epsilon
  );
  if (direct >= 0) return direct;

  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  atlas.islands.forEach((island, index) => {
    const centerU = (island.uMin + island.uMax) / 2;
    const centerV = (island.vMin + island.vMax) / 2;
    const distance = (uv.x - centerU) ** 2 + (uv.y - centerV) ** 2;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

export function atlasIslandAtPixel(atlas: SurfaceUvAtlas, width: number, height: number, x: number, y: number): number {
  const uv = new THREE.Vector2(
    THREE.MathUtils.clamp((x + 0.5) / Math.max(1, width), 0, 1),
    THREE.MathUtils.clamp(1 - (y + 0.5) / Math.max(1, height), 0, 1)
  );
  return atlasIslandAtUv(atlas, uv);
}

export function atlasPixelRegion(atlas: SurfaceUvAtlas, islandIndex: number, width: number, height: number): AtlasPixelRegion {
  const island = atlas.islands[Math.max(0, Math.min(atlas.islands.length - 1, islandIndex))] ?? FULL_SURFACE_UV_ATLAS.islands[0];
  return {
    minX: Math.max(0, Math.min(width - 1, Math.floor(island.uMin * width))),
    maxX: Math.max(0, Math.min(width - 1, Math.ceil(island.uMax * width) - 1)),
    minY: Math.max(0, Math.min(height - 1, Math.floor((1 - island.vMax) * height))),
    maxY: Math.max(0, Math.min(height - 1, Math.ceil((1 - island.vMin) * height) - 1))
  };
}
