import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  buildGeometrySurfaceSnapAnchors,
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from './surfaceSnapTopology';

const EPSILON = 0.000001;
const TOPOLOGY_CACHE_LIMIT = 256;
const topologyCache = new Map<string, {
  localBounds: THREE.Box3;
  anchors: SurfaceSnapAnchor[];
}>();

export interface ObjectSurfaceSnapResult {
  position: Vec3;
  targetId: string | null;
  distance: number;
}

export interface SurfaceSnapTarget {
  id: string;
  visible: boolean;
  localBounds: THREE.Box3;
  matrixWorld: THREE.Matrix4;
  anchors: SurfaceSnapAnchor[];
}

function finiteBounds(bounds: THREE.Box3): boolean {
  return [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z
  ].every(Number.isFinite) && !bounds.isEmpty();
}

function matrixForSceneObject(object: SceneObjectData): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
}

function geometryCacheKey(object: SceneObjectData, cellSize: number): string {
  return JSON.stringify({
    type: object.type,
    geometry: object.geometry,
    scale: object.scale.map((value) => Number(Math.abs(value).toFixed(6))),
    cellSize: Number(Math.abs(cellSize).toFixed(6))
  });
}

function cachedSceneTopology(
  object: SceneObjectData,
  cellSize: number
): { localBounds: THREE.Box3; anchors: SurfaceSnapAnchor[] } | null {
  const key = geometryCacheKey(object, cellSize);
  const cached = topologyCache.get(key);
  if (cached) {
    topologyCache.delete(key);
    topologyCache.set(key, cached);
    return {
      localBounds: cached.localBounds.clone(),
      anchors: cached.anchors
    };
  }

  const geometry = createGeometry(object);
  try {
    geometry.computeBoundingBox();
    const localBounds = geometry.boundingBox?.clone();
    if (!localBounds || !finiteBounds(localBounds)) return null;
    const anchors = buildGeometrySurfaceSnapAnchors(
      geometry,
      cellSize,
      new THREE.Vector3(...object.scale)
    );
    if (anchors.length === 0) return null;

    const topology = { localBounds, anchors };
    topologyCache.set(key, topology);
    if (topologyCache.size > TOPOLOGY_CACHE_LIMIT) {
      const oldestKey = topologyCache.keys().next().value as string | undefined;
      if (oldestKey) topologyCache.delete(oldestKey);
    }
    return {
      localBounds: localBounds.clone(),
      anchors
    };
  } finally {
    geometry.dispose();
  }
}

export function surfaceSnapTargetFromSceneObject(
  object: SceneObjectData,
  cellSize: number = 0.25
): SurfaceSnapTarget | null {
  const topology = cachedSceneTopology(object, cellSize);
  if (!topology) return null;
  return {
    id: object.id,
    visible: object.visible,
    localBounds: topology.localBounds,
    matrixWorld: matrixForSceneObject(object),
    anchors: topology.anchors
  };
}

function matrixScale(matrix: THREE.Matrix4): THREE.Vector3 {
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale;
}

export function surfaceSnapTargetFromObject3D(
  root: THREE.Object3D,
  id: string = root.uuid,
  cellSize: number = 0.25
): SurfaceSnapTarget | null {
  root.updateWorldMatrix(true, true);
  const inverseRootMatrix = root.matrixWorld.clone().invert();
  const localBounds = new THREE.Box3().makeEmpty();
  const anchors: SurfaceSnapAnchor[] = [];

  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return;

    const childAnchors = buildGeometrySurfaceSnapAnchors(
      mesh.geometry,
      cellSize,
      matrixScale(mesh.matrixWorld)
    );
    const meshToRoot = inverseRootMatrix.clone().multiply(mesh.matrixWorld);
    const transformed = transformSurfaceSnapAnchors(childAnchors, meshToRoot);
    for (const anchor of transformed) {
      anchors.push(anchor);
      localBounds.expandByPoint(anchor.position);
    }
  });

  if (!finiteBounds(localBounds) || anchors.length === 0) return null;
  return {
    id,
    visible: root.visible,
    localBounds,
    matrixWorld: root.matrixWorld.clone(),
    anchors
  };
}

function expandedWorldBounds(target: SurfaceSnapTarget, amount: number): THREE.Box3 {
  return target.localBounds.clone().applyMatrix4(target.matrixWorld).expandByScalar(amount);
}

function hashCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function hashKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function buildAnchorHash(
  anchors: readonly SurfaceSnapAnchor[],
  cellSize: number
): Map<string, SurfaceSnapAnchor[]> {
  const hash = new Map<string, SurfaceSnapAnchor[]>();
  for (const anchor of anchors) {
    const key = hashKey(
      hashCoordinate(anchor.position.x, cellSize),
      hashCoordinate(anchor.position.y, cellSize),
      hashCoordinate(anchor.position.z, cellSize)
    );
    const bucket = hash.get(key);
    if (bucket) bucket.push(anchor);
    else hash.set(key, [anchor]);
  }
  return hash;
}

function nearbyAnchors(
  hash: Map<string, SurfaceSnapAnchor[]>,
  position: THREE.Vector3,
  cellSize: number
): SurfaceSnapAnchor[] {
  const centerX = hashCoordinate(position.x, cellSize);
  const centerY = hashCoordinate(position.y, cellSize);
  const centerZ = hashCoordinate(position.z, cellSize);
  const result: SurfaceSnapAnchor[] = [];

  for (let x = centerX - 1; x <= centerX + 1; x += 1) {
    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
      for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
        const bucket = hash.get(hashKey(x, y, z));
        if (bucket) result.push(...bucket);
      }
    }
  }
  return result;
}

function anchorsCanMeet(
  source: SurfaceSnapAnchor,
  target: SurfaceSnapAnchor,
  correction: THREE.Vector3,
  distance: number
): boolean {
  const normalAlignment = source.normal.dot(target.normal);
  if (normalAlignment > -0.12) return false;
  if (distance <= EPSILON) return true;

  const direction = correction.clone().multiplyScalar(1 / distance);
  return source.normal.dot(direction) > 0.04
    && target.normal.dot(direction) < -0.04;
}

export function findObjectSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const unchanged: ObjectSurfaceSnapResult = {
    position: [...source.position] as Vec3,
    targetId: null,
    distance: Number.POSITIVE_INFINITY
  };
  const worldThreshold = Math.max(0.4, Math.abs(positionStep) * 2);
  const sourceTarget = surfaceSnapTargetFromSceneObject(source, positionStep);
  if (!sourceTarget) return unchanged;

  const sourceWorldAnchors = transformSurfaceSnapAnchors(
    sourceTarget.anchors,
    sourceTarget.matrixWorld
  );
  const sourceWorldBounds = expandedWorldBounds(sourceTarget, worldThreshold);
  const targets = [
    ...objects.flatMap((object) => {
      const target = surfaceSnapTargetFromSceneObject(object, positionStep);
      return target ? [target] : [];
    }),
    ...additionalTargets
  ];
  const sourcePosition = new THREE.Vector3(...source.position);
  let bestCorrection: THREE.Vector3 | null = null;
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestNormalAlignment = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    if (
      target.id === source.id
      || !target.visible
      || target.anchors.length === 0
      || !sourceWorldBounds.intersectsBox(expandedWorldBounds(target, worldThreshold))
    ) continue;

    const targetWorldAnchors = transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
    const targetHash = buildAnchorHash(targetWorldAnchors, worldThreshold);

    for (const sourceAnchor of sourceWorldAnchors) {
      for (const targetAnchor of nearbyAnchors(targetHash, sourceAnchor.position, worldThreshold)) {
        const correction = targetAnchor.position.clone().sub(sourceAnchor.position);
        const distance = correction.length();
        if (distance > worldThreshold + EPSILON) continue;
        if (!anchorsCanMeet(sourceAnchor, targetAnchor, correction, distance)) continue;

        const normalAlignment = sourceAnchor.normal.dot(targetAnchor.normal);
        const betterDistance = distance < bestDistance - EPSILON;
        const equalDistanceBetterNormals = Math.abs(distance - bestDistance) <= EPSILON
          && normalAlignment < bestNormalAlignment;
        if (!betterDistance && !equalDistanceBetterNormals) continue;

        bestCorrection = correction;
        bestTargetId = target.id;
        bestDistance = distance;
        bestNormalAlignment = normalAlignment;
      }
    }
  }

  if (!bestCorrection) return unchanged;
  const snappedPosition = sourcePosition.add(bestCorrection);
  return {
    position: [snappedPosition.x, snappedPosition.y, snappedPosition.z],
    targetId: bestTargetId,
    distance: bestDistance
  };
}

export function snapObjectToObjectSurfaces(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): Vec3 {
  return findObjectSurfaceSnap(source, objects, positionStep, additionalTargets).position;
}
