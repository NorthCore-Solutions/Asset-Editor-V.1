import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import {
  combineWorldBounds,
  hasFiniteWorldBounds,
  translatedWorldBounds,
  worldBoundsFromObject3D,
  worldBoundsFromSceneObject
} from '../spatial/worldBounds';

const CONTACT_EPSILON = 0.0001;

export interface PlacementObstacle {
  id: string;
  bounds: THREE.Box3;
}

function intervalPenetrates(
  leftMinimum: number,
  leftMaximum: number,
  rightMinimum: number,
  rightMaximum: number
): boolean {
  const leftSize = leftMaximum - leftMinimum;
  const rightSize = rightMaximum - rightMinimum;
  const overlap = Math.min(leftMaximum, rightMaximum) - Math.max(leftMinimum, rightMinimum);

  if (overlap > CONTACT_EPSILON) return true;

  const leftFlat = leftSize <= CONTACT_EPSILON;
  const rightFlat = rightSize <= CONTACT_EPSILON;
  const leftCenter = (leftMinimum + leftMaximum) * 0.5;
  const rightCenter = (rightMinimum + rightMaximum) * 0.5;

  if (leftFlat && rightFlat) {
    return Math.abs(leftCenter - rightCenter) <= CONTACT_EPSILON;
  }
  if (leftFlat) {
    return leftCenter > rightMinimum + CONTACT_EPSILON
      && leftCenter < rightMaximum - CONTACT_EPSILON;
  }
  if (rightFlat) {
    return rightCenter > leftMinimum + CONTACT_EPSILON
      && rightCenter < leftMaximum - CONTACT_EPSILON;
  }

  return false;
}

export function placementBoundsPenetrate(left: THREE.Box3, right: THREE.Box3): boolean {
  return intervalPenetrates(left.min.x, left.max.x, right.min.x, right.max.x)
    && intervalPenetrates(left.min.y, left.max.y, right.min.y, right.max.y)
    && intervalPenetrates(left.min.z, left.max.z, right.min.z, right.max.z);
}

function snappedCoordinate(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function orderedObstacles(
  obstacles: PlacementObstacle[],
  preferredTargetId?: string
): PlacementObstacle[] {
  const valid = obstacles.filter((obstacle) => hasFiniteWorldBounds(obstacle.bounds));
  if (!preferredTargetId) return [...valid].reverse();

  return [
    ...valid.filter((obstacle) => obstacle.id === preferredTargetId),
    ...valid.filter((obstacle) => obstacle.id !== preferredTargetId).reverse()
  ];
}

function isFreeTranslation(
  sourceBounds: THREE.Box3,
  translation: THREE.Vector3,
  obstacles: PlacementObstacle[]
): boolean {
  const candidateBounds = translatedWorldBounds(sourceBounds, translation);
  return !obstacles.some((obstacle) => placementBoundsPenetrate(candidateBounds, obstacle.bounds));
}

function translationForCenter(
  sourceCenter: THREE.Vector3,
  desiredCenter: THREE.Vector3
): THREE.Vector3 {
  return desiredCenter.clone().sub(sourceCenter);
}

export function findAvailableBoundsTranslation(
  sourceBounds: THREE.Box3,
  obstacles: PlacementObstacle[],
  positionStep: number,
  preferredTargetId?: string
): THREE.Vector3 {
  if (!hasFiniteWorldBounds(sourceBounds)) return new THREE.Vector3();

  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const ordered = orderedObstacles(obstacles, preferredTargetId);

  if (ordered.length === 0) {
    return new THREE.Vector3(
      snappedCoordinate(sourceCenter.x, positionStep) - sourceCenter.x,
      0,
      snappedCoordinate(sourceCenter.z, positionStep) - sourceCenter.z
    );
  }

  for (const target of ordered) {
    const targetCenter = target.bounds.getCenter(new THREE.Vector3());
    const candidates = [
      new THREE.Vector3(
        target.bounds.max.x + sourceSize.x * 0.5,
        sourceCenter.y,
        snappedCoordinate(targetCenter.z, positionStep)
      ),
      new THREE.Vector3(
        snappedCoordinate(targetCenter.x, positionStep),
        sourceCenter.y,
        target.bounds.max.z + sourceSize.z * 0.5
      ),
      new THREE.Vector3(
        target.bounds.min.x - sourceSize.x * 0.5,
        sourceCenter.y,
        snappedCoordinate(targetCenter.z, positionStep)
      ),
      new THREE.Vector3(
        snappedCoordinate(targetCenter.x, positionStep),
        sourceCenter.y,
        target.bounds.min.z - sourceSize.z * 0.5
      )
    ];

    for (const desiredCenter of candidates) {
      const translation = translationForCenter(sourceCenter, desiredCenter);
      if (isFreeTranslation(sourceBounds, translation, obstacles)) return translation;
    }
  }

  const sceneBounds = combineWorldBounds(ordered.map((obstacle) => obstacle.bounds));
  if (!sceneBounds) return new THREE.Vector3();

  const sceneCenter = sceneBounds.getCenter(new THREE.Vector3());
  const fallbackCenter = new THREE.Vector3(
    sceneBounds.max.x + sourceSize.x * 0.5,
    sourceCenter.y,
    snappedCoordinate(sceneCenter.z, positionStep)
  );
  return translationForCenter(sourceCenter, fallbackCenter);
}

function sceneObjectObstacles(objects: SceneObjectData[]): PlacementObstacle[] {
  return objects.flatMap((object) => {
    if (!object.visible) return [];
    const bounds = worldBoundsFromSceneObject(object);
    return bounds ? [{ id: object.id, bounds }] : [];
  });
}

function translatedPosition(position: Vec3, translation: THREE.Vector3): Vec3 {
  return [
    position[0] + translation.x,
    position[1] + translation.y,
    position[2] + translation.z
  ];
}

export function findAvailableObjectPlacement(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  preferredTargetId?: string
): Vec3 {
  const sourceBounds = worldBoundsFromSceneObject(source);
  if (!sourceBounds) return [...source.position] as Vec3;

  const translation = findAvailableBoundsTranslation(
    sourceBounds,
    sceneObjectObstacles(objects),
    positionStep,
    preferredTargetId
  );
  return translatedPosition(source.position, translation);
}

export function findAvailableObjectGroupTranslation(
  sources: SceneObjectData[],
  objects: SceneObjectData[],
  positionStep: number,
  preferredTargetId?: string
): Vec3 {
  const sourceBounds = combineWorldBounds(
    sources.map((source) => worldBoundsFromSceneObject(source))
  );
  if (!sourceBounds) return [0, 0, 0];

  const translation = findAvailableBoundsTranslation(
    sourceBounds,
    sceneObjectObstacles(objects),
    positionStep,
    preferredTargetId
  );
  return [translation.x, translation.y, translation.z];
}

export function placementObstacleFromObject3D(
  root: THREE.Object3D,
  id: string = root.uuid
): PlacementObstacle | null {
  const bounds = worldBoundsFromObject3D(root);
  return bounds ? { id, bounds } : null;
}
