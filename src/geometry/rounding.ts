import * as THREE from 'three';
import type { PrimitiveType } from '../types/editor';

export const DEFAULT_EDGE_ROUNDNESS = 0;

const ROUNDING_SEGMENTS = 12;
const MAX_RADIUS_FACTOR = 0.499;
const EPSILON = 0.000001;
const AXES = [0, 1, 2] as const;

type Axis = typeof AXES[number];

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

function component(vector: THREE.Vector3, axis: Axis): number {
  if (axis === 0) return vector.x;
  if (axis === 1) return vector.y;
  return vector.z;
}

function setComponent(vector: THREE.Vector3, axis: Axis, value: number): void {
  if (axis === 0) vector.x = value;
  else if (axis === 1) vector.y = value;
  else vector.z = value;
}

function signed(source: number, absoluteValue: number): number {
  return source < 0 ? -absoluteValue : absoluteValue;
}

function boundaryDistances(source: THREE.Vector3, halfExtents: THREE.Vector3): [number, number, number] {
  return [
    Math.max(0, halfExtents.x - Math.abs(source.x)),
    Math.max(0, halfExtents.y - Math.abs(source.y)),
    Math.max(0, halfExtents.z - Math.abs(source.z))
  ];
}

function nearestEdgeTarget(
  source: THREE.Vector3,
  halfExtents: THREE.Vector3,
  radius: number
): { target: THREE.Vector3; weight: number } | null {
  if (radius <= EPSILON) return null;

  const distances = boundaryDistances(source, halfExtents);
  const orderedAxes = [...AXES].sort((first, second) => distances[first] - distances[second]);
  const firstAxis = orderedAxes[0];
  const secondAxis = orderedAxes[1];
  const longitudinalAxis = orderedAxes[2];
  if (firstAxis === undefined || secondAxis === undefined || longitudinalAxis === undefined) return null;
  if (distances[firstAxis] >= radius || distances[secondAxis] >= radius) return null;

  const firstHalfExtent = component(halfExtents, firstAxis);
  const secondHalfExtent = component(halfExtents, secondAxis);
  const firstAbsolute = Math.abs(component(source, firstAxis));
  const secondAbsolute = Math.abs(component(source, secondAxis));
  const firstOffset = Math.max(0, firstAbsolute - (firstHalfExtent - radius));
  const secondOffset = Math.max(0, secondAbsolute - (secondHalfExtent - radius));
  const offsetLength = Math.hypot(firstOffset, secondOffset);
  if (offsetLength <= EPSILON) return null;

  const transitionWidth = Math.min(
    radius,
    Math.max(EPSILON, component(halfExtents, longitudinalAxis))
  );
  const longitudinalDistance = distances[longitudinalAxis];
  const weight = THREE.MathUtils.smoothstep(longitudinalDistance, 0, transitionWidth);
  if (weight <= EPSILON) return null;

  const target = source.clone();
  setComponent(
    target,
    firstAxis,
    signed(
      component(source, firstAxis),
      firstHalfExtent - radius + firstOffset / offsetLength * radius
    )
  );
  setComponent(
    target,
    secondAxis,
    signed(
      component(source, secondAxis),
      secondHalfExtent - radius + secondOffset / offsetLength * radius
    )
  );

  return { target, weight };
}

function cornerTarget(
  source: THREE.Vector3,
  halfExtents: THREE.Vector3,
  radius: number
): { target: THREE.Vector3; weight: number } | null {
  if (radius <= EPSILON) return null;

  const distances = boundaryDistances(source, halfExtents);
  const maximumDistance = Math.max(distances[0], distances[1], distances[2]);
  if (maximumDistance >= radius) return null;

  const core = new THREE.Vector3(
    Math.max(0, halfExtents.x - radius),
    Math.max(0, halfExtents.y - radius),
    Math.max(0, halfExtents.z - radius)
  );
  const absolute = new THREE.Vector3(Math.abs(source.x), Math.abs(source.y), Math.abs(source.z));
  const offset = new THREE.Vector3(
    Math.max(0, absolute.x - core.x),
    Math.max(0, absolute.y - core.y),
    Math.max(0, absolute.z - core.z)
  );
  const offsetLength = offset.length();
  if (offsetLength <= EPSILON) return null;

  const direction = offset.multiplyScalar(1 / offsetLength);
  const target = new THREE.Vector3(
    signed(source.x, core.x + direction.x * radius),
    signed(source.y, core.y + direction.y * radius),
    signed(source.z, core.z + direction.z * radius)
  );
  const weight = 1 - THREE.MathUtils.smoothstep(maximumDistance, 0, radius);
  if (weight <= EPSILON) return null;

  return { target, weight };
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

    const edge = nearestEdgeTarget(source, halfExtents, edgeRadius);
    if (edge) result.lerp(edge.target, edge.weight);

    const corner = cornerTarget(source, halfExtents, cornerRadius);
    if (corner) result.lerp(corner.target, corner.weight);

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
