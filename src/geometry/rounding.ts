import * as THREE from 'three';
import type { PrimitiveType } from '../types/editor';

export const DEFAULT_EDGE_ROUNDNESS = 0;

const ROUNDING_SEGMENTS = 8;
const MAX_RADIUS_FACTOR = 0.499;
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

interface RoundedTarget {
  position: THREE.Vector3;
  activeAxes: number;
  proximity: number;
}

function roundedTarget(
  source: THREE.Vector3,
  halfExtents: THREE.Vector3,
  radius: number
): RoundedTarget | null {
  if (radius <= EPSILON) return null;

  const absolute = new THREE.Vector3(Math.abs(source.x), Math.abs(source.y), Math.abs(source.z));
  const core = new THREE.Vector3(
    Math.max(0, halfExtents.x - radius),
    Math.max(0, halfExtents.y - radius),
    Math.max(0, halfExtents.z - radius)
  );
  const offset = new THREE.Vector3(
    Math.max(0, absolute.x - core.x),
    Math.max(0, absolute.y - core.y),
    Math.max(0, absolute.z - core.z)
  );
  const activeAxes = Number(offset.x > EPSILON)
    + Number(offset.y > EPSILON)
    + Number(offset.z > EPSILON);
  const offsetLength = offset.length();

  if (activeAxes < 2 || offsetLength <= EPSILON) return null;

  const activeFractions = [
    offset.x > EPSILON ? offset.x / radius : null,
    offset.y > EPSILON ? offset.y / radius : null,
    offset.z > EPSILON ? offset.z / radius : null
  ].filter((value): value is number => value !== null);
  const proximity = activeFractions.length > 0
    ? THREE.MathUtils.clamp(Math.min(...activeFractions), 0, 1)
    : 0;
  const direction = offset.clone().multiplyScalar(1 / offsetLength);
  const position = new THREE.Vector3(
    offset.x > EPSILON ? core.x + direction.x * radius : absolute.x,
    offset.y > EPSILON ? core.y + direction.y * radius : absolute.y,
    offset.z > EPSILON ? core.z + direction.z * radius : absolute.z
  );
  position.set(
    source.x < 0 ? -position.x : position.x,
    source.y < 0 ? -position.y : position.y,
    source.z < 0 ? -position.z : position.z
  );

  return { position, activeAxes, proximity };
}

function smoothRoundedNormals(
  geometry: THREE.BufferGeometry,
  roundedVertices: ReadonlySet<number>
): void {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const accumulated = new Map<string, THREE.Vector3>();

  for (const index of roundedVertices) {
    const key = `${position.getX(index).toFixed(6)}:${position.getY(index).toFixed(6)}:${position.getZ(index).toFixed(6)}`;
    const sum = accumulated.get(key) ?? new THREE.Vector3();
    sum.add(new THREE.Vector3(normal.getX(index), normal.getY(index), normal.getZ(index)));
    accumulated.set(key, sum);
  }

  for (const index of roundedVertices) {
    const key = `${position.getX(index).toFixed(6)}:${position.getY(index).toFixed(6)}:${position.getZ(index).toFixed(6)}`;
    const averaged = accumulated.get(key)?.normalize();
    if (averaged) normal.setXYZ(index, averaged.x, averaged.y, averaged.z);
  }

  normal.needsUpdate = true;
}

function applySeparatedRounding(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
  depth: number,
  edgeRadius: number,
  cornerRadius: number
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const halfExtents = new THREE.Vector3(
    Math.abs(width) / 2,
    Math.abs(height) / 2,
    Math.abs(depth) / 2
  );
  const roundedVertices = new Set<number>();

  for (let index = 0; index < position.count; index += 1) {
    const source = new THREE.Vector3(
      position.getX(index),
      position.getY(index),
      position.getZ(index)
    );
    const result = source.clone();

    const edge = roundedTarget(source, halfExtents, edgeRadius);
    if (edge && edge.activeAxes >= 2) {
      const cornerFade = edge.activeAxes === 3
        ? THREE.MathUtils.smoothstep(edge.proximity, 0, 1)
        : 0;
      const edgeWeight = 1 - cornerFade;
      if (edgeWeight > EPSILON) result.lerp(edge.position, edgeWeight);
    }

    const corner = roundedTarget(source, halfExtents, cornerRadius);
    if (corner?.activeAxes === 3) {
      const cornerWeight = THREE.MathUtils.smoothstep(corner.proximity, 0, 1);
      if (cornerWeight > EPSILON) result.lerp(corner.position, cornerWeight);
    }

    if (result.distanceToSquared(source) <= EPSILON * EPSILON) continue;
    position.setXYZ(index, result.x, result.y, result.z);
    roundedVertices.add(index);
  }

  position.needsUpdate = true;
  smoothRoundedNormals(geometry, roundedVertices);
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
  const cornerRadius = roundedBoxRadius(
    width,
    height,
    depth,
    cornerRoundnessValue(geometry)
  );
  const edgeRadius = roundedBoxRadius(
    width,
    height,
    depth,
    edgeRoundnessValue(geometry)
  );

  if (cornerRadius <= EPSILON && edgeRadius <= EPSILON) {
    return new THREE.BoxGeometry(width, height, depth);
  }

  const segmented = new THREE.BoxGeometry(
    width,
    height,
    depth,
    ROUNDING_SEGMENTS,
    ROUNDING_SEGMENTS,
    ROUNDING_SEGMENTS
  );

  return applySeparatedRounding(
    segmented,
    width,
    height,
    depth,
    edgeRadius,
    cornerRadius
  );
}
