import * as THREE from 'three';
import type { PrimitiveType } from '../types/editor';

export const DEFAULT_EDGE_ROUNDNESS = 0;

const ROUNDING_SEGMENTS = 12;
const MAX_RADIUS_FACTOR = 0.499;

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

export function createRoundableBoxGeometry(
  width: number,
  height: number,
  depth: number,
  _geometry: Record<string, number>
): THREE.BufferGeometry {
  // Die Regler und ihre gespeicherten Werte bleiben erhalten. Ihre geometrische
  // Wirkung ist vorerst bewusst deaktiviert, bis eine stabile getrennte Ecken-
  // und Kantenabrundung umgesetzt wird.
  return new THREE.BoxGeometry(width, height, depth);
}
