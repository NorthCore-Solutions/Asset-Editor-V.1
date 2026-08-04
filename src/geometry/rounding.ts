import * as THREE from 'three';
import type { PrimitiveType } from '../types/editor';

export const DEFAULT_EDGE_ROUNDNESS = 0;

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

const clampPercent = (value: number | undefined, fallback: number): number =>
  Math.min(100, Math.max(0, Number.isFinite(value) ? Number(value) : fallback));

export const supportsGeometryRounding = (type: PrimitiveType): boolean =>
  ROUNDABLE_BOX_TYPES.has(type);

export const cornerRoundnessValue = (geometry: Record<string, number>): number =>
  clampPercent(geometry.cornerRoundness, 0);

export const edgeRoundnessValue = (geometry: Record<string, number>): number =>
  clampPercent(geometry.edgeRoundness, DEFAULT_EDGE_ROUNDNESS);

export function createRoundableBoxGeometry(
  width: number,
  height: number,
  depth: number,
  _geometry: Record<string, number>
): THREE.BufferGeometry {
  // Reglerwerte bleiben kompatibel gespeichert, verändern die Geometrie aber bewusst nicht.
  return new THREE.BoxGeometry(width, height, depth);
}
