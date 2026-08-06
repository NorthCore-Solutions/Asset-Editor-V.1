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

interface SnapPair {
  source: SceneObjectData;
  targetAnchor: SurfaceSnapAnchor;
  sourceAnchorId: string;
}

function worldAnchors(object: SceneObjectData): SurfaceSnapAnchor[] {
  const target = surfaceSnapTargetFromSceneObject(object);
  if (!target) throw new Error(`Keine Snap-Topologie für ${object.type}`);
  return transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
}

function rightFacingPair(
  source: SceneObjectData,
  target: SceneObjectData,
  gap: number = GAP
): SnapPair {
  const targetAnchors = worldAnchors(target)
    .filter((anchor) => anchor.normal.x > 0.35);
  const sourceAnchors = worldAnchors(source)
    .filter((anchor) => anchor.normal.x < -0.35);
  if (targetAnchors.length === 0 || sourceAnchors.length === 0) {
    throw new Error(`Kein seitliches Punktpaar für ${target.type}`);
  }

  let bestTarget = targetAnchors[0];
  let bestSource = sourceAnchors[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const targetAnchor of targetAnchors) {
    for (const sourceAnchor of sourceAnchors) {
      const normalScore = 1 + targetAnchor.normal.dot(sourceAnchor.normal);
      const tangentialScore = Math.hypot(
        targetAnchor.position.y - sourceAnchor.position.y,
        targetAnchor.position.z - sourceAnchor.position.z
      );
      const score = normalScore * 10 + tangentialScore;
      if (score >= bestScore) continue;
      bestScore = score;
      bestTarget = targetAnchor;
      bestSource = sourceAnchor;
    }
  }
  if (!bestTarget || !bestSource?.id) {
    throw new Error(`Ungültiges Punktpaar für ${target.type}`);
  }

  const desiredSourceAnchor = bestTarget.position.clone()
    .addScaledVector(bestTarget.normal, gap);
  const translation = desiredSourceAnchor.sub(bestSource.position);
  return {
    source: withPosition(source, [
      source.position[0] + translation.x,
      source.position[1] + translation.y,
      source.position[2] + translation.z
    ]),
    targetAnchor: bestTarget,
    sourceAnchorId: bestSource.id
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
      const pair = rightFacingPair(createSceneObject(type), target);
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

    const candidateAnchors = worldAnchors(candidate)
      .filter((anchor) => anchor.normal.x > 0.35);
    const targetAnchors = worldAnchors(target)
      .filter((anchor) => anchor.normal.x < -0.35);
    if (candidateAnchors.length === 0 || targetAnchors.length === 0) {
      throw new Error(`Kein Skalier-Punktpaar für ${type}`);
    }

    let sourceAnchor = candidateAnchors[0];
    let targetAnchor = targetAnchors[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidateAnchor of candidateAnchors) {
      for (const candidateTarget of targetAnchors) {
        const score = (1 + candidateAnchor.normal.dot(candidateTarget.normal)) * 10
          + Math.hypot(
            candidateAnchor.position.y - candidateTarget.position.y,
            candidateAnchor.position.z - candidateTarget.position.z
          );
        if (score >= bestScore) continue;
        bestScore = score;
        sourceAnchor = candidateAnchor;
        targetAnchor = candidateTarget;
      }
    }
    if (!sourceAnchor || !targetAnchor) throw new Error(`Ungültiges Skalier-Punktpaar für ${type}`);

    const desiredTargetAnchor = sourceAnchor.position.clone()
      .addScaledVector(sourceAnchor.normal, GAP);
    const targetTranslation = desiredTargetAnchor.sub(targetAnchor.position);
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
