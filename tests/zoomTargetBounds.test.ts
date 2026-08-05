import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import type { SceneObjectData } from '../src/types/editor';
import {
  combineWorldBounds,
  worldBoundsFromObject3D,
  worldBoundsFromSceneObject,
  zoomTargetFromWorldBounds
} from '../src/editor/viewport/zoomTargetBounds';

const material: SceneObjectData['material'] = {
  color: '#ffffff',
  roughness: 0.8,
  metalness: 0,
  opacity: 1,
  flatShading: true
};

describe('allgemeine Zoom-Zielgrenzen', () => {
  it.each(SHAPE_DEFINITIONS)('berechnet Grenzen für $label', ({ type }) => {
    const object = createSceneObject(type);
    const bounds = worldBoundsFromSceneObject(object);

    expect(bounds).not.toBeNull();
    expect(bounds?.isEmpty()).toBe(false);
  });

  it('nutzt bei asymmetrischer Geometrie den tatsächlichen Mittelpunkt', () => {
    const object: SceneObjectData = {
      id: 'wedge',
      name: 'Keil',
      type: 'wedge',
      visible: true,
      locked: false,
      position: [10, 20, 30],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      geometry: { width: 2, height: 4, depth: 6 },
      material
    };

    const bounds = worldBoundsFromSceneObject(object);
    const center = bounds?.getCenter(new THREE.Vector3());

    expect(center?.toArray()).toEqual([10, 22, 30]);
  });

  it('kombiniert mehrere ausgewählte Elemente zu einem gemeinsamen Ziel', () => {
    const combined = combineWorldBounds([
      new THREE.Box3(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(0, 2, 1)),
      new THREE.Box3(new THREE.Vector3(4, 1, -3), new THREE.Vector3(8, 5, 3))
    ]);

    expect(combined?.min.toArray()).toEqual([-2, 0, -3]);
    expect(combined?.max.toArray()).toEqual([8, 5, 3]);
  });

  it('unterstützt importierte Object3D-Hierarchien ohne Form-Sonderfall', () => {
    const root = new THREE.Group();
    root.position.set(5, 0, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6));
    mesh.position.set(0, 2, 0);
    root.add(mesh);

    const bounds = worldBoundsFromObject3D(root);
    const center = bounds?.getCenter(new THREE.Vector3());

    expect(center?.toArray()).toEqual([5, 2, 0]);
    mesh.geometry.dispose();
  });

  it('stoppt abhängig von der tatsächlichen Ausdehnung vor der Oberfläche', () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-2, -1, -0.5),
      new THREE.Vector3(2, 1, 0.5)
    );
    const target = zoomTargetFromWorldBounds(bounds, new THREE.Vector3(1, 0, 0), 0.05);

    expect(target.focus.toArray()).toEqual([0, 0, 0]);
    expect(target.minimumDepth).toBeCloseTo(2.1);
  });
});
