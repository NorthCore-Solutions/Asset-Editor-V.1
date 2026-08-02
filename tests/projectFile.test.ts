import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../src/geometry/factory';
import { deserializeProject, serializeProject } from '../src/persistence/projectFile';

const project = { name: 'Testhaus', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' };
const scene = { background: '#11161A', gridVisible: true, axesVisible: true, gridSize: 1 };

describe('Projektformat', () => {
  it('serialisiert und deserialisiert Projekte', () => {
    const objects = [createSceneObject('wall')];
    const text = serializeProject({ project, scene, objects });
    const parsed = deserializeProject(text);
    expect(parsed.project.name).toBe('Testhaus');
    expect(parsed.objects[0]?.type).toBe('wall');
  });

  it('lehnt ungültige Projektdateien verständlich ab', () => {
    expect(() => deserializeProject('{ kaputt')).toThrow('kein gültiges JSON');
    expect(() => deserializeProject(JSON.stringify({ format: 'falsch', version: 1 }))).toThrow('Unbekanntes Projektformat');
  });

  it('lehnt unbekannte Formtypen und ungültige Materialwerte ab', () => {
    const object = createSceneObject('box');
    const unknownType = serializeProject({ project, scene, objects: [{ ...object, type: 'script' as typeof object.type }] });
    expect(() => deserializeProject(unknownType)).toThrow('Unbekannter Typ');

    const invalidMaterial = serializeProject({ project, scene, objects: [{ ...object, material: { ...object.material, opacity: 2 } }] });
    expect(() => deserializeProject(invalidMaterial)).toThrow('Materialwerte');
  });
});
