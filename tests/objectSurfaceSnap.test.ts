import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGeometry, createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import {
  findObjectSurfaceSnap,
  surfaceSnapTargetFromObject3D
} from '../src/editor/snapping/objectSurfaceSnap';
import { isFormType } from '../src/editor/snapping/primitiveSurfaceSnap';
import { worldBoundsFromSceneObject } from '../src/editor/spatial/worldBounds';
import type { SceneObjectData, Vec3 } from '../src/types/editor';

const GAP = 0.05;
const STEP = 0.25;

const withPosition = (object: SceneObjectData, position: Vec3): SceneObjectData => ({
  ...object,
  position
});

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
    `verschiebt '$label' auf ${platform} an die Nachbarfläche`,
    ({ type }) => {
      const target = createSceneObject(type);
      target.id = `${platform}-target-${type}`;
      const targetBounds = worldBoundsFromSceneObject(target);
      expect(targetBounds).not.toBeNull();
      if (!targetBounds) return;

      const source = placeSourceRightOfTarget(createSceneObject(type), targetBounds);
      source.id = `${platform}-source-${type}`;
      const result = findObjectSurfaceSnap(source, [target], STEP);

      expect(result.targetId).toBe(target.id);
      expect(result.distance).toBeLessThanOrEqual(STEP * 2);
      expectPositiveXContact(source, targetBounds, result.position);
    }
  );
});

describe('Skalier-Snap für alle registrierten Elemente', () => {
  it.each(SHAPE_DEFINITIONS)("skaliert '$label' bis an die Zieloberfläche", ({ type }) => {
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
    const candidateBounds = worldBoundsFromSceneObject(candidate);
    expect(candidateBounds).not.toBeNull();
    if (!candidateBounds) return;

    const target = createSceneObject(type);
    target.id = `scale-target-${type}`;
    const initialTargetBounds = worldBoundsFromSceneObject(target);
    expect(initialTargetBounds).not.toBeNull();
    if (!initialTargetBounds) return;

    target.position = [
      target.position[0] + candidateBounds.max.x + GAP - initialTargetBounds.min.x,
      target.position[1],
      target.position[2]
    ];
    const targetBounds = worldBoundsFromSceneObject(target);
    expect(targetBounds).not.toBeNull();
    if (!targetBounds) return;

    const result = findObjectSurfaceSnap(candidate, [storedSource, target], STEP);
    const correctedBounds = worldBoundsFromSceneObject(withPosition(candidate, result.position));

    expect(result.targetId).toBe(target.id);
    expect(correctedBounds?.max.x).toBeCloseTo(targetBounds.min.x, 5);
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
