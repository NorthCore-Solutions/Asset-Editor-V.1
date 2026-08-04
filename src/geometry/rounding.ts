import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PrimitiveType } from '../types/editor';

export const DEFAULT_EDGE_ROUNDNESS = 0;

const ROUNDING_SEGMENTS = 8;
const MAX_RADIUS_FACTOR = 0.499;
const CORNER_DIAGONAL_COMPONENT = 1 / Math.sqrt(3);
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

function applyIndependentCornerAndEdgeRadii(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
  depth: number,
  sourceRadius: number,
  edgeRadius: number,
  cornerRadius: number
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const halfExtents = [Math.abs(width) / 2, Math.abs(height) / 2, Math.abs(depth) / 2] as const;
  const sourceCore = halfExtents.map((halfExtent) => Math.max(0, halfExtent - sourceRadius));

  for (let index = 0; index < position.count; index += 1) {
    const coordinates = [position.getX(index), position.getY(index), position.getZ(index)];
    const absoluteCoordinates = coordinates.map(Math.abs);
    const offsets = absoluteCoordinates.map((coordinate, axis) =>
      Math.max(0, coordinate - (sourceCore[axis] ?? 0))
    );
    const activeAxes = offsets.reduce((count, offset) => count + (offset > EPSILON ? 1 : 0), 0);

    // Eine aktive Achse gehört zu einer ebenen Fläche und bleibt vollständig unverändert.
    if (activeAxes < 2) continue;

    const normalizedOffsets = offsets.map((offset) =>
      THREE.MathUtils.clamp(offset / sourceRadius, 0, 1)
    );

    // Zwei aktive Achsen sind eine reine Kante. Erst bei drei aktiven Achsen
    // beginnt der Eckbereich. Am Übergang bleibt der Kantenradius erhalten;
    // ausschließlich im Zentrum der Ecke wirkt der Eckenradius vollständig.
    const cornerWeight = activeAxes === 3
      ? THREE.MathUtils.smoothstep(
          Math.min(
            normalizedOffsets[0] ?? 0,
            normalizedOffsets[1] ?? 0,
            normalizedOffsets[2] ?? 0
          ),
          0,
          CORNER_DIAGONAL_COMPONENT
        )
      : 0;
    const localRadius = THREE.MathUtils.lerp(edgeRadius, cornerRadius, cornerWeight);

    for (let axis = 0; axis < 3; axis += 1) {
      const halfExtent = halfExtents[axis] ?? 0;
      const coordinate = coordinates[axis] ?? 0;
      const offset = offsets[axis] ?? 0;
      let absolutePosition: number;

      if (offset > EPSILON) {
        // Profilrichtung des stabilen Ausgangsnetzes beibehalten und nur den
        // zuständigen Radius austauschen.
        absolutePosition = halfExtent
          - localRadius
          + (normalizedOffsets[axis] ?? 0) * localRadius;
      } else {
        // Die Längsachse einer Kante wird nur an den neuen Kern angepasst.
        // Dadurch bleiben Außenmaße und Übergänge geschlossen.
        const sourceHalfCore = sourceCore[axis] ?? 0;
        const targetHalfCore = Math.max(0, halfExtent - localRadius);
        const normalizedCorePosition = sourceHalfCore > EPSILON
          ? THREE.MathUtils.clamp(absoluteCoordinates[axis] / sourceHalfCore, 0, 1)
          : 0;
        absolutePosition = normalizedCorePosition * targetHalfCore;
      }

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
  const sourceRadius = Math.max(cornerRadius, edgeRadius);

  if (sourceRadius <= EPSILON) return new THREE.BoxGeometry(width, height, depth);

  const rounded = new RoundedBoxGeometry(
    width,
    height,
    depth,
    roundedBoxSegments(),
    sourceRadius
  );

  return applyIndependentCornerAndEdgeRadii(
    rounded,
    width,
    height,
    depth,
    sourceRadius,
    edgeRadius,
    cornerRadius
  );
}
