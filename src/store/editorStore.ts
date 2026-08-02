import { create } from 'zustand';
import { createSceneObject } from '../geometry/factory';
import type { CameraView, MaterialData, PrimitiveType, ProjectFile, SceneObjectData, SceneSettings, Snapshot, SnapSettings, TransformMode, Vec3 } from '../types/editor';

const clone = <T,>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const defaultProject = () => ({ name: 'Unbenanntes Asset', createdAt: now(), updatedAt: now() });
const defaultScene = (): SceneSettings => ({ background: '#11161A', gridVisible: true, axesVisible: true, gridSize: 1 });

interface EditorState {
  objects: SceneObjectData[];
  selectedId: string | null;
  project: ReturnType<typeof defaultProject>;
  scene: SceneSettings;
  tool: TransformMode;
  snap: SnapSettings;
  recentColors: string[];
  past: Snapshot[];
  future: Snapshot[];
  transactionStart: Snapshot | null;
  dirty: boolean;
  message: string;
  cameraView: CameraView;
  cameraRequestId: number;
  setMessage: (message: string) => void;
  setProjectName: (name: string) => void;
  setTool: (tool: TransformMode) => void;
  requestCameraView: (view: CameraView) => void;
  setScene: (patch: Partial<SceneSettings>) => void;
  setSnap: (patch: Partial<SnapSettings>) => void;
  select: (id: string | null) => void;
  addObject: (type: PrimitiveType) => void;
  deleteObject: (id?: string) => void;
  duplicateObject: (id?: string) => void;
  updateObject: (id: string, patch: Partial<SceneObjectData>, history?: boolean) => void;
  updateTransform: (id: string, key: 'position' | 'rotation' | 'scale', value: Vec3, history?: boolean) => void;
  updateMaterial: (id: string, patch: Partial<MaterialData>, history?: boolean) => void;
  beginTransaction: () => void;
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;
  newProject: (name?: string) => void;
  loadProject: (file: ProjectFile) => void;
  markSaved: () => void;
  snapshot: () => Snapshot;
}

const snapshotFrom = (state: Pick<EditorState, 'objects' | 'project' | 'scene' | 'selectedId'>): Snapshot => ({
  objects: clone(state.objects), project: clone(state.project), scene: clone(state.scene), selectedId: state.selectedId
});

const withHistory = (state: EditorState): Pick<EditorState, 'past' | 'future'> => ({
  past: [...state.past.slice(-99), snapshotFrom(state)], future: []
});

export const useEditorStore = create<EditorState>((set, get) => ({
  objects: [], selectedId: null, project: defaultProject(), scene: defaultScene(), tool: 'translate',
  snap: { enabled: false, position: 0.25, rotation: 15, scale: 0.1 }, recentColors: [],
  past: [], future: [], transactionStart: null, dirty: false, message: 'Bereit', cameraView: 'perspective', cameraRequestId: 0,

  setMessage: (message) => set({ message }),
  setProjectName: (name) => set((state) => ({ ...withHistory(state), project: { ...state.project, name, updatedAt: now() }, dirty: true })),
  setTool: (tool) => set({ tool }),
  requestCameraView: (cameraView) => set((state) => ({ cameraView, cameraRequestId: state.cameraRequestId + 1 })),
  setScene: (patch) => set((state) => ({ ...withHistory(state), scene: { ...state.scene, ...patch }, dirty: true })),
  setSnap: (patch) => set((state) => ({ snap: { ...state.snap, ...patch } })),
  select: (selectedId) => set({ selectedId }),

  addObject: (type) => set((state) => {
    const object = createSceneObject(type, state.objects.map((item) => item.id));
    return { ...withHistory(state), objects: [...state.objects, object], selectedId: object.id, dirty: true, message: `${object.name} hinzugefügt` };
  }),

  deleteObject: (id) => set((state) => {
    const target = id ?? state.selectedId;
    if (!target) return state;
    const object = state.objects.find((item) => item.id === target);
    if (!object) return state;
    return { ...withHistory(state), objects: state.objects.filter((item) => item.id !== target), selectedId: state.selectedId === target ? null : state.selectedId, dirty: true, message: `${object.name} gelöscht` };
  }),

  duplicateObject: (id) => set((state) => {
    const target = id ?? state.selectedId;
    const source = state.objects.find((item) => item.id === target);
    if (!source) return state;
    const duplicate = clone(source);
    duplicate.id = crypto.randomUUID();
    duplicate.name = `${source.name} Kopie`;
    duplicate.position = [source.position[0] + 0.35, source.position[1], source.position[2] + 0.35];
    return { ...withHistory(state), objects: [...state.objects, duplicate], selectedId: duplicate.id, dirty: true, message: `${source.name} dupliziert` };
  }),

  updateObject: (id, patch, history = true) => set((state) => ({
    ...(history ? withHistory(state) : {}),
    objects: state.objects.map((object) => object.id === id ? { ...object, ...patch } : object),
    project: { ...state.project, updatedAt: now() }, dirty: true
  })),

  updateTransform: (id, key, value, history = true) => get().updateObject(id, { [key]: value }, history),

  updateMaterial: (id, patch, history = true) => set((state) => {
    const current = state.objects.find((item) => item.id === id);
    if (!current) return state;
    const color = patch.color?.toUpperCase();
    const recentColors = color ? [color, ...state.recentColors.filter((item) => item !== color)].slice(0, 8) : state.recentColors;
    return {
      ...(history ? withHistory(state) : {}), recentColors,
      objects: state.objects.map((object) => object.id === id ? { ...object, material: { ...object.material, ...patch, ...(color ? { color } : {}) } } : object),
      project: { ...state.project, updatedAt: now() }, dirty: true
    };
  }),

  beginTransaction: () => set((state) => state.transactionStart ? state : { transactionStart: snapshotFrom(state) }),
  endTransaction: () => set((state) => {
    if (!state.transactionStart) return state;
    const changed = JSON.stringify(state.transactionStart.objects) !== JSON.stringify(state.objects);
    return { past: changed ? [...state.past.slice(-99), state.transactionStart] : state.past, future: changed ? [] : state.future, transactionStart: null, dirty: changed || state.dirty };
  }),

  undo: () => set((state) => {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return { ...clone(previous), past: state.past.slice(0, -1), future: [snapshotFrom(state), ...state.future].slice(0, 100), dirty: true, message: 'Rückgängig' };
  }),

  redo: () => set((state) => {
    const next = state.future[0];
    if (!next) return state;
    return { ...clone(next), past: [...state.past, snapshotFrom(state)].slice(-100), future: state.future.slice(1), dirty: true, message: 'Wiederholt' };
  }),

  newProject: (name = 'Unbenanntes Asset') => set({
    objects: [], selectedId: null, project: { ...defaultProject(), name }, scene: defaultScene(), past: [], future: [], transactionStart: null, dirty: false, message: 'Neues Projekt erstellt'
  }),

  loadProject: (file) => set({
    objects: clone(file.objects), selectedId: null, project: clone(file.project), scene: clone(file.scene), past: [], future: [], transactionStart: null, dirty: false, message: `${file.project.name} geladen`
  }),

  markSaved: () => set({ dirty: false, message: 'Projekt gespeichert' }),
  snapshot: () => snapshotFrom(get())
}));
