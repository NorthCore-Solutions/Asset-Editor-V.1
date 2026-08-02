import type { PrimitiveType, ProjectFile, SceneObjectData } from '../types/editor';

export const PROJECT_FORMAT = 'northcore-asset-editor' as const;
export const PROJECT_VERSION = 1 as const;
export const AUTOSAVE_KEY = 'northcore-asset-editor.autosave.v1';

const PRIMITIVE_TYPES = new Set<PrimitiveType>([
  'box', 'cuboid', 'sphere', 'hemisphere', 'cylinder', 'cone', 'pyramid', 'plane', 'torus', 'wedge', 'prism',
  'wall', 'floor', 'flatRoof', 'gableRoof', 'shedRoof', 'door', 'window', 'column', 'chimney', 'stairs'
]);

const isNumberTuple = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isUnitNumber = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && value <= 1;
const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

function validateSceneObject(value: unknown, index: number): SceneObjectData {
  if (!isObject(value)) throw new Error(`Objekt ${index + 1} ist ungültig.`);
  if (typeof value.id !== 'string' || value.id.length === 0) throw new Error(`Objekt ${index + 1}: Feld „id“ fehlt.`);
  if (typeof value.name !== 'string' || value.name.length === 0) throw new Error(`Objekt ${index + 1}: Feld „name“ fehlt.`);
  if (typeof value.type !== 'string' || !PRIMITIVE_TYPES.has(value.type as PrimitiveType)) throw new Error(`Objekt ${index + 1}: Unbekannter Typ „${String(value.type)}“.`);
  if (typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean') throw new Error(`Objekt ${index + 1}: Sichtbarkeit oder Sperrstatus ist ungültig.`);
  if (!isNumberTuple(value.position) || !isNumberTuple(value.rotation) || !isNumberTuple(value.scale)) throw new Error(`Objekt ${index + 1}: Transformation ist ungültig.`);
  if (value.scale.some((component) => component === 0)) throw new Error(`Objekt ${index + 1}: Skalierung darf nicht 0 sein.`);
  if (!isObject(value.geometry) || Object.values(value.geometry).some((item) => !isFiniteNumber(item))) throw new Error(`Objekt ${index + 1}: Geometriedaten sind ungültig.`);
  if (!isObject(value.material)) throw new Error(`Objekt ${index + 1}: Material fehlt.`);
  if (!isHexColor(value.material.color)) throw new Error(`Objekt ${index + 1}: Materialfarbe ist ungültig.`);
  if (!isUnitNumber(value.material.roughness) || !isUnitNumber(value.material.metalness) || !isUnitNumber(value.material.opacity)) throw new Error(`Objekt ${index + 1}: Materialwerte müssen zwischen 0 und 1 liegen.`);
  if (typeof value.material.flatShading !== 'boolean') throw new Error(`Objekt ${index + 1}: Shading-Einstellung ist ungültig.`);

  return {
    id: value.id,
    name: value.name,
    type: value.type as PrimitiveType,
    visible: value.visible,
    locked: value.locked,
    position: value.position,
    rotation: value.rotation,
    scale: value.scale,
    geometry: value.geometry as Record<string, number>,
    material: {
      color: value.material.color.toUpperCase(),
      roughness: value.material.roughness,
      metalness: value.material.metalness,
      opacity: value.material.opacity,
      flatShading: value.material.flatShading
    },
    ...(typeof value.parentId === 'string' ? { parentId: value.parentId } : {})
  };
}

export function serializeProject(input: Omit<ProjectFile, 'format' | 'version'>): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...input }, null, 2);
}

export function deserializeProject(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Die Datei enthält kein gültiges JSON.');
  }

  if (!isObject(raw)) throw new Error('Die Projektdatei ist ungültig.');
  if (raw.format !== PROJECT_FORMAT) throw new Error('Unbekanntes Projektformat.');
  if (raw.version !== PROJECT_VERSION) throw new Error(`Projektversion ${String(raw.version)} wird nicht unterstützt.`);

  if (!isObject(raw.project) || typeof raw.project.name !== 'string' || raw.project.name.length === 0 || typeof raw.project.createdAt !== 'string' || typeof raw.project.updatedAt !== 'string') {
    throw new Error('Projektmetadaten fehlen oder sind ungültig.');
  }

  if (!isObject(raw.scene) || !isHexColor(raw.scene.background) || typeof raw.scene.gridVisible !== 'boolean' || typeof raw.scene.axesVisible !== 'boolean' || !isFiniteNumber(raw.scene.gridSize) || raw.scene.gridSize <= 0) {
    throw new Error('Szeneneinstellungen fehlen oder sind ungültig.');
  }

  if (!Array.isArray(raw.objects)) throw new Error('Die Objektliste fehlt.');
  const objects = raw.objects.map(validateSceneObject);
  const ids = new Set(objects.map((object) => object.id));
  if (ids.size !== objects.length) throw new Error('Die Projektdatei enthält doppelte Objekt-IDs.');

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    project: {
      name: raw.project.name,
      createdAt: raw.project.createdAt,
      updatedAt: raw.project.updatedAt
    },
    scene: {
      background: raw.scene.background.toUpperCase(),
      gridVisible: raw.scene.gridVisible,
      axesVisible: raw.scene.axesVisible,
      gridSize: raw.scene.gridSize
    },
    objects
  };
}

export function buildProjectFile(project: ProjectFile['project'], scene: ProjectFile['scene'], objects: ProjectFile['objects']): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    project: { ...project, updatedAt: new Date().toISOString() },
    scene,
    objects
  };
}

export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const safeFilename = (name: string): string =>
  name.trim().replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
