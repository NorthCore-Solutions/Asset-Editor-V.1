import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGeometry, createSceneObject } from '../src/geometry/factory';
import { APPLE_CUTTER_CELL_SIZE } from '../src/editor/appleCutter/appleCutterAxisGrid';
import { surfaceSnapTargetFromSceneObject } from '../src/editor/snapping/objectSurfaceSnap';
import { buildGeometrySurfaceSnapAnchors } from '../src/editor/snapping/surfaceSnapTopology';
import { buildGeometrySupportPoints } from '../src/editor/snapping/surfaceSupport';

describe('Trennung von Apfelschneider-Punkten und Oberflächenstützen', () => {
  it('erzeugt bei einer normalen 1,0-Form keinen zusätzlichen Mittelpunkt-Snap', () => {
    const object = createSceneObject('box');
    const geometry = createGeometry(object);
    const anchors = buildGeometrySurfaceSnapAnchors(
      geometry,
      APPLE_CUTTER_CELL_SIZE,
      new THREE.Vector3(1, 1, 1)
    );

    expect(anchors.some((anchor) => (
      Math.abs(anchor.position.x - 0.5) < 0.000001
      && Math.abs(anchor.position.y) < 0.000001
      && Math.abs(anchor.position.z) < 0.000001
    ))).toBe(false);

    geometry.dispose();
  });

  it('behält bei einer Form unter 0,25 eine symmetrische Oberflächenabtastung', () => {
    const object = createSceneObject('sphere');
    const geometry = createGeometry(object);
    const anchors = buildGeometrySurfaceSnapAnchors(
      geometry,
      APPLE_CUTTER_CELL_SIZE,
      new THREE.Vector3(0.1, 0.1, 0.1)
    );

    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.some((anchor) => Math.abs(anchor.normal.x) > 0.9)).toBe(true);
    expect(anchors.some((anchor) => Math.abs(anchor.normal.y) > 0.9)).toBe(true);
    expect(anchors.some((anchor) => Math.abs(anchor.normal.z) > 0.9)).toBe(true);

    geometry.dispose();
  });

  it('führt reale Mesh-Extrema nur als unsichtbare Oberflächenstützen', () => {
    const object = createSceneObject('sphere');
    const geometry = createGeometry(object);
    const anchors = buildGeometrySurfaceSnapAnchors(
      geometry,
      APPLE_CUTTER_CELL_SIZE,
      new THREE.Vector3(1, 1, 1)
    );
    const supportPoints = buildGeometrySupportPoints(geometry);
    const radius = object.geometry.radius ?? 0.65;

    expect(anchors.some((anchor) => (
      Math.abs(anchor.position.x - radius) < 0.000001
      && Math.abs(anchor.position.y) < 0.000001
      && Math.abs(anchor.position.z) < 0.000001
    ))).toBe(false);
    expect(supportPoints.some((point) => (
      Math.abs(point.x - radius) < 0.000001
      && Math.abs(point.y) < 0.000001
      && Math.abs(point.z) < 0.000001
    ))).toBe(true);

    geometry.dispose();
  });

  it('liefert dem Solver Stützpunkte, ohne sie als sichtbare Anker auszugeben', () => {
    const object = createSceneObject('sphere');
    const target = surfaceSnapTargetFromSceneObject(object);
    const radius = object.geometry.radius ?? 0.65;

    expect(target).not.toBeNull();
    expect(target?.supportPoints?.some((point) => (
      Math.abs(point.x - radius) < 0.000001
      && Math.abs(point.y) < 0.000001
      && Math.abs(point.z) < 0.000001
    ))).toBe(true);
    expect(target?.anchors.some((anchor) => (
      Math.abs(anchor.position.x - radius) < 0.000001
      && Math.abs(anchor.position.y) < 0.000001
      && Math.abs(anchor.position.z) < 0.000001
    ))).toBe(false);
  });
});
