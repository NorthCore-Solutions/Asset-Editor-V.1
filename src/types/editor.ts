export type PrimitiveType =
  | 'box' | 'cuboid' | 'sphere' | 'hemisphere' | 'cylinder' | 'cone' | 'pyramid' | 'plane' | 'torus' | 'wedge' | 'prism'
  | 'wall' | 'floor' | 'flatRoof' | 'gableRoof' | 'shedRoof' | 'door' | 'window' | 'column' | 'chimney' | 'stairs';

export type Vec3 = [number, number, number];
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type CameraView = 'perspective' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'focus';

export interface PaintSurfaceGridLayerData {
  label: string;
  width: number;
  height: number;
  coverageU: number;
  coverageV: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface PaintSurfaceGridData {
  version: 1 | 2;
  atlasSignature: string;
  pixelsPerWorldUnit: number;
  baseColor?: string;
  surfaces: PaintSurfaceGridLayerData[];
  sourceDataUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface PaintTextureData {
  dataUrl: string;
  width: number;
  height: number;
  pixelated: boolean;
  surfaceGrid?: PaintSurfaceGridData;
}

export interface MaterialData {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  flatShading: boolean;
  paintTexture?: PaintTextureData;
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
  surface: boolean;
  position: number;
  rotation: number;
  scale: number;
}
