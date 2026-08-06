import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import { APPLE_CUTTER_CELL_SIZE } from '../appleCutter/appleCutterAxisGrid';
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
  sourceAnchorId?: string | null;
  targetAnchorId?: string | null;
}

export interface SurfaceSnapTarget {
  id: string;
  visible: boolean;
  localBounds: THREE.Box3;
  matrixWorld: THREE.Matrix4;
  anchors: SurfaceSnapAnchor[];
  scope?: 'component' | 'composite';
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

function geometryCacheKey(object: SceneObjectData): string {
  return JSON.stringify({
    id: object.id,
    type: object.type,
    geometry: object.geometry,
    scale: object.scale.map((value) => Number(Math.abs(value).toFixed(6))),
    cutterCellSize: APPLE_CUTTER_CELL_SIZE
  });
}

function cachedSceneTopology(
  object: SceneObjectData
): { localBounds: THREE.Box3; anchors: SurfaceSnapAnchor[] } | null {
  const key = geometryCacheKey(object);
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
      APPLE_CUTTER_CELL_SIZE,
      new THREE.Vector3(...object.scale),
      { componentId: object.id, scope: 'component' }
    );
    if (anchors.length === 0) return null;

    const topology = { localBounds, anchors };
    topologyCache.set(key, topology);
    if (topologyCache.size > TOPOLOGY_CACHE_LIMIT) {
      const oldestKey = topologyCache.keys().next().value;
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
  _cellSize: number = APPLE_CUTTER_CELL_SIZE
): SurfaceSnapTarget | null {
  void _cellSize;
  const topology = cachedSceneTopology(object);
  if (!topology) return null;
  return {
    id: object.id,
    visible: object.visible,
    localBounds: topology.localBounds,
    matrixWorld: matrixForSceneObject(object),
    anchors: topology.anchors,
    scope: 'component'
  };
}

function matrixScale(matrix: THREE.Matrix4): THREE.Vector3 {
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale;
}

/** Vereinheitlicht Attribute, damit beliebige importierte Meshes zusammengeführt werden können. */
function normalizedSnapGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const clone = source.clone();
  const geometry = clone.index ? clone.toNonIndexed() : clone;
  if (geometry !== clone) clone.dispose();

  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position') geometry.deleteAttribute(name);
  }
  geometry.clearGroups();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function mergedGeometry(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  return mergeGeometries(parts, false);
}

function quantizedPointKey(point: THREE.Vector3): string {
  const precision = 0.00001;
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value / precision))
    .join(':');
}

