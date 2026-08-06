import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  analyzeImportedObject3DSnapTargets,
  surfaceSnapTargetFromObject3D,
  surfaceSnapTargetFromSceneObjects
} from '../src/editor/snapping/objectSurfaceSnap';
import { transformSurfaceSnapAnchors } from '../src/editor/snapping/surfaceSnapTopology';
import type { SceneObjectData } from '../src/types/editor';

function boxAt(id: string, x: number): SceneObjectData {
  const object = createSceneObject('box');
  object.id = id;
  object.position = [x, 0.5, 0];
  return object;
}

describe('äußeres Apfelschneider-Raster', () => {
  it('entfernt die gemeinsame innere Kontaktfläche zweier Bauteile', () => {
    const left = boxAt('left', -0.5);
    const right = boxAt('right', 0.5);
    const target = surfaceSnapTargetFromSceneObjects([left, right], 'house');

    expect(target).not.toBeNull();
    if (!target) return;
    const worldAnchors = transformSurfaceSnapAnchors(target.anchors, target.matrixWorld);
    const internalSideAnchors = worldAnchors.filter((anchor) => (
      Math.abs(anchor.position.x) < 0.00001
      && Math.abs(anchor.normal.x) > 0.9
    ));

    expect(internalSideAnchors).toHaveLength(0);
    expect(worldAnchors.some((anchor) => (
      Math.abs(anchor.position.x + 1) < 0.00001
      && anchor.normal.x < -0.9
    ))).toBe(true);
    expect(worldAnchors.some((anchor) => (
      Math.abs(anchor.position.x - 1) < 0.00001
      && anchor.normal.x > 0.9
    ))).toBe(true);
  });

  it('verwendet bei gemeinsamer Translation dieselbe lokale Topologie wieder', () => {
    const firstObjects = [boxAt('left', -0.5), boxAt('right', 0.5)];
    const first = surfaceSnapTargetFromSceneObjects(firstObjects, 'cached-group');
    const translatedObjects = firstObjects.map((object) => ({
      ...object,
      position: [
        object.position[0] + 8,
        object.position[1] + 3,
        object.position[2] - 5
      ] as SceneObjectData['position']
    }));
    const second = surfaceSnapTargetFromSceneObjects(translatedObjects, 'cached-group');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.anchors).toBe(first?.anchors);
    expect(new THREE.Vector3().setFromMatrixPosition(second?.matrixWorld ?? new THREE.Matrix4()))
      .toEqual(new THREE.Vector3(8, 3.5, -5));
  });
});

describe('automatische Importvorbereitung', () => {
  it('behandelt direkte Mesh-Nodes als getrennte Komponenten plus äußere Hülle', () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2));
    wall.position.x = -0.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.7, 4));
    roof.position.set(0.4, 0.8, 0);
    root.add(wall, roof);

    const analysis = analyzeImportedObject3DSnapTargets(root, 'imported-house');

    expect(analysis.composite?.scope).toBe('composite');
    expect(analysis.composite?.anchors.length).toBeGreaterThan(0);
    expect(analysis.components).toHaveLength(2);
    expect(analysis.components.every((target) => target.scope === 'component')).toBe(true);
    expect(analysis.components.every((target) => target.anchors.length > 0)).toBe(true);
    expect(new Set(analysis.components.map((target) => target.id)).size).toBe(2);

    wall.geometry.dispose();
    roof.geometry.dispose();
  });

  it('erkennt explizite Top-Level-Gruppen als getrennte innere Komponenten', () => {
    const root = new THREE.Group();
    const walls = new THREE.Group();
    const roof = new THREE.Group();
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2));
    const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 4));
    walls.add(wallMesh);
    roof.add(roofMesh);
    root.add(walls, roof);

    const analysis = analyzeImportedObject3DSnapTargets(root, 'grouped-import');

    expect(analysis.composite?.scope).toBe('composite');
    expect(analysis.components).toHaveLength(2);
    expect(analysis.components.every((target) => target.scope === 'component')).toBe(true);
    expect(analysis.components.every((target) => target.anchors.length > 0)).toBe(true);

    wallMesh.geometry.dispose();
    roofMesh.geometry.dispose();
  });

  it('behält für ein einzelnes Root-Mesh genau ein Komponentenraster', () => {
    const root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));

    const analysis = analyzeImportedObject3DSnapTargets(root, 'single-mesh-import');

    expect(analysis.composite?.scope).toBe('composite');
    expect(analysis.components).toHaveLength(1);
    expect(analysis.components[0]?.scope).toBe('component');
    expect(analysis.components[0]?.anchors.length).toBeGreaterThan(0);

    root.geometry.dispose();
  });

  it('berechnet bei reiner Root-Translation die Importtopologie nicht neu', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10));
    root.add(mesh);
    const first = surfaceSnapTargetFromObject3D(root, 'cached-import');

    root.position.set(4, 2, -3);
    root.updateWorldMatrix(true, true);
    const second = surfaceSnapTargetFromObject3D(root, 'cached-import');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.anchors).toBe(first?.anchors);
    expect(new THREE.Vector3().setFromMatrixPosition(second?.matrixWorld ?? new THREE.Matrix4()))
      .toEqual(new THREE.Vector3(4, 2, -3));

    mesh.geometry.dispose();
  });
});
