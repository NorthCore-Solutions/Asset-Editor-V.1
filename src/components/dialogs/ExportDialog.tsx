import { useMemo, useState } from 'react';
import { exportGlb, inspectExport } from '../../export/exportScene';
import { useEditorStore } from '../../store/editorStore';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const objects = useEditorStore((state) => state.objects);
  const selectedId = useEditorStore((state) => state.selectedId);
  const projectName = useEditorStore((state) => state.project.name);
  const setMessage = useEditorStore((state) => state.setMessage);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [filename, setFilename] = useState(projectName);
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => inspectExport(objects, selectedId, selectionOnly), [objects, selectedId, selectionOnly]);

  const runExport = async () => {
    if (report.objects.length === 0) { setMessage('Export abgebrochen: keine sichtbaren Objekte'); return; }
    setBusy(true);
    try {
      const blob = await exportGlb(report.objects, filename);
      setMessage(`GLB exportiert: ${(blob.size / 1024).toFixed(1)} KB`);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? `GLB-Export fehlgeschlagen: ${error.message}` : 'GLB-Export fehlgeschlagen');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="GLB exportieren">
        <h2>GLB exportieren</h2>
        <div className="modal-content">
          <div className="field-row"><label>Dateiname</label><input value={filename} onChange={(event) => setFilename(event.target.value)} /></div>
          <div className="field-row"><label>Umfang</label><select value={selectionOnly ? 'selection' : 'scene'} onChange={(event) => setSelectionOnly(event.target.value === 'selection')}><option value="scene">Gesamte sichtbare Szene</option><option value="selection">Nur Auswahl</option></select></div>
          <div className="export-report"><strong>{report.objects.length}</strong> Objekte · <strong>{report.triangles.toLocaleString('de-DE')}</strong> Dreiecke</div>
          {report.warnings.length > 0 && <ul className="warning-list">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <p>Transformationen und Materialien werden eingebettet. Raster, Achsen und Editor-Helfer werden nicht exportiert.</p>
        </div>
        <div className="modal-actions"><button onClick={onClose}>Abbrechen</button><button disabled={busy || report.objects.length === 0} onClick={() => void runExport()}>{busy ? 'Export läuft…' : 'GLB speichern'}</button></div>
      </div>
    </div>
  );
}
