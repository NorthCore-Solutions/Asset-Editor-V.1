import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../src/store/editorStore';

beforeEach(() => {
  useEditorStore.getState().newProject('Test');
});

describe('Editor-Store', () => {
  it('dupliziert und löscht Objekte', () => {
    const store = useEditorStore.getState();
    store.addObject('box');
    const original = useEditorStore.getState().objects[0];
    expect(original).toBeDefined();
    store.duplicateObject(original?.id);
    expect(useEditorStore.getState().objects).toHaveLength(2);
    expect(useEditorStore.getState().objects[1]?.id).not.toBe(original?.id);
    store.deleteObject(original?.id);
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });

  it('aktualisiert Transformationen und Materialwerte', () => {
    const store = useEditorStore.getState();
    store.addObject('box');
    const id = useEditorStore.getState().objects[0]?.id;
    expect(id).toBeDefined();
    if (!id) return;
    store.updateTransform(id, 'position', [1, 2, 3]);
    store.updateMaterial(id, { roughness: 0.25, color: '#123456' });
    const object = useEditorStore.getState().objects[0];
    expect(object?.position).toEqual([1, 2, 3]);
    expect(object?.material.roughness).toBe(0.25);
    expect(object?.material.color).toBe('#123456');
  });

  it('führt History Undo und Redo aus', () => {
    const store = useEditorStore.getState();
    store.addObject('box');
    expect(useEditorStore.getState().objects).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().objects).toHaveLength(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });
});
