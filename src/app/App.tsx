import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { StatusBar } from '../components/layout/StatusBar';
import { ShapesPanel } from '../components/panels/ShapesPanel';
import { PropertiesPanel } from '../components/panels/PropertiesPanel';
import { HierarchyPanel } from '../components/panels/HierarchyPanel';
import { EditorToolbar } from '../components/toolbar/EditorToolbar';
import { RestoreDialog } from '../components/dialogs/RestoreDialog';
import { EditorViewport } from '../editor/viewport/EditorViewport';
import { useEditorShortcuts } from '../editor/shortcuts/useEditorShortcuts';
import { AUTOSAVE_KEY, buildProjectFile, deserializeProject, serializeProject } from '../persistence/projectFile';
import { useEditorStore } from '../store/editorStore';

export function App() {
  useEditorShortcuts();
  const objects = useEditorStore((state) => state.objects);
  const project = useEditorStore((state) => state.project);
  const scene = useEditorStore((state) => state.scene);
  const loadProject = useEditorStore((state) => state.loadProject);
  const setMessage = useEditorStore((state) => state.setMessage);
  const initialAutosave = useMemo(() => localStorage.getItem(AUTOSAVE_KEY), []);
  const [restoreOpen, setRestoreOpen] = useState(Boolean(initialAutosave));

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const file = buildProjectFile(project, scene, objects);
      localStorage.setItem(AUTOSAVE_KEY, serializeProject({ project: file.project, scene: file.scene, objects: file.objects }));
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [objects, project, scene]);

  const restore = () => {
    if (!initialAutosave) { setRestoreOpen(false); return; }
    try { loadProject(deserializeProject(initialAutosave)); }
    catch (error) { setMessage(error instanceof Error ? `Autosave ungültig: ${error.message}` : 'Autosave ungültig'); localStorage.removeItem(AUTOSAVE_KEY); }
    setRestoreOpen(false);
  };

  const discard = () => { localStorage.removeItem(AUTOSAVE_KEY); setRestoreOpen(false); };

  return (
    <div className="app-shell">
      <TopBar />
      <EditorToolbar />
      <main className="workspace">
        <ShapesPanel />
        <EditorViewport />
        <PropertiesPanel />
        <HierarchyPanel />
      </main>
      <StatusBar />
      {restoreOpen && <RestoreDialog onRestore={restore} onDiscard={discard} />}
    </div>
  );
}
