import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGeometry, createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import {
  findObjectSurfaceSnap,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject,
  type SurfaceSnapTarget
} from '../src/editor/snapping/objectSurfaceSnap';
import {
  buildGeometrySurfaceSnapAnchors,
  createSurfaceSnapPointsGeometry,
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from '../src/editor/snapping/surfaceSnapTopology';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const STEP = 0.25;
const GAP = 0.04;
const MAX_SAMPLES_PER_ELEMENT = 18;

function sampledAnchors(anchors: readonly SurfaceSnapAnchor[]): SurfaceSnapAnchor[] {
  if (anchors.length <= MAX_SAMPLES_PER_ELEMENT) return [...anchors];
  const result: SurfaceSnapAnchor[] = [];
  const stride = anchors.length / MAX_SAMPLES_PER_ELEMENT;
  for (let index = 0; index < MAX_SAMPLES_PER_ELEMENT; index += 1) {
    const anchor = anchors[Math.floor(index * stride)];
    if (anchor) result.push(anchor);
  }
  return result;
}

function sceneScale(object: SceneObjectData): THREE.Vector3 {
  return new THREE.Vector3(...object.scale);
}

function sourceForTargetAnchor(
  targetAnchor: SurfaceSnapAnchor
): { source: SceneObjectData; sourceAnchor: SurfaceSnapAnchor } {
  const source = createSceneObject('sphere');
  source.id = crypto.randomUUID();
  source.position = [0, 0, 0];
  source.scale = [0.12, 0.12, 0.12];
  const sourceTarget = surfaceSnapTargetFromSceneObject(source, STEP);
  if (!sourceTarget || sourceTarget.anchors.length === 0) {
    throw new Error('Keine Snap-Topologie für Testkugel.');
  }

  const sourceAnchor = sourceTarget.anchors.reduce((best, candidate) =>
    candidate.normal.dot(targetAnchor.normal) < best.normal.dot(targetAnchor.normal)
      ? candidate
      : best
  );
  const scaledSourcePoint = sourceAnchor.position.clone().multiply(sceneScale(source));
  const position = targetAnchor.position.clone()
    .addScaledVector(targetAnchor.normal, GAP)
    .sub(scaledSourcePoint);
  source.position = [position.x, position.y, position.z];
  return { source, sourceAnchor };
}

function snappedAnchorDistance(
  source: SceneObjectData,
  resultPosition: Vec3,
  targetAnchor: SurfaceSnapAnchor
): number {
  const snappedSource = { ...source, position: resultPosition };
  const sourceTarget = surfaceSnapTargetFromSceneObject(snappedSource, STEP);
  if (!sourceTarget) return Number.POSITIVE_INFINITY;
  const worldAnchors = transformSurfaceSnapAnchors(sourceTarget.anchors, sourceTarget.matrixWorld);
  return worldAnchors
    .filter((anchor) => anchor.normal.dot(targetAnchor.normal) < -0.12)
    .reduce(
      (minimum, anchor) => Math.min(minimum, anchor.position.distanceTo(targetAnchor.position)),
      Number.POSITIVE_INFINITY
    );
}

describe('gemeinsame geometrische Snap-Topologie', () => {
  it.each(SHAPE_DEFINITIONS)("erzeugt für '$label' echte und sichtbare Oberflächenpunkte", ({ type }) => {
    const object = createSceneObject(type);
    const geometry = createGeometry(object);
    const anchors = buildGeometrySurfaceSnapAnchors(geometry, STEP, sceneScale(object));
    const pointsGeometry = createSurfaceSnapPointsGeometry(anchors, 0);
    const pointPositions = pointsGeometry.getAttribute('position');

    expect(anchors.length).toBeGreaterThan(0);
    expect(pointPositions.count).toBe(anchors.length);
    for (const anchor of sampledAnchors(anchors)) {
      expect([
        anchor.position.x,
        anchor.position.y,
        anchor.position.z,
        anchor.normal.x,
        anchor.normal.y,
        anchor.normal.z
      ].every(Number.isFinite)).toBe(true);
      expect(anchor.normal.length()).toBeCloseTo(1, 5);
    }

    pointsGeometry.dispose();
    geometry.dispose();
  });

  it.each(SHAPE_DEFINITIONS)(
    "lässt bei '$label' jeden geprüften sichtbaren Punkt unter denselben Bedingungen einrasten",
    ({ type }) => {
      const targetObject = createSceneObject(type);
      targetObject.id = `target-${type}`;
      const target = surfaceSnapTargetFromSceneObject(targetObject, STEP);
      expect(target).not.toBeNull();
      if (!target) return;

      const worldAnchors = transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
      for (const targetAnchor of sampledAnchors(worldAnchors)) {
        const { source } = sourceForTargetAnchor(targetAnchor);
        const inverseTargetMatrix = target.matrixWorld.clone().invert();
        const singleAnchorTarget: SurfaceSnapTarget = {
          ...target,
          localBounds: new THREE.Box3(
            targetAnchor.position.clone().addScalar(-0.001).applyMatrix4(inverseTargetMatrix),
            targetAnchor.position.clone().addScalar(0.001).applyMatrix4(inverseTargetMatrix)
          ),
          matrixWorld: target.matrixWorld.clone(),
          anchors: [{
            position: targetAnchor.position.clone().applyMatrix4(inverseTargetMatrix),
            normal: targetAnchor.normal.clone().applyMatrix3(
              new THREE.Matrix3().getNormalMatrix(inverseTargetMatrix)
            ).normalize()
          }]
        };
        const result = findObjectSurfaceSnap(source, [], STEP, [singleAnchorTarget]);

        expect(result.targetId).toBe(target.id);
        expect(result.distance).toBeLessThanOrEqual(GAP + 0.0001);
        expect(snappedAnchorDistance(source, result.position, targetAnchor)).toBeLessThan(0.0001);
      }
    }
  );
});

describe.each(['Desktop', 'Android'])('identische Voraussetzungen auf %s', (platform) => {
  it('verwendet dieselbe Punkt-zu-Punkt-Instanz für Rundungen und Gebäudeelemente', () => {
    for (const type of ['sphere', 'hemisphere', 'cylinder', 'cone', 'torus', 'wall', 'gableRoof', 'stairs'] as const) {
      const targetObject = createSceneObject(type);
      targetObject.id = `${platform}-${type}`;
      const target = surfaceSnapTargetFromSceneObject(targetObject, STEP);
      expect(target).not.toBeNull();
      if (!target) continue;
      const targetAnchor = sampledAnchors(
        transformSurfaceSnapAnchors(target.anchors, target.matrixWorld)
      ).at(0);
      expect(targetAnchor).toBeDefined();
      if (!targetAnchor) continue;

      const { source } = sourceForTargetAnchor(targetAnchor);
      const result = findObjectSurfaceSnap(source, [targetObject], STEP);
      expect(result.targetId).toBe(targetObject.id);
    }
  });
});

describe('importierte Elemente', () => {
  it('übernimmt echte Mesh-Punkte statt nur einer gemeinsamen Bounding Box', () => {
    const root = new THREE.Group();
    root.position.set(3, 0, -2);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10));
    sphere.position.set(0, 1, 0);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    box.position.set(2, 1, 0);
    root.add(sphere, box);

    const target = surfaceSnapTargetFromObject3D(root, 'imported', STEP);
    expect(target).not.toBeNull();
    expect(target?.anchors.length).toBeGreaterThan(30);
    if (!target) return;

    const targetAnchor = sampledAnchors(
      transformSurfaceSnapAnchors(target.anchors, target.matrixWorld)
    ).at(0);
    expect(targetAnchor).toBeDefined();
    if (!targetAnchor) return;

    const { source } = sourceForTargetAnchor(targetAnchor);
    const result = findObjectSurfaceSnap(source, [], STEP, [target]);
    expect(result.targetId).toBe('imported');

    sphere.geometry.dispose();
    box.geometry.dispose();
  });
});
