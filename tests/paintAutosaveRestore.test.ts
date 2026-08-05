import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import { deserializeProject, serializeProject } from '../src/persistence/projectFile';

const project = {
  name: 'Bemaltes Projekt',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z'
};

const scene = {
  background: '#11161A',
  gridVisible: true,
  axesVisible: true,
  gridSize: 1
};

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

describe('Autosave-Wiederherstellung bemalter Formen', () => {
  it('akzeptiert und erhält Flächenraster-Version 2', () => {
    const object = createSceneObject('box');
    object.material.paintTexture = {
      dataUrl: pngDataUrl,
      width: 2,
      height: 2,
      pixelated: true,
      surfaceGrid: {
        version: 2,
        atlasSignature: 'box:2x2',
        pixelsPerWorldUnit: 4,
        baseColor: '#FFFFFF',
        surfaces: [{
          label: 'Vorne',
          width: 2,
          height: 2,
          coverageU: 1,
          coverageV: 1,
          sourceWidth: 2,
          sourceHeight: 2
        }],
        sourceDataUrl: pngDataUrl,
        sourceWidth: 2,
        sourceHeight: 2
      }
    };

    const restored = deserializeProject(serializeProject({ project, scene, objects: [object] }));
    const surfaceGrid = restored.objects[0]?.material.paintTexture?.surfaceGrid;

    expect(surfaceGrid?.version).toBe(2);
    expect(surfaceGrid?.sourceDataUrl).toBe(pngDataUrl);
    expect(restored.objects[0]?.material.paintTexture?.dataUrl).toBe(pngDataUrl);
  });

  it('unterstützt weiterhin ältere Flächenraster-Version 1', () => {
    const object = createSceneObject('box');
    object.material.paintTexture = {
      dataUrl: pngDataUrl,
      width: 1,
      height: 1,
      pixelated: true,
      surfaceGrid: {
        version: 1,
        atlasSignature: 'legacy',
        pixelsPerWorldUnit: 1,
        surfaces: [{ label: 'Vorne', width: 1, height: 1, coverageU: 1, coverageV: 1 }]
      }
    };

    const restored = deserializeProject(serializeProject({ project, scene, objects: [object] }));
    expect(restored.objects[0]?.material.paintTexture?.surfaceGrid?.version).toBe(1);
  });
});
