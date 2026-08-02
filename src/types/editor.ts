export type PrimitiveType =
  | 'box' | 'cuboid' | 'sphere' | 'hemisphere' | 'cylinder' | 'cone' | 'pyramid' | 'plane' | 'torus' | 'wedge' | 'prism'
  | 'wall' | 'floor' | 'flatRoof' | 'gableRoof' | 'shedRoof' | 'door' | 'window' | 'column' | 'chimney' | 'stairs';

export type Vec3 = [number, number, number];
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type CameraView = 'perspective' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'focus';

export interface MaterialData {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  flatShading: boolean;
}

export interface SceneObjectData {
  id: string;
  name: string;
  type: PrimitiveType;
  visible: boolean;
  locked: boolean;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  geometry: Record<string, number>;
  material: MaterialData;
  parentId?: string;
}

export interface SceneSettings {
  background: string;
  gridVisible: boolean;
  axesVisible: boolean;
  gridSize: number;
}

export interface ProjectMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  format: 'northcore-asset-editor';
  version: 1;
  project: ProjectMeta;
  scene: SceneSettings;
  objects: SceneObjectData[];
}

export interface Snapshot {
  objects: SceneObjectData[];
  project: ProjectMeta;
  scene: SceneSettings;
  selectedId: string | null;
}

export interface SnapSettings {
  enabled: boolean;
  position: number;
  rotation: number;
  scale: number;
}
