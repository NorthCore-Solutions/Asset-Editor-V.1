import { describe, expect, it } from 'vitest';
import { filterExportObjects, inspectExport } from '../src/export/exportScene';
import { createSceneObject } from '../src/geometry/factory';

describe('Exportfilter', () => {
  it('schließt unsichtbare Objekte aus', () => {
    const visible = createSceneObject('box');
    const hidden = { ...createSceneObject('sphere'), visible: false };
    expect(filterExportObjects([visible, hidden], null, false)).toEqual([visible]);
  });

  it('exportiert bei Auswahlmodus nur die Auswahl', () => {
    const first = createSceneObject('box');
    const second = createSceneObject('sphere');
    expect(filterExportObjects([first, second], second.id, true)).toEqual([second]);
  });

  it('warnt bei Geometrie unterhalb der Bodenebene', () => {
    const object = { ...createSceneObject('box'), position: [0, 0.2, 0] as [number, number, number] };
    expect(inspectExport([object], null, false).warnings).toContain('Mindestens ein Objekt liegt teilweise unterhalb der Bodenebene.');
  });
});
