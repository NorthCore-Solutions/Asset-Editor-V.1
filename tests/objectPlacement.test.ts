import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import {
  findAvailableBoundsTranslation,
  findAvailableObjectPlacement,
  placementBoundsPenetrate,
  placementObstacleFromObject3D
} from '../src/editor/placement/objectPlacement';
import {
  translatedWorldBounds,
  worldBoundsFromSceneObject
} from '../src/editor/spatial/worldBounds';
import { useEditorStore } from '../src/store/editorStore';

beforeEach(() => {
  useEditorStore.getState().newProject('Platzierungstest');
});

describe('allgemeine Objektplatzierung', () => {
  it.each(SHAPE_DEFINITIONS)('platziert $label neben einem gleichen Element', ({ type }) => {
    const target = createSceneObject(type);
    const source = createSceneObject(type, [target.id]);
    const position = findAvailableObjectPlacement(source, [target], 0.25, target.id);
    const placed = { ...source, position };
    const targetBounds = worldBoundsFromSceneObject(target);
    const placedBounds = worldBoundsFromSceneObject(placed);

    expect(targetBounds).not.toBeNull();
    expect(placedBounds).not.toBeNull();
    if (!targetBounds || !placedBounds) return;
    expect(placementBoundsPenetrate(placedBounds, targetBounds)).toBe(false);
    expect(position).not.toEqual(source.position);
  });

  it.each(SHAPE_DEFINITIONS)('dupliziert $label im Store ohne Überschneidung', ({ type }) => {
    const store = useEditorStore.getState();
    store.addObject(type);
    const original = useEditorStore.getState().objects[0];
    expect(original).toBeDefined();
    if (!original) return;

    useEditorStore.getState().duplicateObject(original.id);
    const [storedOriginal, duplicate] = useEditorStore.getState().objects;
    const originalBounds = storedOriginal ? worldBoundsFromSceneObject(storedOriginal) : null;
    const duplicateBounds = duplicate ? worldBoundsFromSceneObject(duplicate) : null;

    expect(duplicate).toBeDefined();
    expect(originalBounds).not.toBeNull();
    expect(duplicateBounds).not.toBeNull();
    if (!originalBounds || !duplicateBounds) return;
    expect(placementBoundsPenetrate(duplicateBounds, originalBounds)).toBe(false);
  });

  it('verschiebt eine Mehrfachduplikation als gemeinsamen Block', () => {
    const store = useEditorStore.getState();
    store.addObject('wall');
    store.addObject('stairs');
    const originals = useEditorStore.getState().objects;
    useEditorStore.getState().selectMany(originals.map((object) => object.id));
    useEditorStore.getState().duplicateObject();

    const state = useEditorStore.getState();
    const duplicates = state.objects.filter((object) => state.selectedIds.includes(object.id));
    expect(duplicates).toHaveLength(2);

    for (const duplicate of duplicates) {
      const duplicateBounds = worldBoundsFromSceneObject(duplicate);
      expect(duplicateBounds).not.toBeNull();
      if (!duplicateBounds) continue;

      for (const original of originals) {
        const originalBounds = worldBoundsFromSceneObject(original);
        expect(originalBounds).not.toBeNull();
        if (!originalBounds) continue;
        expect(placementBoundsPenetrate(duplicateBounds, originalBounds)).toBe(false);
      }
    }
  });

  it('behandelt flache Elemente als belegten Raum', () => {
    const plane = new THREE.Box3(
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 0, 1)
    );
    const samePlane = plane.clone();
    const boxAroundPlane = new THREE.Box3(
      new THREE.Vector3(-0.5, -1, -0.5),
      new THREE.Vector3(0.5, 1, 0.5)
    );
    const touchingBox = new THREE.Box3(
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 1, 0.5)
    );

    expect(placementBoundsPenetrate(plane, samePlane)).toBe(true);
    expect(placementBoundsPenetrate(plane, boxAroundPlane)).toBe(true);
    expect(placementBoundsPenetrate(plane, touchingBox)).toBe(false);
  });

  it('nutzt dieselbe Instanz für importierte Object3D-Hierarchien', () => {
    const targetRoot = new THREE.Group();
    const targetMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 2));
    targetMesh.position.y = 1;
    targetRoot.add(targetMesh);

    const sourceRoot = new THREE.Group();
    const sourceMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2));
    sourceMesh.position.y = 1.5;
    sourceRoot.add(sourceMesh);

    const target = placementObstacleFromObject3D(targetRoot, 'import-target');
    const source = placementObstacleFromObject3D(sourceRoot, 'import-source');
    expect(target).not.toBeNull();
    expect(source).not.toBeNull();
    if (!target || !source) return;

    const translation = findAvailableBoundsTranslation(
      source.bounds,
      [target],
      0.25,
      target.id
    );
    const placedBounds = translatedWorldBounds(source.bounds, translation);

    expect(placementBoundsPenetrate(placedBounds, target.bounds)).toBe(false);
    expect(translation.length()).toBeGreaterThan(0);

    targetMesh.geometry.dispose();
    sourceMesh.geometry.dispose();
  });
});
