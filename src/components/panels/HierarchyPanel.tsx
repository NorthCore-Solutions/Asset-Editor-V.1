import { useEditorStore } from '../../store/editorStore';

export function HierarchyPanel() {
  const objects = useEditorStore((state) => state.objects);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const updateObject = useEditorStore((state) => state.updateObject);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const groupSelection = useEditorStore((state) => state.groupSelection);
  const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
  const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
  const canUngroup = selectedObjects.some((object) => Boolean(object.parentId));

  return (
    <section className="panel hierarchy">
      <div className="panel-header hierarchy-header">
        <span>Objektliste</span>
        <div className="hierarchy-actions">
          <button disabled={selectedIds.length < 2} onClick={groupSelection}>Gruppieren</button>
          <button disabled={!canUngroup} onClick={ungroupSelection}>Aufheben</button>
          <span>{objects.length} Objekte</span>
        </div>
      </div>
      {objects.length === 0 ? <div className="empty-state">Füge links eine Form hinzu.</div> : (
        <table className="object-list">
          <thead><tr><th style={{ width: 36 }}>S</th><th style={{ width: 36 }}>L</th><th>Name</th><th style={{ width: 120 }}>Typ</th><th style={{ width: 105 }}>Aktionen</th></tr></thead>
          <tbody>
            {objects.map((object) => (
              <tr
                key={object.id}
                className={selectedIds.includes(object.id) ? 'selected' : ''}
                onClick={(event) => select(object.id, event.shiftKey)}
              >
                <td><button className="icon-button" title="Sichtbarkeit" onClick={(event) => { event.stopPropagation(); updateObject(object.id, { visible: !object.visible }); }}>{object.visible ? '●' : '○'}</button></td>
                <td><button className="icon-button" title="Sperren" onClick={(event) => { event.stopPropagation(); updateObject(object.id, { locked: !object.locked }); }}>{object.locked ? '🔒' : '–'}</button></td>
                <td><input value={object.name} onClick={(event) => event.stopPropagation()} onChange={(event) => updateObject(object.id, { name: event.target.value })} /></td>
                <td>{object.parentId ? `${object.type} · Gruppe` : object.type}</td>
                <td>
                  <button className="icon-button" title="Duplizieren" onClick={(event) => { event.stopPropagation(); duplicateObject(object.id); }}>D</button>{' '}
                  <button className="icon-button danger" title="Löschen" onClick={(event) => { event.stopPropagation(); deleteObject(object.id); }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
