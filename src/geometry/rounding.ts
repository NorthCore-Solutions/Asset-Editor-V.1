import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PrimitiveType } from '../types/editor';

export const DEFAULT_EDGE_ROUNDNESS = 0;

const ROUNDING_SEGMENTS = 8;
const MAX_RADIUS_FACTOR = 0.499;
const CORNER_BLEND_LIMIT = 1 / Math.sqrt(3);
const EPSILON = 0.000001;

const ROUNDABLE_BOX_TYPES = new Set<PrimitiveType>([
  'box',
  'cuboid',
  'wall',
  'floor',
  'flatRoof',
  'door',
  'window',
  'chimney'
]);

const clampedPercent = (value: number | undefined, fallback: number): number =>
  THREE.MathUtils.clamp(Number.isFinite(value) ? Number(value) : fallback, 0, 100);

export function supportsGeometryRounding(type: PrimitiveType): boolean {
  return ROUNDABLE_BOX_TYPES.has(type);
}

export function cornerRoundnessValue(geometry: Record<string, number>): number {
  return clampedPercent(geometry.cornerRoundness, 0);
}

export function edgeRoundnessValue(geometry: Record<string, number>): number {
  return clampedPercent(geometry.edgeRoundness, DEFAULT_EDGE_ROUNDNESS);
}

export function roundedBoxSegments(_roundness?: number): number {
  return ROUNDING_SEGMENTS;
}

export function roundedBoxRadius(
  width: number,
  height: number,
  depth: number,
  roundness: number
): number {
  const shortestSide = Math.max(0.0001, Math.min(Math.abs(width), Math.abs(height), Math.abs(depth)));
  return shortestSide * MAX_RADIUS_FACTOR * clampedPercent(roundness, 0) / 100;
}

function signed(value: number, absoluteValue: number): number {
  return value < 0 ? -absoluteValue : absoluteValue;
}

function applyConvexRoundingProfile(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
  depth: number,
  radius: number,
  edgeRoundness: number,
  cornerRoundness: number
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const halfExtents = [Math.abs(width) / 2, Math.abs(height) / 2, Math.abs(depth) / 2] as const;
  const core = halfExtents.map((halfExtent) => Math.max(0, halfExtent - radius));
  const edgeBlend = clampedPercent(edgeRoundness, 0) / 100;
  const cornerBlend = clampedPercent(cornerRoundness, 0) / 100;

  for (let index = 0; index < position.count; index += 1) {
    const coordinates = [position.getX(index), position.getY(index), position.getZ(index)];
    const offsets = coordinates.map((coordinate, axis) =>
      Math.max(0, Math.abs(coordinate) - (core[axis] ?? 0))
    );
    const activeAxes = offsets.reduce((count, offset) => count + (offset > EPSILON ? 1 : 0), 0);

    // Flächenmitten bleiben vollständig eben. Nur Kanten und Ecken werden verändert.
    if (activeAxes < 2) continue;

    const lengthL1 = offsets.reduce((sum, offset) => sum + offset, 0);
    const lengthL2 = Math.hypot(offsets[0] ?? 0, offsets[1] ?? 0, offsets[2] ?? 0);
    if (lengthL1 <= EPSILON || lengthL2 <= EPSILON) continue;

    const linearProfile = offsets.map((offset) => offset / lengthL1);
    const circularProfile = offsets.map((offset) => offset / lengthL2);
    const fractions = offsets
      .filter((offset) => offset > EPSILON)
      .map((offset) => THREE.MathUtils.clamp(offset / radius, 0, 1));

    const transitionToCorner = activeAxes === 3
      ? THREE.MathUtils.smoothstep(Math.min(...fractions), 0, CORNER_BLEND_LIMIT)
      : 0;
    const profileBlend = activeAxes === 3
      ? THREE.MathUtils.lerp(edgeBlend, cornerBlend, transitionToCorner)
      : edgeBlend;

    for (let axis = 0; axis < 3; axis += 1) {
      const offset = offsets[axis] ?? 0;
      if (offset <= EPSILON) continue;

      const profile = THREE.MathUtils.lerp(
        linearProfile[axis] ?? 0,
        circularProfile[axis] ?? 0,
        profileBlend
      );
      const absolutePosition = (core[axis] ?? 0) + profile * radius;
      const coordinate = coordinates[axis] ?? 0;

      if (axis === 0) position.setX(index, signed(coordinate, absolutePosition));
      else if (axis === 1) position.setY(index, signed(coordinate, absolutePosition));
      else position.setZ(index, signed(coordinate, absolutePosition));
    }
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createRoundableBoxGeometry(
  width: number,
  height: number,
  depth: number,
  geometry: Record<string, number>
): THREE.BufferGeometry {
  const cornerRoundness = cornerRoundnessValue(geometry);
  const edgeRoundness = edgeRoundnessValue(geometry);
  const radius = roundedBoxRadius(
    width,
    height,
    depth,
    Math.max(cornerRoundness, edgeRoundness)
  );

  if (radius <= EPSILON) return new THREE.BoxGeometry(width, height, depth);

  const rounded = new RoundedBoxGeometry(
    width,
    height,
    depth,
    roundedBoxSegments(),
    radius
  );

  return applyConvexRoundingProfile(
    rounded,
    width,
    height,
    depth,
    radius,
    edgeRoundness,
    cornerRoundness
  );
}
