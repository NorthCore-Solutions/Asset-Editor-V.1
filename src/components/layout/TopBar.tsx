import { useRef, useState } from 'react';
import {
  setEdgeFreePreview,
  useEdgeFreePreview
} from '../../editor/view/edgeFreePreviewSession';
import { buildProjectFile, deserializeProject, downloadTextFile, safeFilename, serializeProject } from '../../persistence/projectFile';
import { useEditorStore } from '../../store/editorStore';
import { ExportDialog } from '../dialogs/ExportDialog';

interface WritableFileStreamLike {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface FileHandleLike {
  name: string;
  createWritable: () => Promise<WritableFileStreamLike>;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    excludeAcceptAllOption?: boolean;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileHandleLike>;
}

function downloadScreenshot(projectName: string): Promise<boolean> {
  const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
  if (!canvas) return Promise.resolve(false);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) { resolve(false); return; }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(projectName)}-preview.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      resolve(true);
    }, 'image/png');
  });
}

function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>('.menu[open]').forEach((menu) => menu.removeAttribute('open'));
}

export function TopBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileHandleRef = useRef<FileHandleLike | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const edgeFreePreview = useEdgeFreePreview();
  const project = useEditorStore((state) => state.project);
  const scene = useEditorStore((state) => state.scene);
  const objects = useEditorStore((state) => state.objects);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const newProject = useEditorStore((state) => state.newProject);
  const loadProject = useEditorStore((state) => state.loadProject);
  const markSaved = useEditorStore((state) => state.markSaved);
  const setMessage = useEditorStore((state) => state.setMessage);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const selectedId = useEditorStore((state) => state.selectedId);
  const pastCount = useEditorStore((state) => state.past.length);
  const futureCount = useEditorStore((state) => state.future.length);
  const setScene = useEditorStore((state) => state.setScene);
  const requestCameraView = useEditorStore((state) => state.requestCameraView);

  const serializeCurrentProject = (): string => {
    const file = buildProjectFile(project, scene, objects);
    return serializeProject({ project: file.project, scene: file.scene, objects: file.objects });
  };

  const writeFile = async (handle: FileHandleLike, content: string): Promise<void> => {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  };

  const saveAs = async (): Promise<void> => {
    const content = serializeCurrentProject();
    const filename = `${safeFilename(project.name)}.ncae.json`;
    const pickerWindow = window as SaveFilePickerWindow;

    try {
      if (pickerWindow.showSaveFilePicker) {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: filename,
          excludeAcceptAllOption: false,
          types: [{
            description: 'NorthCore Asset Editor Projekt',
            accept: { 'application/json': ['.json'] }
          }]
        });
        await writeFile(handle, content);
        fileHandleRef.current = handle;
        markSaved();
        setMessage(`Gespeichert unter: ${handle.name}`);
      } else {
        downloadTextFile(content, filename);
        fileHandleRef.current = null;
        markSaved();
        setMessage(`Heruntergeladen: ${filename}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? `Speichern fehlgeschlagen: ${error.message}` : 'Speichern fehlgeschlagen');
    } finally {
      closeMenus();
    }
  };

  const save = async (): Promise<void> => {
    const handle = fileHandleRef.current;
    if (!handle) {
      await saveAs();
      return;
    }

    try {
      await writeFile(handle, serializeCurrentProject());
      markSaved();
      setMessage(`Gespeichert: ${handle.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? `Speichern fehlgeschlagen: ${error.message}` : 'Speichern fehlgeschlagen');
    } finally {
      closeMenus();
    }
  };

  const load = async (file: File) => {
    try {
      loadProject(deserializeProject(await file.text()));
      fileHandleRef.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Projektdatei konnte nicht geladen werden.');
    }
  };

  return (
    <>
      <header className="topbar">
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Datei</summary>
          <div className="menu-popover">
            <button onClick={() => { fileHandleRef.current = null; newProject(); closeMenus(); }}>Neu</button>
            <button onClick={() => { inputRef.current?.click(); closeMenus(); }}>Öffnen…</button>
            <button onClick={() => { void save(); }}>Speichern</button>
            <button onClick={() => { void saveAs(); }}>Speichern unter…</button>
          </div>
        </details>
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Bearbeiten</summary>
          <div className="menu-popover">
            <button disabled={pastCount === 0} onClick={() => { undo(); closeMenus(); }}>Rückgängig</button>
            <button disabled={futureCount === 0} onClick={() => { redo(); closeMenus(); }}>Wiederholen</button>
            <button disabled={!selectedId} onClick={() => { duplicateObject(); closeMenus(); }}>Duplizieren</button>
            <button disabled={!selectedId} className="danger" onClick={() => { deleteObject(); closeMenus(); }}>Löschen</button>
          </div>
        </details>
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Ansicht</summary>
          <div className="menu-popover">
            <button onClick={() => { requestCameraView('perspective'); closeMenus(); }}>Perspektive</button>
            <button onClick={() => { requestCameraView('focus'); closeMenus(); }}>Auswahl fokussieren</button>
            <button onClick={() => { setScene({ gridVisible: !scene.gridVisible }); closeMenus(); }}>Raster {scene.gridVisible ? 'aus' : 'ein'}</button>
            <button onClick={() => { setScene({ axesVisible: !scene.axesVisible }); closeMenus(); }}>Achsen {scene.axesVisible ? 'aus' : 'ein'}</button>
            <button onClick={() => { setEdgeFreePreview(!edgeFreePreview); closeMenus(); }}>Kantenfrei {edgeFreePreview ? 'aus' : 'ein'}</button>
          </div>
        </details>
        <details className="menu" onMouseLeave={(event) => event.currentTarget.removeAttribute('open')}>
          <summary>Export</summary>
          <div className="menu-popover">
            <button onClick={() => { setExportOpen(true); closeMenus(); }}>GLB exportieren…</button>
            <button onClick={() => { void downloadScreenshot(project.name).then((saved) => setMessage(saved ? 'Screenshot gespeichert' : 'Screenshot konnte nicht erstellt werden')); closeMenus(); }}>Screenshot als PNG</button>
          </div>
        </details>
        <input className="project-name" aria-label="Projektname" value={project.name} onChange={(event) => setProjectName(event.target.value)} />
        <div className="brand">NorthCore Asset Editor 0.1</div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".json,.ncae.json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void load(file);
            event.currentTarget.value = '';
          }}
        />
      </header>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </>
  );
}
