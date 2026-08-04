import type {
  PaintSurfaceGridData,
  PaintSurfaceGridLayerData,
  PaintTextureData,
  PrimitiveType,
  ProjectFile,
  SceneObjectData
} from '../types/editor';

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
const isPositiveNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0;
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && isPositiveNumber(value);
const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const isPngDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);

function validateSurfaceGridLayer(
  value: unknown,
  objectIndex: number,
  surfaceIndex: number
): PaintSurfaceGridLayerData {
  if (!isObject(value)) {
    throw new Error(`Objekt ${objectIndex + 1}: Malfläche ${surfaceIndex + 1} ist ungültig.`);
  }
  if (typeof value.label !== 'string' || value.label.length === 0) {
    throw new Error(`Objekt ${objectIndex + 1}: Malfläche ${surfaceIndex + 1} hat keine Bezeichnung.`);
  }
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    throw new Error(`Objekt ${objectIndex + 1}: Rastergröße der Malfläche ${surfaceIndex + 1} ist ungültig.`);
  }
  if (!isUnitNumber(value.coverageU) || value.coverageU <= 0 || !isUnitNumber(value.coverageV) || value.coverageV <= 0) {
    throw new Error(`Objekt ${objectIndex + 1}: Rasterabdeckung der Malfläche ${surfaceIndex + 1} ist ungültig.`);
  }
  if (value.sourceWidth !== undefined && !isPositiveInteger(value.sourceWidth)) {
    throw new Error(`Objekt ${objectIndex + 1}: Quellbreite der Malfläche ${surfaceIndex + 1} ist ungültig.`);
  }
  if (value.sourceHeight !== undefined && !isPositiveInteger(value.sourceHeight)) {
    throw new Error(`Objekt ${objectIndex + 1}: Quellhöhe der Malfläche ${surfaceIndex + 1} ist ungültig.`);
  }

  return {
    label: value.label,
    width: value.width,
    height: value.height,
    coverageU: value.coverageU,
    coverageV: value.coverageV,
    ...(value.sourceWidth !== undefined ? { sourceWidth: value.sourceWidth } : {}),
    ...(value.sourceHeight !== undefined ? { sourceHeight: value.sourceHeight } : {})
  };
}

function validateSurfaceGrid(value: unknown, objectIndex: number): PaintSurfaceGridData {
  if (!isObject(value)) throw new Error(`Objekt ${objectIndex + 1}: Flächenraster der Bemalung ist ungültig.`);
  if (value.version !== 1) throw new Error(`Objekt ${objectIndex + 1}: Unbekannte Flächenraster-Version.`);
  if (typeof value.atlasSignature !== 'string' || value.atlasSignature.length === 0) {
    throw new Error(`Objekt ${objectIndex + 1}: Atlas-Signatur der Bemalung fehlt.`);
  }
  if (!isPositiveNumber(value.pixelsPerWorldUnit)) {
    throw new Error(`Objekt ${objectIndex + 1}: Rasterauflösung der Bemalung ist ungültig.`);
  }
  if (value.baseColor !== undefined && !isHexColor(value.baseColor)) {
    throw new Error(`Objekt ${objectIndex + 1}: Grundfarbe der Bemalung ist ungültig.`);
  }
  if (!Array.isArray(value.surfaces) || value.surfaces.length === 0) {
    throw new Error(`Objekt ${objectIndex + 1}: Malflächen der Bemalung fehlen.`);
  }
  if (value.sourceDataUrl !== undefined && !isPngDataUrl(value.sourceDataUrl)) {
    throw new Error(`Objekt ${objectIndex + 1}: Quelldaten der Bemalung sind ungültig.`);
  }
  if (value.sourceWidth !== undefined && !isPositiveInteger(value.sourceWidth)) {
    throw new Error(`Objekt ${objectIndex + 1}: Quellbreite der Bemalung ist ungültig.`);
  }
  if (value.sourceHeight !== undefined && !isPositiveInteger(value.sourceHeight)) {
    throw new Error(`Objekt ${objectIndex + 1}: Quellhöhe der Bemalung ist ungültig.`);
  }

  return {
    version: 1,
    atlasSignature: value.atlasSignature,
    pixelsPerWorldUnit: value.pixelsPerWorldUnit,
    ...(value.baseColor !== undefined ? { baseColor: value.baseColor.toUpperCase() } : {}),
    surfaces: value.surfaces.map((surface, surfaceIndex) =>
      validateSurfaceGridLayer(surface, objectIndex, surfaceIndex)
    ),
    ...(value.sourceDataUrl !== undefined ? { sourceDataUrl: value.sourceDataUrl } : {}),
    ...(value.sourceWidth !== undefined ? { sourceWidth: value.sourceWidth } : {}),
    ...(value.sourceHeight !== undefined ? { sourceHeight: value.sourceHeight } : {})
  };
}

function validatePaintTexture(value: unknown, objectIndex: number): PaintTextureData {
  if (!isObject(value)) throw new Error(`Objekt ${objectIndex + 1}: Bemalung ist ungültig.`);
  if (!isPngDataUrl(value.dataUrl)) throw new Error(`Objekt ${objectIndex + 1}: Bilddaten der Bemalung sind ungültig.`);
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    throw new Error(`Objekt ${objectIndex + 1}: Bildgröße der Bemalung ist ungültig.`);
  }
  if (typeof value.pixelated !== 'boolean') {
    throw new Error(`Objekt ${objectIndex + 1}: Pixelmodus der Bemalung ist ungültig.`);
  }

  return {
    dataUrl: value.dataUrl,
    width: value.width,
    height: value.height,
    pixelated: value.pixelated,
    ...(value.surfaceGrid !== undefined
      ? { surfaceGrid: validateSurfaceGrid(value.surfaceGrid, objectIndex) }
      : {})
  };
}

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
      flatShading: value.material.flatShading,
      ...(value.material.paintTexture !== undefined
        ? { paintTexture: validatePaintTexture(value.material.paintTexture, index) }
        : {})
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
