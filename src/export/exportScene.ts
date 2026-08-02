import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { ADDITION, Brush, Evaluator } from 'three-bvh-csg';
import { createGeometry, triangleCount } from '../geometry/factory';
import type { PrimitiveType, SceneObjectData } from '../types/editor';
import { safeFilename } from '../persistence/projectFile';

export type ExportGeometryMode = 'separate' | 'union';

export interface ExportReport {
  objects: SceneObjectData[];
  triangles: number;
  warnings: string[];
  unionEligible: number;
  unionSeparate: number;
}

interface ExportResources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
}

const UNION_TYPES = new Set<PrimitiveType>([
  'box',
  'cuboid',
  'sphere',
  'cylinder',
  'cone',
  'pyramid',
  'torus',
  'wedge',
  'prism'
]);

export function filterExportObjects(objects: SceneObjectData[], selectedId: string | null, selectionOnly: boolean): SceneObjectData[] {
  return objects.filter((object) => object.visible && (!selectionOnly || object.id === selectedId));
}

function isUnionEligible(object: SceneObjectData): boolean {
  return UNION_TYPES.has(object.type) && object.material.opacity > 0;
}

function liesBelowGround(object: SceneObjectData): boolean {
  const geometry = createGeometry(object);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox?.clone();
  geometry.dispose();
  if (!box) return false;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
  box.applyMatrix4(matrix);
  return box.min.y < -0.001;
}

export function inspectExport(
  objects: SceneObjectData[],
  selectedId: string | null,
  selectionOnly: boolean,
  geometryMode: ExportGeometryMode = 'separate'
): ExportReport {
  const filtered = filterExportObjects(objects, selectedId, selectionOnly);
  const triangles = filtered.reduce((sum, object) => sum + triangleCount(object), 0);
  const warnings: string[] = [];
  const unionEligible = filtered.filter(isUnionEligible).length;
  const unionSeparate = filtered.length - unionEligible;

  if (filtered.length === 0) warnings.push('Keine sichtbaren Objekte zum Exportieren.');
  if (triangles > 100_000) warnings.push('Sehr hohe Polygonzahl: über 100.000 Dreiecke.');
  if (filtered.some(liesBelowGround)) warnings.push('Mindestens ein Objekt liegt teilweise unterhalb der Bodenebene.');
  if (filtered.some((object) => object.material.opacity <= 0)) warnings.push('Mindestens ein Objekt ist vollständig transparent.');

  if (geometryMode === 'union') {
    if (unionEligible < 2) {
      warnings.push('Union benötigt mindestens zwei geschlossene Grundformen. Der Export bleibt für diese Auswahl getrennt.');
    }
    if (unionSeparate > 0) {
      warnings.push(`${unionSeparate} nicht geschlossene oder nicht unterstützte Objekt${unionSeparate === 1 ? '' : 'e'} werden separat exportiert.`);
    }
  }

  return { objects: filtered, triangles, warnings, unionEligible, unionSeparate };
}

function createMaterial(object: SceneObjectData): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: object.material.color,
    roughness: object.material.roughness,
    metalness: object.material.metalness,
    opacity: object.material.opacity,
    transparent: object.material.opacity < 1,
    flatShading: object.material.flatShading
  });
}

function objectMatrix(object: SceneObjectData): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...object.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation)),
    new THREE.Vector3(...object.scale)
  );
}

