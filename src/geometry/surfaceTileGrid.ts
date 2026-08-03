import * as THREE from 'three';
import {
  atlasIslandAtUv,
  getSurfaceUvAtlas,
  type SurfaceUvAtlas
} from './uvAtlas';

export interface SurfaceTileRepeat {
  u: number;
  v: number;
}

interface RepeatAccumulator {
  weightedU: number;
  weightedV: number;
  weight: number;
}

const EPSILON = 0.000001;
const MIN_REPEAT = 0.02;
const MAX_REPEAT = 1_000;

function vertexIndex(geometry: THREE.BufferGeometry, triangleOffset: number): number {
  return geometry.index?.getX(triangleOffset) ?? triangleOffset;
}

function vectorAt(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number
): THREE.Vector3 {
  return new THREE.Vector3(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
}

function uvAt(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number
): THREE.Vector2 {
  return new THREE.Vector2(attribute.getX(index), attribute.getY(index));
}

function localIslandUv(atlas: SurfaceUvAtlas, islandIndex: number, uv: THREE.Vector2): THREE.Vector2 | null {
  const island = atlas.islands[islandIndex];
  if (!island) return null;

  const width = island.uMax - island.uMin;
  const height = island.vMax - island.vMin;
  if (width <= EPSILON || height <= EPSILON) return null;

  return new THREE.Vector2(
    (uv.x - island.uMin) / width,
    (uv.y - island.vMin) / height
  );
}

function scaledLength(vector: THREE.Vector3, scale: THREE.Vector3): number {
  return new THREE.Vector3(
    vector.x * scale.x,
    vector.y * scale.y,
    vector.z * scale.z
  ).length();
}

function repeatRatio(vector: THREE.Vector3, scale: THREE.Vector3): number | null {
  const baseLength = vector.length();
  if (baseLength <= EPSILON) return null;
  return scaledLength(vector, scale) / baseLength;
}

export function getSurfaceTileRepeats(
  geometry: THREE.BufferGeometry,
  scaleValue: readonly [number, number, number]
): SurfaceTileRepeat[] {
  const atlas = getSurfaceUvAtlas(geometry);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const scale = new THREE.Vector3(
    Math.abs(scaleValue[0]),
    Math.abs(scaleValue[1]),
    Math.abs(scaleValue[2])
  );
  const fallback = THREE.MathUtils.clamp(
    (scale.x + scale.y + scale.z) / 3,
    MIN_REPEAT,
    MAX_REPEAT
  );

  if (!position || !uv || position.count < 3 || uv.count < 3) {
    return atlas.islands.map(() => ({ u: fallback, v: fallback }));
  }

  const triangleValueCount = geometry.index?.count ?? position.count;
  const accumulators: RepeatAccumulator[] = atlas.islands.map(() => ({
    weightedU: 0,
    weightedV: 0,
    weight: 0
  }));

  for (let offset = 0; offset + 2 < triangleValueCount; offset += 3) {
    const indexA = vertexIndex(geometry, offset);
    const indexB = vertexIndex(geometry, offset + 1);
    const indexC = vertexIndex(geometry, offset + 2);
    const pointA = vectorAt(position, indexA);
    const pointB = vectorAt(position, indexB);
    const pointC = vectorAt(position, indexC);
    const uvA = uvAt(uv, indexA);
    const uvB = uvAt(uv, indexB);
    const uvC = uvAt(uv, indexC);
    const centroidUv = uvA.clone().add(uvB).add(uvC).multiplyScalar(1 / 3);
    const islandIndex = atlasIslandAtUv(atlas, centroidUv);
    const accumulator = accumulators[islandIndex];
    if (!accumulator) continue;

    const localA = localIslandUv(atlas, islandIndex, uvA);
    const localB = localIslandUv(atlas, islandIndex, uvB);
    const localC = localIslandUv(atlas, islandIndex, uvC);
    if (!localA || !localB || !localC) continue;

    const edgeOne = pointB.clone().sub(pointA);
    const edgeTwo = pointC.clone().sub(pointA);
    const uvOne = localB.clone().sub(localA);
    const uvTwo = localC.clone().sub(localA);
    const determinant = uvOne.x * uvTwo.y - uvOne.y * uvTwo.x;
    if (Math.abs(determinant) <= EPSILON) continue;

    const inverse = 1 / determinant;
    const tangentU = edgeOne.clone().multiplyScalar(uvTwo.y)
      .sub(edgeTwo.clone().multiplyScalar(uvOne.y))
      .multiplyScalar(inverse);
    const tangentV = edgeTwo.clone().multiplyScalar(uvOne.x)
      .sub(edgeOne.clone().multiplyScalar(uvTwo.x))
      .multiplyScalar(inverse);
    const repeatU = repeatRatio(tangentU, scale);
    const repeatV = repeatRatio(tangentV, scale);
    if (repeatU === null || repeatV === null) continue;

    const areaWeight = Math.max(EPSILON, edgeOne.clone().cross(edgeTwo).length() * 0.5);
    accumulator.weightedU += repeatU * areaWeight;
    accumulator.weightedV += repeatV * areaWeight;
    accumulator.weight += areaWeight;
  }

  return accumulators.map((accumulator) => {
    if (accumulator.weight <= EPSILON) return { u: fallback, v: fallback };
    return {
      u: THREE.MathUtils.clamp(accumulator.weightedU / accumulator.weight, MIN_REPEAT, MAX_REPEAT),
      v: THREE.MathUtils.clamp(accumulator.weightedV / accumulator.weight, MIN_REPEAT, MAX_REPEAT)
    };
  });
}

export function repeatUvInsideIsland(
  atlas: SurfaceUvAtlas,
  islandIndex: number,
  uv: THREE.Vector2,
  repeat: SurfaceTileRepeat
): THREE.Vector2 {
  const island = atlas.islands[islandIndex];
  if (!island) return uv.clone();

  const width = Math.max(EPSILON, island.uMax - island.uMin);
  const height = Math.max(EPSILON, island.vMax - island.vMin);
  const localU = THREE.MathUtils.clamp((uv.x - island.uMin) / width, 0, 0.999999);
  const localV = THREE.MathUtils.clamp((uv.y - island.vMin) / height, 0, 0.999999);
  const repeatedU = localU * repeat.u - Math.floor(localU * repeat.u);
  const repeatedV = localV * repeat.v - Math.floor(localV * repeat.v);

  return new THREE.Vector2(
    island.uMin + repeatedU * width,
    island.vMin + repeatedV * height
  );
}
