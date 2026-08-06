import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import { surfaceSnapTargetFromSceneObject } from '../src/editor/snapping/objectSurfaceSnap';

describe('Apfelschneider-Achse dünner Ebenen', () => {
  it('verwendet die tatsächliche Y-Normale statt einer festen X-Ziehrichtung', () => {
    const plane = createSceneObject('plane');
    const target = surfaceSnapTargetFromSceneObject(plane);

    expect(target).not.toBeNull();
    expect(target?.anchors.length).toBeGreaterThan(0);
    expect(target?.anchors.every((anchor) => Math.abs(anchor.normal.y) > 0.9)).toBe(true);
    expect(target?.anchors.some((anchor) => Math.abs(anchor.normal.x) > 0.35)).toBe(false);
  });
});
