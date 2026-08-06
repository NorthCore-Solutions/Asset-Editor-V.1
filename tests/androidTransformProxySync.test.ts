import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneObject } from '../src/geometry/factory';
import {
  syncDraggingTranslateProxy,
  worldPivotForSceneObject
} from '../src/editor/viewport/androidTransformProxySync';

describe('Android-Transform-Proxy-Synchronisierung', () => {
  it('berechnet den Welt-Pivot aus Geometriezentrum und Objekttransformation', () => {
    const object = createSceneObject('hemisphere');
    object.position = [2, 3, -1];
    object.rotation = [0, Math.PI / 2, 0];
    object.scale = [2, 1.5, 0.5];

    const pivot = worldPivotForSceneObject(object);

    expect(Number.isFinite(pivot.x)).toBe(true);
    expect(Number.isFinite(pivot.y)).toBe(true);
    expect(Number.isFinite(pivot.z)).toBe(true);
    expect(pivot.distanceTo(new THREE.Vector3(...object.position))).toBeGreaterThan(0);
  });

  it('setzt nur einen aktiv gezogenen Übersetzungs-Proxy auf den akzeptierten Pivot', () => {
    const scene = new THREE.Scene();
    const proxy = new THREE.Object3D();
    proxy.position.set(8, 4, -3);
    const controls = Object.assign(new THREE.Object3D(), {
      dragging: true,
      mode: 'translate',
      object: proxy
    });
    scene.add(controls);

    const acceptedPivot = new THREE.Vector3(1.25, 2.5, -0.75);
    const synchronized = syncDraggingTranslateProxy(scene, acceptedPivot);

    expect(synchronized).toBe(true);
    expect(proxy.position.toArray()).toEqual(acceptedPivot.toArray());
  });

  it('verändert keinen inaktiven oder rotierenden Transform-Proxy', () => {
    const scene = new THREE.Scene();
    const proxy = new THREE.Object3D();
    proxy.position.set(3, 2, 1);
    const controls = Object.assign(new THREE.Object3D(), {
      dragging: true,
      mode: 'rotate',
      object: proxy
    });
    scene.add(controls);

    const synchronized = syncDraggingTranslateProxy(
      scene,
      new THREE.Vector3(9, 9, 9)
    );

    expect(synchronized).toBe(false);
    expect(proxy.position.toArray()).toEqual([3, 2, 1]);
  });
});
