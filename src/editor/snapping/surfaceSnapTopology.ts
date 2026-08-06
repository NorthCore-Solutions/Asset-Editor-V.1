import * as THREE from 'three';
import {
  APPLE_CUTTER_CELL_SIZE,
  buildCenteredAppleCutterAxis
} from '../appleCutter/appleCutterAxisGrid';
import type { AppleCutterScope } from '../appleCutter/appleCutterTypes';

const EPSILON = 0.000001;
const DEFAULT_MAX_ANCHORS = 32768;

type AxisIndex = 0 | 1 | 2;

export interface SurfaceSnapAnchor {
  id?: string;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  cutterCoordinates?: [number | null, number | null, number | null];
  componentId?: string;
  scope?: AppleCutterScope;
}

const AXIS_PAIRS: ReadonlyArray<readonly [AxisIndex, AxisIndex, AxisIndex]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 2, 0]
];

function component(vector: THREE.Vector3, axis: AxisIndex): number {
  if (axis === 0) return vector.x;
  if (axis === 1) return vector.y;
  return vector.z;
}

function setComponent(vector: THREE.Vector3, axis: AxisIndex, value: number): void {
  if (axis === 0) vector.x = value;
  else if (axis === 1) vector.y = value;
  else vector.z = value;
}

function safeScale(value: number): number {
  return Math.max(0.0001, Math.abs(value));
}

/**
 * Kompatibilitätswert für bestehende Aufrufstellen. Das Apfelschneider-Modell
 * verwendet unabhängig vom Bewegungsraster immer höchstens 0,25 Welt-Einheiten
 * zwischen zwei inneren Schnitten.
 */
export function localSurfaceSnapStep(
  _cellSize: number,
  objectScale: THREE.Vector3
): THREE.Vector3 {
  return new THREE.Vector3(
    APPLE_CUTTER_CELL_SIZE / safeScale(objectScale.x),
    APPLE_CUTTER_CELL_SIZE / safeScale(objectScale.y),
    APPLE_CUTTER_CELL_SIZE / safeScale(objectScale.z)
  );
}

function barycentricCoordinates(
  point: THREE.Vector3,
  first: THREE.Vector3,
  second: THREE.Vector3,
  third: THREE.Vector3
): THREE.Vector3 | null {
  const edge0 = second.clone().sub(first);
  const edge1 = third.clone().sub(first);
  const relative = point.clone().sub(first);
  const dot00 = edge0.dot(edge0);
  const dot01 = edge0.dot(edge1);
  const dot11 = edge1.dot(edge1);
  const dot20 = relative.dot(edge0);
  const dot21 = relative.dot(edge1);
  const denominator = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denominator) <= EPSILON) return null;

  const secondWeight = (dot11 * dot20 - dot01 * dot21) / denominator;
  const thirdWeight = (dot00 * dot21 - dot01 * dot20) / denominator;
  const firstWeight = 1 - secondWeight - thirdWeight;
  if (
    firstWeight < -EPSILON
    || secondWeight < -EPSILON
    || thirdWeight < -EPSILON
    || firstWeight > 1 + EPSILON
    || secondWeight > 1 + EPSILON
    || thirdWeight > 1 + EPSILON
  ) return null;

  return new THREE.Vector3(firstWeight, secondWeight, thirdWeight);
}

function interpolatedNormal(
  weights: THREE.Vector3,
  normals: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  fallback: THREE.Vector3
): THREE.Vector3 {
  const normal = normals[0].clone().multiplyScalar(weights.x)
    .addScaledVector(normals[1], weights.y)
    .addScaledVector(normals[2], weights.z);
  if (normal.lengthSq() <= EPSILON * EPSILON) return fallback.clone();
  return normal.normalize();
}

function finiteAnchor(anchor: SurfaceSnapAnchor): boolean {
  return [
    anchor.position.x,
    anchor.position.y,
    anchor.position.z,
    anchor.normal.x,
    anchor.normal.y,
    anchor.normal.z
  ].every(Number.isFinite) && anchor.normal.lengthSq() > EPSILON * EPSILON;
}

function quantizedAnchorKey(anchor: SurfaceSnapAnchor, precision: number): string {
  const normalPrecision = 0.005;
  return [
    Math.round(anchor.position.x / precision),
    Math.round(anchor.position.y / precision),
    Math.round(anchor.position.z / precision),
    Math.round(anchor.normal.x / normalPrecision),
    Math.round(anchor.normal.y / normalPrecision),
    Math.round(anchor.normal.z / normalPrecision)
  ].join(':');
}