function closedTriangleSoup(geometry: THREE.BufferGeometry): boolean {
  const positions = geometry.getAttribute('position');
  if (!positions || positions.itemSize < 3 || positions.count < 3) return false;
  const edgeCounts = new Map<string, number>();

  for (let triangle = 0; triangle + 2 < positions.count; triangle += 3) {
    const points = [0, 1, 2].map((offset) => (
      new THREE.Vector3().fromBufferAttribute(positions, triangle + offset)
    ));
    for (const [first, second] of [[0, 1], [1, 2], [2, 0]] as const) {
      const firstKey = quantizedPointKey(points[first] ?? new THREE.Vector3());
      const secondKey = quantizedPointKey(points[second] ?? new THREE.Vector3());
      const key = firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  return edgeCounts.size > 0 && [...edgeCounts.values()].every((count) => count % 2 === 0);
}

function pointInsideClosedGeometry(
  point: THREE.Vector3,
  geometry: THREE.BufferGeometry
): boolean {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(
    point,
    new THREE.Vector3(1, 0.371, 0.613).normalize(),
    0.000001,
    Number.POSITIVE_INFINITY
  );
  const distances = raycaster.intersectObject(mesh, false)
    .map((hit) => hit.distance)
    .filter((distance) => distance > 0.00001)
    .sort((left, right) => left - right);
  material.dispose();

  let uniqueCount = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const distance of distances) {
    if (distance - previous <= 0.00001) continue;
    previous = distance;
    uniqueCount += 1;
  }
  return uniqueCount % 2 === 1;
}

/**
 * Entfernt Composite-Punkte, deren leicht nach außen versetzte Position in
 * einem anderen geschlossenen Bauteil liegt. Dadurch verschwinden insbesondere
 * Kontaktflächen zwischen Wänden, Dach und weiteren Gruppenbestandteilen.
 */
function externalCompositeAnchors(
  anchors: SurfaceSnapAnchor[],
  componentParts: readonly THREE.BufferGeometry[]
): SurfaceSnapAnchor[] {
  const closedParts = componentParts.filter(closedTriangleSoup);
  if (closedParts.length < 2) return anchors;
  const combinedBounds = new THREE.Box3().makeEmpty();
  for (const part of closedParts) {
    part.computeBoundingBox();
    if (part.boundingBox) combinedBounds.union(part.boundingBox);
  }
  const diagonal = combinedBounds.getSize(new THREE.Vector3()).length();
  const offset = Math.max(0.0001, diagonal * 0.00001);

  return anchors.filter((anchor) => {
    const outsideProbe = anchor.position.clone().addScaledVector(anchor.normal, offset);
    return !closedParts.some((part) => pointInsideClosedGeometry(outsideProbe, part));
  });
}

function compositeTargetFromParts(
  parts: THREE.BufferGeometry[],
  id: string,
  visible: boolean,
  matrixWorld: THREE.Matrix4,
  scale: THREE.Vector3
): SurfaceSnapTarget | null {
  const geometry = mergedGeometry(parts);
  if (!geometry) return null;
  try {
    geometry.computeBoundingBox();
    const localBounds = geometry.boundingBox?.clone();
    if (!localBounds || !finiteBounds(localBounds)) return null;
    const rawAnchors = buildGeometrySurfaceSnapAnchors(
      geometry,
      APPLE_CUTTER_CELL_SIZE,
      scale,
      { componentId: id, scope: 'composite', maxAnchors: 16384 }
    );
    const anchors = externalCompositeAnchors(rawAnchors, parts);
    if (anchors.length === 0) return null;
    return {
      id,
      visible,
      localBounds,
      matrixWorld: matrixWorld.clone(),
      anchors,
      scope: 'composite'
    };
  } finally {
    geometry.dispose();
    for (const part of parts) {
      if (part !== geometry) part.dispose();
    }
  }
}

/**
 * Importierte Mehrfach-Mesh-Modelle erhalten ein gemeinsames äußeres
 * Apfelschneider-Raster. Material- oder Node-Grenzen erzeugen dadurch nicht
 * automatisch voneinander abweichende Snap-Raster.
 */
export function surfaceSnapTargetFromObject3D(
  root: THREE.Object3D,
  id: string = root.uuid,
  _cellSize: number = APPLE_CUTTER_CELL_SIZE
): SurfaceSnapTarget | null {
  void _cellSize;
  root.updateWorldMatrix(true, true);
  const inverseRootMatrix = root.matrixWorld.clone().invert();
  const parts: THREE.BufferGeometry[] = [];

  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = normalizedSnapGeometry(mesh.geometry);
    geometry.applyMatrix4(inverseRootMatrix.clone().multiply(mesh.matrixWorld));
    geometry.computeVertexNormals();
    parts.push(geometry);
  });

  return compositeTargetFromParts(
    parts,
    id,
    root.visible,
    root.matrixWorld,
    matrixScale(root.matrixWorld)
  );
}

/**
 * Erzeugt das äußere Raster einer Editor-Gruppe. Die vorhandenen
 * Komponentenraster bleiben davon unabhängig erhalten.
 */
