import { useMemo } from 'react';
import { triangleCount } from '../../geometry/factory';
import { useEditorStore } from '../../store/editorStore';

export function StatusBar() {
  const objects = useEditorStore((state) => state.objects);
  const selectedId = useEditorStore((state) => state.selectedId);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const dirty = useEditorStore((state) => state.dirty);
  const message = useEditorStore((state) => state.message);
  const selected = objects.find((object) => object.id === selectedId);
  const triangles = useMemo(
    () => objects.filter((object) => object.visible).reduce((sum, object) => sum + triangleCount(object), 0),
    [objects]
  );
  return (
    <footer className="statusbar">
      <span>Objekte: {objects.length}</span><span>Auswahl: {selected?.name ?? '–'}</span><span>Dreiecke: {triangles.toLocaleString('de-DE')}</span>
      <span>Werkzeug: {tool}</span><span>Snapping: {snap.enabled ? 'an' : 'aus'}</span><span className={dirty ? 'unsaved' : ''}>{dirty ? 'Ungespeichert' : 'Gespeichert'}</span>
      <span className="message">{message}</span>
    </footer>
  );
}