function deduplicateAnchors(
  anchors: SurfaceSnapAnchor[],
  localStep: THREE.Vector3,
  maxAnchors: number,
  componentId: string,
  scope: AppleCutterScope
): SurfaceSnapAnchor[] {
  const minimumStep = Math.min(localStep.x, localStep.y, localStep.z);
  const positionPrecision = Math.max(0.00001, minimumStep * 0.0001);
  const unique = new Map<string, SurfaceSnapAnchor>();

  for (const anchor of anchors) {
    if (!finiteAnchor(anchor)) continue;
    const normalized: SurfaceSnapAnchor = {
      ...anchor,
      position: anchor.position.clone(),
      normal: anchor.normal.clone().normalize(),
      componentId,
      scope
    };
    const key = quantizedAnchorKey(normalized, positionPrecision);
    if (!unique.has(key)) unique.set(key, normalized);
  }

  const result = [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, anchor]) => ({
      ...anchor,
      id: `${scope}:${componentId}:${key}`
    }));
  if (result.length <= maxAnchors) return result;

  const reduced: SurfaceSnapAnchor[] = [];
  const stride = result.length / maxAnchors;
  for (let index = 0; index < maxAnchors; index += 1) {
    const anchor = result[Math.floor(index * stride)];
    if (anchor) reduced.push(anchor);
  }
  return reduced;
}

function triangleVertexIndex(
  geometryIndex: THREE.BufferAttribute | null,
  triangleVertex: number
): number {
  return geometryIndex ? geometryIndex.getX(triangleVertex) : triangleVertex;
}

interface BuildGeometrySurfaceSnapOptions {
  componentId?: string;
  scope?: AppleCutterScope;
  maxAnchors?: number;
}

/**
 * Erzeugt ausschließlich Schnittpunkte des zentrierten Apfelschneider-Gitters
 * mit der tatsächlichen Dreiecksoberfläche. Mesh-Eckpunkte und
 * Dreiecksmittelpunkte werden nicht zusätzlich als unregelmäßige Snap-Punkte
 * aufgenommen.
 */
