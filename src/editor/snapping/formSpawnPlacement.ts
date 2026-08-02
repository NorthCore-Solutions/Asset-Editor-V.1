import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import { findFormSurfaceSnap, isFormType } from './primitiveSurfaceSnap';

const CONTACT_EPSILON = 0.0001;

function objectMatrix(object: SceneObjectData, position: Vec3 = object.position): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
}

function worldBounds(object: SceneObjectData, position: Vec3 = object.position): THREE.Box3 {
  const geometry = createGeometry(object);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone()
    ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  geometry.dispose();
  return bounds.applyMatrix4(objectMatrix(object, position));
}

function boxesPenetrate(left: THREE.Box3, right: THREE.Box3): boolean {
  const overlapX = Math.min(left.max.x, right.max.x) - Math.max(left.min.x, right.min.x);
  const overlapY = Math.min(left.max.y, right.max.y) - Math.max(left.min.y, right.min.y);
  const overlapZ = Math.min(left.max.z, right.max.z) - Math.max(left.min.z, right.min.z);
  return overlapX > CONTACT_EPSILON && overlapY > CONTACT_EPSILON && overlapZ > CONTACT_EPSILON;
}

function isFreePlacement(source: SceneObjectData, position: Vec3, objects: SceneObjectData[]): boolean {
  const candidateBounds = worldBounds(source, position);
  return !objects.some((object) => object.visible
    && isFormType(object.type)
    && boxesPenetrate(candidateBounds, worldBounds(object)));
}

function snappedCoordinate(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function positionForCenter(source: SceneObjectData, sourceCenter: THREE.Vector3, desiredCenter: THREE.Vector3): Vec3 {
  const offset = desiredCenter.clone().sub(sourceCenter);
  return [
    source.position[0] + offset.x,
    source.position[1] + offset.y,
    source.position[2] + offset.z
  ];
}

function orderedTargets(objects: SceneObjectData[], preferredTargetId?: string): SceneObjectData[] {
  const targets = objects.filter((object) => object.visible && isFormType(object.type));
  if (!preferredTargetId) return [...targets].reverse();
  return [
    ...targets.filter((object) => object.id === preferredTargetId),
    ...targets.filter((object) => object.id !== preferredTargetId).reverse()
  ];
}

export function findAvailableFormPlacement(
  source: SceneObjectData,
  objects: SceneObjectData[],
  positionStep: number,
  preferredTargetId?: string
): Vec3 {
  if (!isFormType(source.type)) return [...source.position] as Vec3;

  const targets = orderedTargets(objects, preferredTargetId);
  if (targets.length === 0) return [...source.position] as Vec3;

  const sourceBounds = worldBounds(source);
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());

  for (const target of targets) {
    const targetBounds = worldBounds(target);
    const targetCenter = targetBounds.getCenter(new THREE.Vector3());
    const candidates = [
      new THREE.Vector3(
        targetBounds.max.x + sourceSize.x * 0.5,
        sourceCenter.y,
        snappedCoordinate(targetCenter.z, positionStep)
      ),
      new THREE.Vector3(
        snappedCoordinate(targetCenter.x, positionStep),
        sourceCenter.y,
        targetBounds.max.z + sourceSize.z * 0.5
      ),
      new THREE.Vector3(
        targetBounds.min.x - sourceSize.x * 0.5,
        sourceCenter.y,
        snappedCoordinate(targetCenter.z, positionStep)
      ),
      new THREE.Vector3(
        snappedCoordinate(targetCenter.x, positionStep),
        sourceCenter.y,
        targetBounds.min.z - sourceSize.z * 0.5
      )
    ];

    for (const desiredCenter of candidates) {
      const initialPosition = positionForCenter(source, sourceCenter, desiredCenter);
      const snappedPosition = findFormSurfaceSnap(
        { ...source, position: initialPosition },
        [target],
        positionStep
      ).position;

      if (isFreePlacement(source, snappedPosition, objects)) return snappedPosition;
    }
  }

  const sceneBounds = targets.reduce(
    (bounds, target) => bounds.union(worldBounds(target)),
    new THREE.Box3().makeEmpty()
  );
  const sceneCenter = sceneBounds.getCenter(new THREE.Vector3());
  const fallbackCenter = new THREE.Vector3(
    sceneBounds.max.x + sourceSize.x * 0.5,
    sourceCenter.y,
    snappedCoordinate(sceneCenter.z, positionStep)
  );
  return positionForCenter(source, sourceCenter, fallbackCenter);
}
