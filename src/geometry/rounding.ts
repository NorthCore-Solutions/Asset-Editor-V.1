import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PrimitiveType } from '../types/editor';

export const DEFAULT_EDGE_ROUNDNESS = 50;

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

export function roundedBoxSegments(edgeRoundness: number): number {
  return Math.round(1 + clampedPercent(edgeRoundness, DEFAULT_EDGE_ROUNDNESS) * 0.07);
}

export function roundedBoxRadius(
  width: number,
  height: number,
  depth: number,
  cornerRoundness: number
): number {
  const shortestSide = Math.max(0.0001, Math.min(Math.abs(width), Math.abs(height), Math.abs(depth)));
  return shortestSide * 0.499 * clampedPercent(cornerRoundness, 0) / 100;
}

export function createRoundableBoxGeometry(
  width: number,
  height: number,
  depth: number,
  geometry: Record<string, number>
): THREE.BufferGeometry {
  const cornerRoundness = cornerRoundnessValue(geometry);
  if (cornerRoundness <= 0) return new THREE.BoxGeometry(width, height, depth);

  return new RoundedBoxGeometry(
    width,
    height,
    depth,
    roundedBoxSegments(edgeRoundnessValue(geometry)),
    roundedBoxRadius(width, height, depth, cornerRoundness)
  );
}
