import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGeometry, createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import {
  findObjectSurfaceSnap,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObject
} from '../src/editor/snapping/objectSurfaceSnap';
import { isFormType } from '../src/editor/snapping/primitiveSurfaceSnap';
import {
  transformSurfaceSnapAnchors,
  type SurfaceSnapAnchor
} from '../src/editor/snapping/surfaceSnapTopology';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const GAP = 0.05;
const STEP = 0.25;

const withPosition = (object: SceneObjectData, position: Vec3): SceneObjectData => ({
  ...object,
  position
});

interface AnchorPair {
  sourceAnchor: SurfaceSnapAnchor;
  targetAnchor: SurfaceSnapAnchor;
}

interface SnapPair extends AnchorPair {
  source: SceneObjectData;
}

function worldAnchors(object: SceneObjectData): SurfaceSnapAnchor[] {
  const target = surfaceSnapTargetFromSceneObject(object);
  if (!target) throw new Error(`Keine Snap-Topologie für ${object.type}`);
  return transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
}

function bestOpposingPair(
  sourceAnchors: readonly SurfaceSnapAnchor[],
  targetAnchors: readonly SurfaceSnapAnchor[],
  label: string
): AnchorPair {
  let bestSource: SurfaceSnapAnchor | null = null;
  let bestTarget: SurfaceSnapAnchor | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const targetAnchor of targetAnchors) {
    for (const sourceAnchor of sourceAnchors) {
      const alignment = sourceAnchor.normal.dot(targetAnchor.normal);
      if (alignment > -0.12) continue;
      const cardinality = Math.max(
        Math.abs(targetAnchor.normal.x),
        Math.abs(targetAnchor.normal.y),
        Math.abs(targetAnchor.normal.z)
      );
      const score = (1 + alignment) * 100 + (1 - cardinality);
      if (score >= bestScore) continue;
      bestScore = score;
      bestSource = sourceAnchor;
      bestTarget = targetAnchor;
    }
  }

  if (!bestSource?.id || !bestTarget?.id) {
    throw new Error(`Kein gegengerichtetes Apfelschneider-Punktpaar für ${label}`);
  }
  return { sourceAnchor: bestSource, targetAnchor: bestTarget };
}

function positionedPair(
  source: SceneObjectData,
  target: SceneObjectData,
  gap: number = GAP
): SnapPair {
  const pair = bestOpposingPair(
    worldAnchors(source),
    worldAnchors(target),
    target.type
  );
  const desiredSourceAnchor = pair.targetAnchor.position.clone()
    .addScaledVector(pair.targetAnchor.normal, gap);
  const translation = desiredSourceAnchor.sub(pair.sourceAnchor.position);
  return {
    ...pair,
    source: withPosition(source, [
      source.position[0] + translation.x,
      source.position[1] + translation.y,
      source.position[2] + translation.z
    ])
  };
}

function expectSelectedAnchorsCoincide(
  source: SceneObjectData,
  target: SceneObjectData,
  result: ReturnType<typeof findObjectSurfaceSnap>
): void {
  expect(result.sourceAnchorId).toBeTruthy();
  expect(result.targetAnchorId).toBeTruthy();
  const snappedSource = withPosition(source, result.position);
  const sourceAnchor = worldAnchors(snappedSource)
    .find((anchor) => anchor.id === result.sourceAnchorId);
  const targetAnchor = worldAnchors(target)
    .find((anchor) => anchor.id === result.targetAnchorId);
  expect(sourceAnchor).toBeDefined();
  expect(targetAnchor).toBeDefined();
  expect(sourceAnchor?.position.distanceTo(targetAnchor?.position ?? new THREE.Vector3()))
    .toBeLessThan(0.00001);
}

const placeSourceRightOfTarget = (
  source: SceneObjectData,
  targetBounds: THREE.Box3,
  gap: number = GAP
): SceneObjectData => {
  const sourceBounds = worldBoundsFromSceneObject(source);
  if (!sourceBounds) throw new Error(`Keine Bounds für ${source.type}`);

  return withPosition(source, [
    source.position[0] + targetBounds.max.x + gap - sourceBounds.min.x,
    source.position[1],
    source.position[2]
  ]);
};

