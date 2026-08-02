import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createGeometry, triangleCount } from '../geometry/factory';
import type { SceneObjectData } from '../types/editor';
import { safeFilename } from '../persistence/projectFile';

export interface ExportReport { objects: SceneObjectData[]; triangles: number; warnings: string[]; }

export function filterExportObjects(objects: SceneObjectData[], selectedId: string | null, selectionOnly: boolean): SceneObjectData[] {
  return objects.filter((object) => object.visible && (!selectionOnly || object.id === selectedId));
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

export function inspectExport(objects: SceneObjectData[], selectedId: string | null, selectionOnly: boolean): ExportReport {
  const filtered = filterExportObjects(objects, selectedId, selectionOnly);
  const triangles = filtered.reduce((sum, object) => sum + triangleCount(object), 0);
  const warnings: string[] = [];
  if (filtered.length === 0) warnings.push('Keine sichtbaren Objekte zum Exportieren.');
  if (triangles > 100_000) warnings.push('Sehr hohe Polygonzahl: über 100.000 Dreiecke.');
  if (filtered.some(liesBelowGround)) warnings.push('Mindestens ein Objekt liegt teilweise unterhalb der Bodenebene.');
  if (filtered.some((object) => object.material.opacity <= 0)) warnings.push('Mindestens ein Objekt ist vollständig transparent.');
  return { objects: filtered, triangles, warnings };
}

export async function exportGlb(objects: SceneObjectData[], filename: string): Promise<Blob> {
  const group = new THREE.Group();
  try {
    for (const object of objects) {
      const geometry = createGeometry(object);
      const material = new THREE.MeshStandardMaterial({
        color: object.material.color,
        roughness: object.material.roughness,
        metalness: object.material.metalness,
        opacity: object.material.opacity,
        transparent: object.material.opacity < 1,
        flatShading: object.material.flatShading
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = object.name;
      mesh.position.fromArray(object.position);
      mesh.rotation.set(object.rotation[0], object.rotation[1], object.rotation[2]);
      mesh.scale.fromArray(object.scale);
      mesh.updateMatrix();
      geometry.applyMatrix4(mesh.matrix);
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      mesh.updateMatrix();
      group.add(mesh);
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
  } finally {
    group.traverse((node: THREE.Object3D) => {
      if (!('isMesh' in node) || node.isMesh !== true) return;
      const mesh = node as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material.dispose();
      }
    });
  }
}