export function surfaceSnapTargetFromSceneObjects(
  objects: readonly SceneObjectData[],
  id: string = 'composite'
): SurfaceSnapTarget | null {
  const visibleObjects = objects.filter((object) => object.visible);
  if (visibleObjects.length === 0) return null;

  const worldParts: THREE.BufferGeometry[] = [];
  const worldBounds = new THREE.Box3().makeEmpty();
  for (const object of visibleObjects) {
    const sourceGeometry = createGeometry(object);
    const geometry = normalizedSnapGeometry(sourceGeometry);
    sourceGeometry.dispose();
    geometry.applyMatrix4(matrixForSceneObject(object));
    geometry.computeBoundingBox();
    if (geometry.boundingBox) worldBounds.union(geometry.boundingBox);
    worldParts.push(geometry);
  }
  if (!finiteBounds(worldBounds)) {
    worldParts.forEach((part) => part.dispose());
    return null;
  }

  const center = worldBounds.getCenter(new THREE.Vector3());
  for (const part of worldParts) part.translate(-center.x, -center.y, -center.z);
  return compositeTargetFromParts(
    worldParts,
    id,
    true,
    new THREE.Matrix4().makeTranslation(center.x, center.y, center.z),
    new THREE.Vector3(1, 1, 1)
  );
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
  target: SurfaceSnapAnchor
): boolean {
  return source.normal.dot(target.normal) <= -0.12;
}

export function findSurfaceTargetSnap(
  sourceTarget: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  sourcePosition: THREE.Vector3,
  worldThreshold: number = 0.12
): ObjectSurfaceSnapResult {
  const unchanged: ObjectSurfaceSnapResult = {
    position: [sourcePosition.x, sourcePosition.y, sourcePosition.z],
    targetId: null,
    distance: Number.POSITIVE_INFINITY,
    sourceAnchorId: null,
    targetAnchorId: null
  };
  const sourceWorldAnchors = transformSurfaceSnapAnchors(
    sourceTarget.anchors,
    sourceTarget.matrixWorld
  );
  const sourceWorldBounds = expandedWorldBounds(sourceTarget, worldThreshold);
  let bestCorrection: THREE.Vector3 | null = null;
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestNormalAlignment = Number.POSITIVE_INFINITY;
  let bestSourceAnchorId: string | null = null;
  let bestTargetAnchorId: string | null = null;

  for (const target of targets) {
    if (
      target.id === sourceTarget.id
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
        if (!anchorsCanMeet(sourceAnchor, targetAnchor)) continue;

        const normalAlignment = sourceAnchor.normal.dot(targetAnchor.normal);
        const betterDistance = distance < bestDistance - EPSILON;
        const equalDistanceBetterNormals = Math.abs(distance - bestDistance) <= EPSILON
          && normalAlignment < bestNormalAlignment;
        if (!betterDistance && !equalDistanceBetterNormals) continue;

        bestCorrection = correction;
        bestTargetId = target.id;
        bestDistance = distance;
        bestNormalAlignment = normalAlignment;
        bestSourceAnchorId = sourceAnchor.id ?? null;
        bestTargetAnchorId = targetAnchor.id ?? null;
      }
    }
  }

  if (!bestCorrection) return unchanged;
  const snappedPosition = sourcePosition.clone().add(bestCorrection);
  return {
    position: [snappedPosition.x, snappedPosition.y, snappedPosition.z],
    targetId: bestTargetId,
    distance: bestDistance,
    sourceAnchorId: bestSourceAnchorId,
    targetAnchorId: bestTargetAnchorId
  };
}

export function findObjectSurfaceSnap(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): ObjectSurfaceSnapResult {
  const sourceTarget = surfaceSnapTargetFromSceneObject(source);
  if (!sourceTarget) {
    return {
      position: [...source.position] as Vec3,
      targetId: null,
      distance: Number.POSITIVE_INFINITY,
      sourceAnchorId: null,
      targetAnchorId: null
    };
  }
  const threshold = Math.min(0.12, Math.max(0.04, Math.abs(positionStep) * 0.4));
  const targets = [
    ...objects.flatMap((object) => {
      const target = surfaceSnapTargetFromSceneObject(object);
      return target ? [target] : [];
    }),
    ...additionalTargets
  ];
  return findSurfaceTargetSnap(
    sourceTarget,
    targets,
    new THREE.Vector3(...source.position),
    threshold
  );
}

export function snapObjectToObjectSurfaces(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  additionalTargets: readonly SurfaceSnapTarget[] = []
): Vec3 {
  return findObjectSurfaceSnap(source, objects, positionStep, additionalTargets).position;
}
