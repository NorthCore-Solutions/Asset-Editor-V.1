import * as THREE from 'three';

const POSITION_PRECISION = 0.000001;
const DEFAULT_MAX_SUPPORT_POINTS = 65536;

function pointKey(point: THREE.Vector3): string {
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value / POSITION_PRECISION))
    .join(':');
}

/**
 * Reale Geometriepunkte für die physische Kontaktposition. Sie sind keine
 * Apfelschneider-Snap-Punkte und werden daher weder angezeigt noch als
 * Rasterlinien behandelt.
 */
export function buildGeometrySupportPoints(
  geometry: THREE.BufferGeometry,
  maxPoints: number = DEFAULT_MAX_SUPPORT_POINTS
): THREE.Vector3[] {
  const positions = geometry.getAttribute('position');
  if (!positions || positions.itemSize < 3 || positions.count === 0) return [];

  const unique = new Map<string, THREE.Vector3>();
  for (let index = 0; index < positions.count; index += 1) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, index);
    const key = pointKey(point);
    if (!unique.has(key)) unique.set(key, point);
  }

  const points = [...unique.values()];
  if (points.length <= maxPoints) return points;

  const reduced: THREE.Vector3[] = [];
  const stride = points.length / maxPoints;
  for (let index = 0; index < maxPoints; index += 1) {
    const point = points[Math.floor(index * stride)];
    if (point) reduced.push(point);
  }
  return reduced;
}

export function transformSurfaceSupportPoints(
  points: readonly THREE.Vector3[],
  matrixWorld: THREE.Matrix4
): THREE.Vector3[] {
  return points.map((point) => point.clone().applyMatrix4(matrixWorld));
}

/** Kleinste Projektion auf eine Zielnormale: die dem Ziel zugewandte Stützfläche. */
export function minimumSurfaceProjection(
  points: readonly THREE.Vector3[],
  normal: THREE.Vector3
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const point of points) minimum = Math.min(minimum, point.dot(normal));
  return minimum;
}
