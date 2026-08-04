import { beforeEach, describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import { deserializeProject, serializeProject } from '../src/persistence/projectFile';
import { useEditorStore } from '../src/store/editorStore';
import type { PaintTextureData, ProjectFile } from '../src/types/editor';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PROJECT_META = {
  name: 'Bemaltes Asset',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z'
};
const SCENE = {
  background: '#11161A',
  gridVisible: true,
  axesVisible: true,
  gridSize: 1
};

function createPaintTexture(): PaintTextureData {
  const labels = ['Rechts', 'Links', 'Oben', 'Unten', 'Vorne', 'Hinten'];

  return {
    dataUrl: PNG_DATA_URL,
    width: 108,
    height: 72,
    pixelated: true,
    surfaceGrid: {
      version: 1,
      atlasSignature: 'groups:6:3x2:Rechts|Links|Oben|Unten|Vorne|Hinten',
      pixelsPerWorldUnit: 32,
      baseColor: '#AEB8BE',
      surfaces: labels.map((label) => ({
        label,
        width: 32,
        height: 32,
        coverageU: 1,
        coverageV: 1,
        sourceWidth: 32,
        sourceHeight: 32
      })),
      sourceDataUrl: PNG_DATA_URL,
      sourceWidth: 108,
      sourceHeight: 72
    }
  };
}

function createPaintedProject(): ProjectFile {
  const object = createSceneObject('box');
  object.material.paintTexture = createPaintTexture();

  return {
    format: 'northcore-asset-editor',
    version: 1,
    project: PROJECT_META,
    scene: SCENE,
    objects: [object]
  };
}

beforeEach(() => {
  useEditorStore.getState().newProject('Test');
});

describe('Persistenz bemalter Objekte', () => {
  it('behält die vollständige Bemalung beim JSON-Rundlauf und Autosave-Wiederherstellen', () => {
    const source = createPaintedProject();
    const json = serializeProject({
      project: source.project,
      scene: source.scene,
      objects: source.objects
    });
    const restored = deserializeProject(json);

    expect(restored.objects[0]?.material.paintTexture).toEqual(
      source.objects[0]?.material.paintTexture
    );
    expect(restored.objects[0]?.material.paintTexture?.surfaceGrid?.surfaces).toHaveLength(6);
    expect(restored.objects[0]?.material.paintTexture?.surfaceGrid?.sourceDataUrl).toBe(PNG_DATA_URL);
  });

  it('dupliziert die Bemalung eines aktuellen Objekts vollständig und unabhängig', () => {
    const project = createPaintedProject();
    useEditorStore.getState().loadProject(project);

    const source = useEditorStore.getState().objects[0];
    expect(source).toBeDefined();
    useEditorStore.getState().duplicateObject(source!.id);

    const objects = useEditorStore.getState().objects;
    const duplicate = objects.find((object) => object.id !== source!.id);

    expect(duplicate?.material.paintTexture).toEqual(source!.material.paintTexture);
    expect(duplicate?.material.paintTexture).not.toBe(source!.material.paintTexture);
    expect(duplicate?.material.paintTexture?.surfaceGrid).not.toBe(
      source!.material.paintTexture?.surfaceGrid
    );
    expect(duplicate?.material.paintTexture?.surfaceGrid?.surfaces).not.toBe(
      source!.material.paintTexture?.surfaceGrid?.surfaces
    );
  });

  it('dupliziert auch eine aus JSON wiederhergestellte Bemalung', () => {
    const source = createPaintedProject();
    const restored = deserializeProject(serializeProject({
      project: source.project,
      scene: source.scene,
      objects: source.objects
    }));
    useEditorStore.getState().loadProject(restored);

    const restoredObject = useEditorStore.getState().objects[0];
    expect(restoredObject?.material.paintTexture).toBeDefined();
    useEditorStore.getState().duplicateObject(restoredObject!.id);

    const duplicate = useEditorStore.getState().objects.find(
      (object) => object.id !== restoredObject!.id
    );

    expect(duplicate?.material.paintTexture).toEqual(restoredObject!.material.paintTexture);
    expect(duplicate?.material.paintTexture?.surfaceGrid?.sourceDataUrl).toBe(PNG_DATA_URL);
  });
});