function createWorldGeometry(object: SceneObjectData, forUnion: boolean): THREE.BufferGeometry {
  const source = createGeometry(object);
  let geometry = source;

  if (forUnion && source.index) {
    geometry = source.toNonIndexed();
    source.dispose();
  }

  geometry.applyMatrix4(objectMatrix(object));

  if (forUnion) {
    for (const attributeName of Object.keys(geometry.attributes)) {
      if (attributeName !== 'position' && attributeName !== 'normal') {
        geometry.deleteAttribute(attributeName);
      }
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const count = geometry.index?.count ?? geometry.getAttribute('position').count;
    geometry.clearGroups();
    geometry.addGroup(0, count, 0);
    geometry.setDrawRange(0, count);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addSeparateMesh(group: THREE.Group, object: SceneObjectData, resources: ExportResources): void {
  const geometry = createWorldGeometry(object, false);
  const material = createMaterial(object);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = object.name;
  resources.geometries.add(geometry);
  resources.materials.add(material);
  group.add(mesh);
}

function effectiveDrawRange(geometry: THREE.BufferGeometry): { start: number; count: number } {
  const total = geometry.index?.count ?? geometry.getAttribute('position').count;
  const start = Math.max(0, Math.min(total, geometry.drawRange.start));
  const requestedCount = Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : total - start;
  return { start, count: Math.max(0, Math.min(total - start, requestedCount)) };
}

function extractGeometryGroups(
  source: THREE.BufferGeometry,
  materialIndex: number | null
): THREE.BufferGeometry | null {
  const drawRange = effectiveDrawRange(source);
  const drawEnd = drawRange.start + drawRange.count;
  const sourceGroups = source.groups.length > 0
    ? source.groups
    : [{ start: drawRange.start, count: drawRange.count, materialIndex: 0 }];
  const selectedGroups = sourceGroups
    .filter((group) => materialIndex === null || group.materialIndex === materialIndex)
    .map((group) => {
      const start = Math.max(group.start, drawRange.start);
      const end = Math.min(group.start + group.count, drawEnd);
      return { start, count: Math.max(0, end - start), materialIndex: 0 };
    })
    .filter((group) => group.count > 0);

  if (selectedGroups.length === 0) return null;

  const geometry = source.clone();
  geometry.clearGroups();
  selectedGroups.forEach((group) => geometry.addGroup(group.start, group.count, 0));
  mergeGroups(geometry);
  geometry.clearGroups();
  const count = geometry.index?.count ?? geometry.getAttribute('position').count;
  geometry.setDrawRange(0, count);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addUnionResult(
  group: THREE.Group,
  result: Brush,
  resources: ExportResources
): void {
  const materials = Array.isArray(result.material) ? result.material : [result.material];
  materials.forEach((material) => resources.materials.add(material));

  if (materials.length === 1) {
    const geometry = extractGeometryGroups(result.geometry, null);
    if (!geometry) throw new Error('Die Union hat keine exportierbare Geometrie erzeugt.');
    resources.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, materials[0]);
    mesh.name = 'Union';
    group.add(mesh);
    return;
  }

  for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
    const geometry = extractGeometryGroups(result.geometry, materialIndex);
    if (!geometry) continue;
    resources.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, materials[materialIndex]);
    mesh.name = `Union Material ${materialIndex + 1}`;
    group.add(mesh);
  }
}

function addUnionMeshes(
  group: THREE.Group,
  objects: SceneObjectData[],
  resources: ExportResources
): void {
  const unionObjects = objects.filter(isUnionEligible);
  const separateObjects = objects.filter((object) => !isUnionEligible(object));

  if (unionObjects.length < 2) {
    objects.forEach((object) => addSeparateMesh(group, object, resources));
    return;
  }

  const evaluator = new Evaluator();
  evaluator.useGroups = true;
  evaluator.consolidateMaterials = true;

  let result: Brush | null = null;

  for (const object of unionObjects) {
    const geometry = createWorldGeometry(object, true);
    const material = createMaterial(object);
    const brush = new Brush(geometry, material);
    brush.name = object.name;
    brush.updateMatrixWorld(true);
    resources.geometries.add(geometry);
    resources.materials.add(material);

    if (!result) {
      result = brush;
      continue;
    }

    const nextResult = evaluator.evaluate(result, brush, ADDITION);
    nextResult.updateMatrixWorld(true);
    resources.geometries.add(nextResult.geometry);
    const resultMaterials = Array.isArray(nextResult.material) ? nextResult.material : [nextResult.material];
    resultMaterials.forEach((resultMaterial) => resources.materials.add(resultMaterial));
    result = nextResult;
  }

  if (!result) throw new Error('Es konnten keine Grundformen für die Union vorbereitet werden.');
  addUnionResult(group, result, resources);
  separateObjects.forEach((object) => addSeparateMesh(group, object, resources));
}

export async function exportGlb(
  objects: SceneObjectData[],
  filename: string,
  geometryMode: ExportGeometryMode = 'separate'
): Promise<Blob> {
  const group = new THREE.Group();
  const resources: ExportResources = {
    geometries: new Set<THREE.BufferGeometry>(),
    materials: new Set<THREE.Material>()
  };

  try {
    if (geometryMode === 'union') {
      addUnionMeshes(group, objects, resources);
    } else {
      objects.forEach((object) => addSeparateMesh(group, object, resources));
    }

    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(group, { binary: true, onlyVisible: true });
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('Der binäre GLB-Export hat kein ArrayBuffer erzeugt.');
    }

    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(filename)}.glb`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return blob;
  } catch (error) {
    if (geometryMode === 'union') {
      const reason = error instanceof Error ? error.message : 'unbekannter Geometriefehler';
      throw new Error(`Union fehlgeschlagen: ${reason}`);
    }
    throw error;
  } finally {
    resources.geometries.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
  }
}