export function buildGeometrySurfaceSnapAnchors(
  geometry: THREE.BufferGeometry,
  _cellSize: number,
  objectScale: THREE.Vector3,
  maxAnchorsOrOptions: number | BuildGeometrySurfaceSnapOptions = DEFAULT_MAX_ANCHORS
): SurfaceSnapAnchor[] {
  const options: BuildGeometrySurfaceSnapOptions = typeof maxAnchorsOrOptions === 'number'
    ? { maxAnchors: maxAnchorsOrOptions }
    : maxAnchorsOrOptions;
  const componentId = options.componentId ?? 'component';
  const scope = options.scope ?? 'component';
  const maxAnchors = options.maxAnchors ?? DEFAULT_MAX_ANCHORS;
  const positions = geometry.getAttribute('position');
  if (!positions || positions.itemSize < 3 || positions.count < 3) return [];

  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return [];

  const axisGrids = [
    buildCenteredAppleCutterAxis('x', bounds.min.x, bounds.max.x, objectScale.x),
    buildCenteredAppleCutterAxis('y', bounds.min.y, bounds.max.y, objectScale.y),
    buildCenteredAppleCutterAxis('z', bounds.min.z, bounds.max.z, objectScale.z)
  ] as const;
  // Die Mittelpunktachsen sind Referenzlinien für die Oberflächenabtastung,
  // aber keine zusätzlichen Schnitte und verändern daher keine Kachelgröße.
  // Sie sichern insbesondere bei kleinen und runden Körpern die exakten
  // symmetrischen Außenpunkte entlang X, Y und Z.
  const samplingCoordinates = (axisGrid: (typeof axisGrids)[number]): number[] => (
    [...new Set([...axisGrid.coordinates, axisGrid.center])]
      .sort((left, right) => left - right)
  );
  const grids: [number[], number[], number[]] = [
    samplingCoordinates(axisGrids[0]),
    samplingCoordinates(axisGrids[1]),
    samplingCoordinates(axisGrids[2])
  ];
  const localStep = localSurfaceSnapStep(APPLE_CUTTER_CELL_SIZE, objectScale);
  const index = geometry.getIndex();
  const triangleCount = Math.floor((index ? index.count : positions.count) / 3);
  const anchors: SurfaceSnapAnchor[] = [];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const vertexIndices: [number, number, number] = [
      triangleVertexIndex(index, triangle * 3),
      triangleVertexIndex(index, triangle * 3 + 1),
      triangleVertexIndex(index, triangle * 3 + 2)
    ];
    const trianglePositions: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
      new THREE.Vector3().fromBufferAttribute(positions, vertexIndices[0]),
      new THREE.Vector3().fromBufferAttribute(positions, vertexIndices[1]),
      new THREE.Vector3().fromBufferAttribute(positions, vertexIndices[2])
    ];
    const faceNormal = trianglePositions[1].clone().sub(trianglePositions[0])
      .cross(trianglePositions[2].clone().sub(trianglePositions[0]));
    if (faceNormal.lengthSq() <= EPSILON * EPSILON) continue;
    faceNormal.normalize();

    const normalForVertex = (vertexIndex: number): THREE.Vector3 => {
      if (!normals || normals.itemSize < 3 || vertexIndex >= normals.count) return faceNormal.clone();
      const normal = new THREE.Vector3().fromBufferAttribute(normals, vertexIndex);
      return normal.lengthSq() > EPSILON * EPSILON ? normal.normalize() : faceNormal.clone();
    };
    const triangleNormals: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
      normalForVertex(vertexIndices[0]),
      normalForVertex(vertexIndices[1]),
      normalForVertex(vertexIndices[2])
    ];

    for (const [firstAxis, secondAxis, solvedAxis] of AXIS_PAIRS) {
      const solvedNormal = component(faceNormal, solvedAxis);
      if (Math.abs(solvedNormal) <= EPSILON) continue;

      const firstMinimum = Math.min(...trianglePositions.map((point) => component(point, firstAxis)));
      const firstMaximum = Math.max(...trianglePositions.map((point) => component(point, firstAxis)));
      const secondMinimum = Math.min(...trianglePositions.map((point) => component(point, secondAxis)));
      const secondMaximum = Math.max(...trianglePositions.map((point) => component(point, secondAxis)));
      const firstValues = grids[firstAxis]
        .map((value, gridIndex) => ({ value, gridIndex }))
        .filter(({ value }) => value >= firstMinimum - EPSILON && value <= firstMaximum + EPSILON);
      const secondValues = grids[secondAxis]
        .map((value, gridIndex) => ({ value, gridIndex }))
        .filter(({ value }) => value >= secondMinimum - EPSILON && value <= secondMaximum + EPSILON);

      for (const firstEntry of firstValues) {
        for (const secondEntry of secondValues) {
          const point = new THREE.Vector3();
          setComponent(point, firstAxis, firstEntry.value);
          setComponent(point, secondAxis, secondEntry.value);
          const solvedValue = component(trianglePositions[0], solvedAxis) - (
            component(faceNormal, firstAxis)
              * (firstEntry.value - component(trianglePositions[0], firstAxis))
            + component(faceNormal, secondAxis)
              * (secondEntry.value - component(trianglePositions[0], secondAxis))
          ) / solvedNormal;
          setComponent(point, solvedAxis, solvedValue);

          const weights = barycentricCoordinates(
            point,
            trianglePositions[0],
            trianglePositions[1],
            trianglePositions[2]
          );
          if (!weights) continue;
          const coordinates: [number | null, number | null, number | null] = [null, null, null];
          coordinates[firstAxis] = firstEntry.gridIndex;
          coordinates[secondAxis] = secondEntry.gridIndex;
          anchors.push({
            position: point,
            normal: interpolatedNormal(weights, triangleNormals, faceNormal),
            cutterCoordinates: coordinates,
            componentId,
            scope
          });
        }
      }
    }
  }

  return deduplicateAnchors(
    anchors,
    localStep,
    Math.max(64, maxAnchors),
    componentId,
    scope
  );
}

export function transformSurfaceSnapAnchors(
  anchors: readonly SurfaceSnapAnchor[],
  matrixWorld: THREE.Matrix4
): SurfaceSnapAnchor[] {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  return anchors.map((anchor) => ({
    ...anchor,
    position: anchor.position.clone().applyMatrix4(matrixWorld),
    normal: anchor.normal.clone().applyMatrix3(normalMatrix).normalize()
  })).filter(finiteAnchor);
}

export function createSurfaceSnapPointsGeometry(
  anchors: readonly SurfaceSnapAnchor[],
  normalOffset: number = 0.004
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const anchor of anchors) {
    const point = anchor.position.clone().addScaledVector(anchor.normal, normalOffset);
    positions.push(point.x, point.y, point.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
