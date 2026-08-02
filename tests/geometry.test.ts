import { describe, expect, it } from 'vitest';
import { createGeometry, createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';

describe('Geometriefabrik', () => {
  it('erzeugt eine Standardform mit sinnvollen Werten', () => {
    const object = createSceneObject('box');
    expect(object.type).toBe('box');
    expect(object.name).toBe('Würfel');
    expect(object.position).toEqual([0, 0.5, 0]);
    expect(object.material.color).toBe('#AEB8BE');
  });

  it('erzeugt eindeutige Objekt-IDs', () => {
    const first = createSceneObject('box');
    const second = createSceneObject('sphere', [first.id]);
    expect(second.id).not.toBe(first.id);
  });

  it('erzeugt für alle Bibliotheksformen eine nichtleere Geometrie', () => {
    for (const shape of SHAPE_DEFINITIONS) {
      const object = createSceneObject(shape.type);
      const geometry = createGeometry(object);
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
      geometry.dispose();
    }
  });
});
