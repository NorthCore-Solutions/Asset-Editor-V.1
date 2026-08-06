import * as THREE from 'three';

const EPSILON = 0.000001;
const DEFAULT_MAX_ANCHORS = 8192;

type AxisIndex = 0 | 1 | 2;

export interface SurfaceSnapAnchor {
  position: THREE.Vector3;
  normal: THREE.Vector3;
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

export function localSurfaceSnapStep(
  cellSize: number,
  objectScale: THREE.Vector3
): THREE.Vector3 {
  const safeCellSize = Math.max(0.05, Math.abs(cellSize));
  return new THREE.Vector3(
    safeCellSize / safeScale(objectScale.x),
    safeCellSize / safeScale(objectScale.y),
    safeCellSize / safeScale(objectScale.z)
  );
}

function gridCoordinates(minimum: number, maximum: number, step: number): number[] {
  if (!Number.isFinite(step) || step <= EPSILON || maximum < minimum) {
    return minimum === maximum ? [minimum] : [minimum, maximum];
  }

  const values: number[] = [minimum];
  const count = Math.min(4096, Math.floor((maximum - minimum) / step));
  for (let index = 1; index <= count; index += 1) {
    const value = minimum + index * step;
    if (value >= maximum - EPSILON) break;
    values.push(value);
  }
  const lastValue = values.at(-1) ?? minimum;
  if (maximum - lastValue > EPSILON) values.push(maximum);
  return values;
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

function deduplicateAnchors(
  anchors: SurfaceSnapAnchor[],
  localStep: THREE.Vector3,
  maxAnchors: number
): SurfaceSnapAnchor[] {
  const minimumStep = Math.min(localStep.x, localStep.y, localStep.z);
  const positionPrecision = Math.max(0.00001, minimumStep * 0.0001);
  const normalPrecision = 0.01;
  const unique = new Map<string, SurfaceSnapAnchor>();

  for (const anchor of anchors) {
    if (!finiteAnchor(anchor)) continue;
    const normalized = {
      position: anchor.position.clone(),
      normal: anchor.normal.clone().normalize()
    };
    const key = [
      Math.round(normalized.position.x / positionPrecision),
      Math.round(normalized.position.y / positionPrecision),
      Math.round(normalized.position.z / positionPrecision),
      Math.round(normalized.normal.x / normalPrecision),
      Math.round(normalized.normal.y / normalPrecision),
      Math.round(normalized.normal.z / normalPrecision)
    ].join(':');
    if (!unique.has(key)) unique.set(key, normalized);
  }

  const result = [...unique.values()];
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

export function buildGeometrySurfaceSnapAnchors(
  geometry: THREE.BufferGeometry,
  cellSize: number,
  objectScale: THREE.Vector3,
  maxAnchors: number = DEFAULT_MAX_ANCHORS
): SurfaceSnapAnchor[] {
  const positions = geometry.getAttribute('position');
  if (!positions || positions.itemSize < 3 || positions.count < 3) return [];

  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return [];

  const localStep = localSurfaceSnapStep(cellSize, objectScale);
  const grids: [number[], number[], number[]] = [
    gridCoordinates(bounds.min.x, bounds.max.x, localStep.x),
    gridCoordinates(bounds.min.y, bounds.max.y, localStep.y),
    gridCoordinates(bounds.min.z, bounds.max.z, localStep.z)
  ];
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

    for (let vertex = 0; vertex < 3; vertex += 1) {
      const position = trianglePositions[vertex];
      const normal = triangleNormals[vertex];
      if (!position || !normal) continue;
      anchors.push({
        position: position.clone(),
        normal: normal.clone()
      });
    }

    const centroid = trianglePositions[0].clone()
      .add(trianglePositions[1])
      .add(trianglePositions[2])
      .multiplyScalar(1 / 3);
    anchors.push({
      position: centroid,
      normal: triangleNormals[0].clone()
        .add(triangleNormals[1])
        .add(triangleNormals[2])
        .normalize()
    });

    for (const [firstAxis, secondAxis, solvedAxis] of AXIS_PAIRS) {
      const solvedNormal = component(faceNormal, solvedAxis);
      if (Math.abs(solvedNormal) <= EPSILON) continue;

      const firstMinimum = Math.min(...trianglePositions.map((point) => component(point, firstAxis)));
      const firstMaximum = Math.max(...trianglePositions.map((point) => component(point, firstAxis)));
      const secondMinimum = Math.min(...trianglePositions.map((point) => component(point, secondAxis)));
      const secondMaximum = Math.max(...trianglePositions.map((point) => component(point, secondAxis)));
      const firstValues = grids[firstAxis].filter((value) =>
        value >= firstMinimum - EPSILON && value <= firstMaximum + EPSILON
      );
      const secondValues = grids[secondAxis].filter((value) =>
        value >= secondMinimum - EPSILON && value <= secondMaximum + EPSILON
      );

      for (const firstValue of firstValues) {
        for (const secondValue of secondValues) {
          const point = new THREE.Vector3();
          setComponent(point, firstAxis, firstValue);
          setComponent(point, secondAxis, secondValue);
          const solvedValue = component(trianglePositions[0], solvedAxis) - (
            component(faceNormal, firstAxis)
              * (firstValue - component(trianglePositions[0], firstAxis))
            + component(faceNormal, secondAxis)
              * (secondValue - component(trianglePositions[0], secondAxis))
          ) / solvedNormal;
          setComponent(point, solvedAxis, solvedValue);

          const weights = barycentricCoordinates(
            point,
            trianglePositions[0],
            trianglePositions[1],
            trianglePositions[2]
          );
          if (!weights) continue;
          anchors.push({
            position: point,
            normal: interpolatedNormal(weights, triangleNormals, faceNormal)
          });
        }
      }
    }
  }

  return deduplicateAnchors(anchors, localStep, Math.max(64, maxAnchors));
}

export function transformSurfaceSnapAnchors(
  anchors: readonly SurfaceSnapAnchor[],
  matrixWorld: THREE.Matrix4
): SurfaceSnapAnchor[] {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  return anchors.map((anchor) => ({
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