const expectPositiveXContact = (
  source: SceneObjectData,
  targetBounds: THREE.Box3,
  resultPosition: Vec3
): void => {
  const snappedBounds = worldBoundsFromSceneObject(withPosition(source, resultPosition));
  expect(snappedBounds).not.toBeNull();
  expect(snappedBounds?.min.x).toBeCloseTo(targetBounds.max.x, 5);
};

describe.each(['Desktop', 'Android'])('allgemeiner Oberflächen-Snap auf %s', (platform) => {
  it.each(SHAPE_DEFINITIONS)(
    `verschiebt '$label' auf ${platform} an einen sichtbaren Apfelschneider-Punkt`,
    ({ type }) => {
      const target = createSceneObject(type);
      target.id = `${platform}-target-${type}`;
      const pair = positionedPair(createSceneObject(type), target);
      pair.source.id = `${platform}-source-${type}`;
      const result = findObjectSurfaceSnap(pair.source, [target], STEP);

      expect(result.targetId).toBe(target.id);
      expect(result.distance).toBeLessThanOrEqual(STEP * 2);
      expectSelectedAnchorsCoincide(pair.source, target, result);
    }
  );
});

describe('Skalier-Snap für alle registrierten Elemente', () => {
  it.each(SHAPE_DEFINITIONS)("skaliert '$label' bis an einen Zielpunkt", ({ type }) => {
    const storedSource = createSceneObject(type);
    storedSource.id = `scale-source-${type}`;

    const geometry = createGeometry(storedSource);
    geometry.computeBoundingBox();
    const localBounds = geometry.boundingBox?.clone();
    geometry.dispose();
    expect(localBounds).toBeDefined();
    if (!localBounds) return;

    const nextScale = 1.2;
    const candidate: SceneObjectData = {
      ...storedSource,
      position: [
        storedSource.position[0] + localBounds.min.x * (1 - nextScale),
        storedSource.position[1],
        storedSource.position[2]
      ],
      scale: [nextScale, storedSource.scale[1], storedSource.scale[2]]
    };
    const target = createSceneObject(type);
    target.id = `scale-target-${type}`;
    const pair = bestOpposingPair(
      worldAnchors(candidate),
      worldAnchors(target),
      type
    );
    const desiredTargetAnchor = pair.sourceAnchor.position.clone()
      .addScaledVector(pair.sourceAnchor.normal, GAP);
    const targetTranslation = desiredTargetAnchor.sub(pair.targetAnchor.position);
    target.position = [
      target.position[0] + targetTranslation.x,
      target.position[1] + targetTranslation.y,
      target.position[2] + targetTranslation.z
    ];

    const result = findObjectSurfaceSnap(candidate, [storedSource, target], STEP);

    expect(result.targetId).toBe(target.id);
    expectSelectedAnchorsCoincide(candidate, target, result);
  });
});

describe('Vorbereitung für importierte Objekte', () => {
  it('verwendet importierte Object3D-Hierarchien als Ziel derselben Snap-Instanz', () => {
    const root = new THREE.Group();
    root.position.set(4, 0, 0);
    const child = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    child.position.set(0, 1, 0);
    root.add(child);

    const importedTarget = surfaceSnapTargetFromObject3D(root, 'imported-target');
    expect(importedTarget).not.toBeNull();
    if (!importedTarget) return;

    const targetBounds = importedTarget.localBounds.clone().applyMatrix4(importedTarget.matrixWorld);
    const source = placeSourceRightOfTarget(createSceneObject('box'), targetBounds);
    source.id = 'import-source';
    const result = findObjectSurfaceSnap(source, [], STEP, [importedTarget]);

    expect(result.targetId).toBe(importedTarget.id);
    expectPositiveXContact(source, targetBounds, result.position);
    child.geometry.dispose();
  });

  it.each(SHAPE_DEFINITIONS)("filtert '$label' nicht mehr nach Typ", ({ type }) => {
    expect(isFormType(type)).toBe(true);
  });
});
