import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData, TransformMode } from '../../types/editor';
import { invertHexColor } from '../../utils/color';

interface PositionPatch {
  target: THREE.Object3D;
  position: THREE.Vector3;
  originalCopy: (value: THREE.Vector3) => THREE.Vector3;
  hadOwnCopy: boolean;
}

interface GizmoPatch extends PositionPatch {
  mode: TransformMode;
  material: THREE.MeshBasicMaterial;
  originalColor: THREE.Color;
  originalOpacity: number;
}

interface GizmoTarget {
  target: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
}

const octahedronRadius = (mesh: THREE.Mesh): number | null => {
  if (!(mesh.geometry instanceof THREE.OctahedronGeometry)) return null;
  const parameters = mesh.geometry.parameters as { radius?: number };
  return typeof parameters.radius === 'number' ? parameters.radius : null;
};

const isEffectivelyVisible = (object: THREE.Object3D, scene: THREE.Scene): boolean => {
  for (let current: THREE.Object3D | null = object; current && current !== scene; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
};

const transformControlsRoot = (handle: THREE.Object3D, scene: THREE.Scene): THREE.Object3D | null => {
  let topmost: THREE.Object3D | null = null;

  for (let current = handle.parent; current && current !== scene; current = current.parent) {
    topmost = current;
    const root = current as THREE.Object3D & { isTransformControlsRoot?: boolean };
    if (root.isTransformControlsRoot || current.constructor.name === 'TransformControlsRoot') return current;
  }

  return topmost;
};

const sceneObjects = (scene: THREE.Scene): THREE.Object3D[] => {
  const objects: THREE.Object3D[] = [];
  scene.traverse((object) => objects.push(object));
  return objects;
};

const findScaleCenter = (scene: THREE.Scene): GizmoTarget | null => {
  for (const candidate of sceneObjects(scene)) {
    if (!(candidate instanceof THREE.Group) || candidate.children.length !== 2) continue;
    if (candidate.renderOrder !== Number.POSITIVE_INFINITY) continue;

    const meshes = candidate.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    if (meshes.length !== 2) continue;

    const visual = meshes.find((mesh) => {
      const radius = octahedronRadius(mesh);
      return mesh.material instanceof THREE.MeshBasicMaterial
        && mesh.material.opacity > 0.001
        && radius !== null
        && Math.abs(radius - 0.1) < 0.0001;
    });
    const hitArea = meshes.find((mesh) => {
      const radius = octahedronRadius(mesh);
      return mesh.material instanceof THREE.MeshBasicMaterial
        && mesh.material.opacity <= 0.001
        && radius !== null
        && Math.abs(radius - 0.2) < 0.0001;
    });

    if (visual?.material instanceof THREE.MeshBasicMaterial && hitArea) {
      return { target: candidate, material: visual.material };
    }
  }

  return null;
};

const findTranslateCenter = (scene: THREE.Scene): GizmoTarget | null => {
  for (const candidate of sceneObjects(scene)) {
    if (!(candidate instanceof THREE.Mesh) || candidate.name !== 'XYZ') continue;
    if (!isEffectivelyVisible(candidate, scene)) continue;

    const radius = octahedronRadius(candidate);
    if (radius === null || Math.abs(radius - 0.1) >= 0.0001) continue;
    if (!(candidate.material instanceof THREE.MeshBasicMaterial) || candidate.material.opacity <= 0.001) continue;

    const root = transformControlsRoot(candidate, scene);
    if (root) return { target: root, material: candidate.material };
  }

  return null;
};

const findGizmo = (scene: THREE.Scene, mode: TransformMode): GizmoTarget | null => {
  if (mode === 'scale') return findScaleCenter(scene);
  if (mode === 'translate') return findTranslateCenter(scene);
  return null;
};

const patchPosition = (
  target: THREE.Object3D,
  centerWorldRef: MutableRefObject<THREE.Vector3>
): PositionPatch => {
  const position = target.position;
  const originalCopy = position.copy;
  const hadOwnCopy = Object.prototype.hasOwnProperty.call(position, 'copy');

  position.copy = function copyGeometryCenter(this: THREE.Vector3): THREE.Vector3 {
    return originalCopy.call(this, centerWorldRef.current);
  };

  return { target, position, originalCopy, hadOwnCopy };
};

const restorePosition = (patch: PositionPatch): void => {
  if (patch.hadOwnCopy) {
    patch.position.copy = patch.originalCopy;
  } else {
    delete (patch.position as unknown as { copy?: (value: THREE.Vector3) => THREE.Vector3 }).copy;
  }
};

export function useCenteredTransformGizmo(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry,
  selected: boolean,
  paintModeEnabled: boolean
): void {
  const scene = useThree((state) => state.scene);
  const tool = useEditorStore((state) => state.tool);
  const selectedCount = useEditorStore((state) => state.selectedIds.length);
  const patchRef = useRef<GizmoPatch | null>(null);
  const centerWorldRef = useRef(new THREE.Vector3());
  const localCenter = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  }, [geometry]);

  const restore = useCallback((): void => {
    const patch = patchRef.current;
    if (!patch) return;

    restorePosition(patch);
    patch.material.color.copy(patch.originalColor);
    patch.material.opacity = patch.originalOpacity;
    patch.material.needsUpdate = true;
    patchRef.current = null;
  }, []);

  useEffect(() => restore, [restore]);

  useFrame(() => {
    const active = selected
      && selectedCount === 1
      && !paintModeEnabled
      && object.visible
      && !object.locked
      && (tool === 'translate' || tool === 'scale');

    if (!active) {
      restore();
      return;
    }

    centerWorldRef.current
      .copy(localCenter)
      .multiply(new THREE.Vector3(...object.scale))
      .applyEuler(new THREE.Euler(...object.rotation))
      .add(new THREE.Vector3(...object.position));

    let patch = patchRef.current;
    if (!patch || patch.mode !== tool || !patch.target.parent) {
      restore();
      const found = findGizmo(scene, tool);
      if (!found) return;

      patch = {
        ...patchPosition(found.target, centerWorldRef),
        mode: tool,
        material: found.material,
        originalColor: found.material.color.clone(),
        originalOpacity: found.material.opacity
      };
      patchRef.current = patch;
    }

    patch.material.color.set(invertHexColor(object.material.color));
    patch.material.opacity = 1;
    patch.material.needsUpdate = true;
  });
}
