import * as THREE from 'three';
import { buildCenteredAppleCutterAxis } from '../appleCutter/appleCutterAxisGrid';
import type { AppleCutterAxis } from '../appleCutter/appleCutterTypes';
import type { Vec3 } from '../../types/editor';

const EPSILON = 0.000001;
const PARALLEL_DOT = 0.995;

export interface InternalCutterSnapTarget {
  id: string;
  visible: boolean;
  localBounds: THREE.Box3;
  matrixWorld: THREE.Matrix4;
}

export interface InternalCutterSnapResult {
  position: Vec3;
  targetId: string | null;
  distance: number;
  sourceAnchorId: string | null;
  targetAnchorId: string | null;
}

export interface InternalCutterSnapOptions {
  ignoredTargetAnchorId?: string | null;
}

interface InternalCutterPlane {
  id: string;
  axis: AppleCutterAxis;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

interface SweepCandidate extends InternalCutterSnapResult {
  travel: number;
}

function matrixScale(matrix: THREE.Matrix4): THREE.Vector3 {
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale;
}

function axisValue(vector: THREE.Vector3, axis: AppleCutterAxis): number {
  if (axis === 'x') return vector.x;
  if (axis === 'y') return vector.y;
  return vector.z;
}

function setAxisValue(vector: THREE.Vector3, axis: AppleCutterAxis, value: number): void {
  if (axis === 'x') vector.x = value;
  else if (axis === 'y') vector.y = value;
  else vector.z = value;
}

function localAxisNormal(axis: AppleCutterAxis): THREE.Vector3 {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0);
  if (axis === 'y') return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function rounded(value: number): string {
  return Number(value.toFixed(8)).toString();
}

export function buildInternalCutterPlanes(
  target: InternalCutterSnapTarget
): InternalCutterPlane[] {
  if (!target.visible || target.localBounds.isEmpty()) return [];

  const scale = matrixScale(target.matrixWorld);
  const center = target.localBounds.getCenter(new THREE.Vector3());
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(target.matrixWorld);
  const axes: AppleCutterAxis[] = ['x', 'y', 'z'];
  const planes: InternalCutterPlane[] = [];

  for (const axis of axes) {
    const minimum = axisValue(target.localBounds.min, axis);
    const maximum = axisValue(target.localBounds.max, axis);
    const axisScale = axisValue(scale, axis);
    const grid = buildCenteredAppleCutterAxis(axis, minimum, maximum, axisScale);

    grid.cuts.forEach((cut, index) => {
      const localPoint = center.clone();
      setAxisValue(localPoint, axis, cut);
      const normal = localAxisNormal(axis).applyMatrix3(normalMatrix).normalize();
      if (normal.lengthSq() <= EPSILON * EPSILON) return;
      planes.push({
        id: `internal:${target.id}:${axis}:${index}:${rounded(cut)}`,
        axis,
        point: localPoint.applyMatrix4(target.matrixWorld),
        normal
      });
    });
  }

  return planes;
}

function worldBounds(target: InternalCutterSnapTarget, matrix = target.matrixWorld): THREE.Box3 {
  return target.localBounds.clone().applyMatrix4(matrix);
}

function targetAtPosition(
  target: InternalCutterSnapTarget,
  position: THREE.Vector3
): InternalCutterSnapTarget {
  const matrixWorld = target.matrixWorld.clone();
  matrixWorld.setPosition(position);
  return { ...target, matrixWorld };
}

function intersectsBody(
  source: InternalCutterSnapTarget,
  target: InternalCutterSnapTarget,
  sourcePosition: THREE.Vector3
): boolean {
  const candidateSource = targetAtPosition(source, sourcePosition);
  return worldBounds(candidateSource).intersectsBox(worldBounds(target));
}

function parallelPlanes(source: InternalCutterPlane, target: InternalCutterPlane): boolean {
  return Math.abs(source.normal.dot(target.normal)) >= PARALLEL_DOT;
}

function planeSeparation(
  source: InternalCutterPlane,
  target: InternalCutterPlane
): number {
  return source.point.clone().sub(target.point).dot(target.normal);
}

function unchanged(position: THREE.Vector3): InternalCutterSnapResult {
  return {
    position: [position.x, position.y, position.z],
    targetId: null,
    distance: Number.POSITIVE_INFINITY,
    sourceAnchorId: null,
    targetAnchorId: null
  };
}

export function findInternalCutterTargetSnap(
  source: InternalCutterSnapTarget,
  targets: readonly InternalCutterSnapTarget[],
  sourcePosition: THREE.Vector3,
  worldThreshold: number,
  options: InternalCutterSnapOptions = {}
): InternalCutterSnapResult {
  const sourcePlanes = buildInternalCutterPlanes(source);
  if (sourcePlanes.length === 0) return unchanged(sourcePosition);

  let best: InternalCutterSnapResult | null = null;

  for (const target of targets) {
    if (
      !target.visible
      || target.id === source.id
      || !worldBounds(source).intersectsBox(worldBounds(target))
    ) continue;

    const targetPlanes = buildInternalCutterPlanes(target);
    for (const sourcePlane of sourcePlanes) {
      for (const targetPlane of targetPlanes) {
        if (
          options.ignoredTargetAnchorId === targetPlane.id
          || !parallelPlanes(sourcePlane, targetPlane)
        ) continue;

        const separation = planeSeparation(sourcePlane, targetPlane);
        const distance = Math.abs(separation);
        if (distance > worldThreshold + EPSILON) continue;

        const correction = targetPlane.normal.clone().multiplyScalar(-separation);
        const snappedPosition = sourcePosition.clone().add(correction);
        if (!intersectsBody(source, target, snappedPosition)) continue;

        if (best && distance >= best.distance - EPSILON) continue;
        best = {
          position: [snappedPosition.x, snappedPosition.y, snappedPosition.z],
          targetId: target.id,
          distance,
          sourceAnchorId: sourcePlane.id,
          targetAnchorId: targetPlane.id
        };
      }
    }
  }

  return best ?? unchanged(sourcePosition);
}

export function findSweptInternalCutterTargetSnap(
  previousSource: InternalCutterSnapTarget,
  currentSource: InternalCutterSnapTarget,
  targets: readonly InternalCutterSnapTarget[],
  positionStep: number,
  options: InternalCutterSnapOptions = {}
): InternalCutterSnapResult | null {
  void positionStep;
  if (previousSource.id !== currentSource.id) return null;

  const previousCenter = new THREE.Vector3().setFromMatrixPosition(previousSource.matrixWorld);
  const currentCenter = new THREE.Vector3().setFromMatrixPosition(currentSource.matrixWorld);
  const movement = currentCenter.clone().sub(previousCenter);
  if (movement.lengthSq() <= EPSILON * EPSILON) return null;

  const previousPlanes = new Map(
    buildInternalCutterPlanes(previousSource).map((plane) => [plane.id, plane] as const)
  );
  const currentPlanes = buildInternalCutterPlanes(currentSource);
  if (currentPlanes.length === 0 || previousPlanes.size !== currentPlanes.length) return null;

  const sweptBounds = worldBounds(previousSource).union(worldBounds(currentSource));
  let best: SweepCandidate | null = null;

  for (const target of targets) {
    if (
      !target.visible
      || target.id === currentSource.id
      || !sweptBounds.intersectsBox(worldBounds(target))
    ) continue;

    const targetPlanes = buildInternalCutterPlanes(target);
    for (const currentPlane of currentPlanes) {
      const previousPlane = previousPlanes.get(currentPlane.id);
      if (!previousPlane) continue;

      for (const targetPlane of targetPlanes) {
        if (
          options.ignoredTargetAnchorId === targetPlane.id
          || !parallelPlanes(currentPlane, targetPlane)
        ) continue;

        const previousSeparation = planeSeparation(previousPlane, targetPlane);
        const currentSeparation = planeSeparation(currentPlane, targetPlane);

        // Bereits am letzten akzeptierten Punkt deckungsgleiche Schnitte werden
        // nicht erneut gefangen. So kann der Benutzer aus jedem Snap herausziehen.
        if (Math.abs(previousSeparation) <= EPSILON) continue;
        if (previousSeparation * currentSeparation > EPSILON) continue;

        const denominator = previousSeparation - currentSeparation;
        if (Math.abs(denominator) <= EPSILON) continue;
        const travel = previousSeparation / denominator;
        if (travel <= EPSILON || travel > 1 + EPSILON) continue;

        const clampedTravel = THREE.MathUtils.clamp(travel, 0, 1);
        const snappedPosition = previousCenter.clone().lerp(currentCenter, clampedTravel);
        if (!intersectsBody(currentSource, target, snappedPosition)) continue;

        const candidate: SweepCandidate = {
          position: [snappedPosition.x, snappedPosition.y, snappedPosition.z],
          targetId: target.id,
          distance: currentCenter.distanceTo(snappedPosition),
          sourceAnchorId: currentPlane.id,
          targetAnchorId: targetPlane.id,
          travel: clampedTravel
        };

        if (
          !best
          || candidate.travel < best.travel - EPSILON
          || (
            Math.abs(candidate.travel - best.travel) <= EPSILON
            && candidate.distance < best.distance - EPSILON
          )
        ) best = candidate;
      }
    }
  }

  return best
    ? {
      position: best.position,
      targetId: best.targetId,
      distance: best.distance,
      sourceAnchorId: best.sourceAnchorId,
      targetAnchorId: best.targetAnchorId
    }
    : null;
}
