import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData } from '../../types/editor';
import { useObjectDimensionsOverlay } from '../measurement/useObjectDimensionsOverlay';
import { useViewportPerformance } from '../viewport/useViewportPerformance';
import type { SurfacePaintSettings } from './surfacePaintSession';
import {
  useSurfacePaint as useSurfacePaintGrid,
  useSurfacePaintSettings,
  type SurfacePaintBinding
} from './useSurfacePaintGrid';

export { useSurfacePaintSettings };
export type { SurfacePaintBinding };

interface SceneEnvironmentEntry {
  target: THREE.WebGLRenderTarget;
  previous: THREE.Texture | null;
  references: number;
}

interface PositionCopyPatch {
  target: THREE.Object3D;
  position: THREE.Vector3;
  originalCopy: (value: THREE.Vector3) => THREE.Vector3;
  hadOwnCopy: boolean;
}

interface CenterHandlePatch extends PositionCopyPatch {
  material: THREE.MeshBasicMaterial;
  originalColor: THREE.Color;
  originalOpacity: number;
}

const sceneEnvironments = new WeakMap<THREE.Scene, SceneEnvironmentEntry>();

function normalizedHex(color: string): string | null {
  const raw = color.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return raw.split('').map((character) => `${character}${character}`).join('');
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? raw : null;
}

export function invertHexColor(color: string): string {
  const hex = normalizedHex(color);
  if (!hex) return '#000000';
  const inverted = [0, 2, 4]
    .map((offset) => 255 - Number.parseInt(hex.slice(offset, offset + 2), 16))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `#${inverted.toUpperCase()}`;
}

function octahedronRadius(mesh: THREE.Mesh): number | null {
  if (!(mesh.geometry instanceof THREE.OctahedronGeometry)) return null;
  const parameters = mesh.geometry.parameters as { radius?: number };
  return typeof parameters.radius === 'number' ? parameters.radius : null;
}

function restorePositionCopy(patch: PositionCopyPatch): void {
  if (patch.hadOwnCopy) {
    patch.position.copy = patch.originalCopy;
  } else {
    delete (patch.position as unknown as {
      copy?: (value: THREE.Vector3) => THREE.Vector3;
    }).copy;
  }
}

function patchPositionCopy(
  target: THREE.Object3D,
  centerWorldRef: MutableRefObject<THREE.Vector3>
): PositionCopyPatch {
  const position = target.position;
  const originalCopy = position.copy;
  const hadOwnCopy = Object.prototype.hasOwnProperty.call(position, 'copy');
  position.copy = function copyGeometryCenter(this: THREE.Vector3): THREE.Vector3 {
    return originalCopy.call(this, centerWorldRef.current);
  };
  return { target, position, originalCopy, hadOwnCopy };
}

function geometryCenterWorld(
  target: THREE.Vector3,
  localCenter: THREE.Vector3,
  object: SceneObjectData
): THREE.Vector3 {
  return target
    .copy(localCenter)
    .multiply(new THREE.Vector3(...object.scale))
    .applyEuler(new THREE.Euler(...object.rotation))
    .add(new THREE.Vector3(...object.position));
}

function findOriginalCenterScaleHandle(scene: THREE.Scene): {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
} | null {
  let result: { group: THREE.Group; material: THREE.MeshBasicMaterial } | null = null;

  scene.traverse((candidate) => {
    if (result || !(candidate instanceof THREE.Group) || candidate.children.length !== 2) return;
    if (candidate.renderOrder !== Number.POSITIVE_INFINITY) return;

    const meshes = candidate.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    if (meshes.length !== 2) return;

    const visual = meshes.find((mesh) => {
      const material = mesh.material;
      const radius = octahedronRadius(mesh);
      return material instanceof THREE.MeshBasicMaterial
        && material.opacity > 0.001
        && radius !== null
        && Math.abs(radius - 0.1) < 0.0001;
    });
    const hitArea = meshes.find((mesh) => {
      const material = mesh.material;
      const radius = octahedronRadius(mesh);
      return material instanceof THREE.MeshBasicMaterial
        && material.opacity <= 0.001
        && radius !== null
        && Math.abs(radius - 0.2) < 0.0001;
    });

    if (!visual || !hitArea || !(visual.material instanceof THREE.MeshBasicMaterial)) return;
    result = { group: candidate, material: visual.material };
  });

  return result;
}

function findOriginalTranslateCenterHandles(scene: THREE.Scene): {
  handles: THREE.Mesh[];
  material: THREE.MeshBasicMaterial | null;
} {
  const handles: THREE.Mesh[] = [];
  let material: THREE.MeshBasicMaterial | null = null;

  scene.traverse((candidate) => {
    if (!(candidate instanceof THREE.Mesh) || candidate.name !== 'XYZ') return;
    const radius = octahedronRadius(candidate);
    if (radius === null || (Math.abs(radius - 0.1) >= 0.0001 && Math.abs(radius - 0.2) >= 0.0001)) return;
    if (!(candidate.material instanceof THREE.MeshBasicMaterial)) return;

    handles.push(candidate);
    if (Math.abs(radius - 0.1) < 0.0001 && candidate.material.opacity > 0.001) {
      material = candidate.material;
    }
  });

  return { handles, material };
}

function useOriginalCenterScaleHandle(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry,
  selected: boolean,
  paintModeEnabled: boolean
): void {
  const scene = useThree((state) => state.scene);
  const tool = useEditorStore((state) => state.tool);
  const selectedCount = useEditorStore((state) => state.selectedIds.length);
  const patchRef = useRef<CenterHandlePatch | null>(null);
  const centerWorldRef = useRef(new THREE.Vector3());
  const localCenter = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  }, [geometry]);

  const restorePatch = (): void => {
    const patch = patchRef.current;
    if (!patch) return;

    restorePositionCopy(patch);
    patch.material.color.copy(patch.originalColor);
    patch.material.opacity = patch.originalOpacity;
    patch.material.needsUpdate = true;
    patchRef.current = null;
  };

  useEffect(() => () => restorePatch(), []);

  useFrame(() => {
    const active = selected
      && selectedCount === 1
      && !paintModeEnabled
      && object.visible
      && !object.locked
      && tool === 'scale';

    if (!active) {
      restorePatch();
      return;
    }

    geometryCenterWorld(centerWorldRef.current, localCenter, object);

    let patch = patchRef.current;
    if (!patch || !patch.target.parent) {
      restorePatch();
      const found = findOriginalCenterScaleHandle(scene);
      if (!found) return;

      const positionPatch = patchPositionCopy(found.group, centerWorldRef);
      patch = {
        ...positionPatch,
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

function useOriginalTranslateCenterHandle(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry,
  selected: boolean,
  paintModeEnabled: boolean
): void {
  const scene = useThree((state) => state.scene);
  const tool = useEditorStore((state) => state.tool);
  const selectedCount = useEditorStore((state) => state.selectedIds.length);
  const patchesRef = useRef<PositionCopyPatch[]>([]);
  const materialRef = useRef<{
    material: THREE.MeshBasicMaterial;
    color: THREE.Color;
    opacity: number;
  } | null>(null);
  const centerWorldRef = useRef(new THREE.Vector3());
  const localCenter = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  }, [geometry]);

  const restorePatches = (): void => {
    patchesRef.current.forEach(restorePositionCopy);
    patchesRef.current = [];

    const storedMaterial = materialRef.current;
    if (storedMaterial) {
      storedMaterial.material.color.copy(storedMaterial.color);
      storedMaterial.material.opacity = storedMaterial.opacity;
      storedMaterial.material.needsUpdate = true;
      materialRef.current = null;
    }
  };

  useEffect(() => () => restorePatches(), []);

  useFrame(() => {
    const active = selected
      && selectedCount === 1
      && !paintModeEnabled
      && object.visible
      && !object.locked
      && tool === 'translate';

    if (!active) {
      restorePatches();
      return;
    }

    geometryCenterWorld(centerWorldRef.current, localCenter, object);

    const patchesInvalid = patchesRef.current.length === 0
      || patchesRef.current.some((patch) => !patch.target.parent);
    if (patchesInvalid) {
      restorePatches();
      const found = findOriginalTranslateCenterHandles(scene);
      if (found.handles.length === 0) return;

      patchesRef.current = found.handles.map((handle) => patchPositionCopy(handle, centerWorldRef));
      if (found.material) {
        materialRef.current = {
          material: found.material,
          color: found.material.color.clone(),
          opacity: found.material.opacity
        };
      }
    }

    const storedMaterial = materialRef.current;
    if (storedMaterial) {
      storedMaterial.material.color.set(invertHexColor(object.material.color));
      storedMaterial.material.opacity = 1;
      storedMaterial.material.needsUpdate = true;
    }
  });
}

function useNeutralMaterialEnvironment(): void {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    let entry = sceneEnvironments.get(scene);

    if (!entry) {
      const generator = new THREE.PMREMGenerator(gl);
      const target = generator.fromScene(new RoomEnvironment(), 0.04);
      generator.dispose();
      entry = {
        target,
        previous: scene.environment,
        references: 0
      };
      sceneEnvironments.set(scene, entry);
      scene.environment = target.texture;
    }

    entry.references += 1;

    return () => {
      const current = sceneEnvironments.get(scene);
      if (!current) return;
      current.references -= 1;
      if (current.references > 0) return;

      if (scene.environment === current.target.texture) {
        scene.environment = current.previous;
      }
      current.target.dispose();
      sceneEnvironments.delete(scene);
    };
  }, [gl, scene]);
}

function useSceneMaterialSync(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry,
  texture: THREE.CanvasTexture | null
): void {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const candidate = scene.getObjectByProperty('geometry', geometry);
    if (!(candidate instanceof THREE.Mesh)) return;
    const mesh = candidate;

    const opacity = THREE.MathUtils.clamp(object.material.opacity, 0, 1);
    const roughness = THREE.MathUtils.clamp(object.material.roughness, 0, 1);
    const metalness = THREE.MathUtils.clamp(object.material.metalness, 0, 1);
    const transparent = opacity < 0.999;
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    materials.forEach((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return;

      material.map = texture;
      material.color.set(texture ? '#FFFFFF' : object.material.color);
      material.roughness = roughness;
      material.metalness = metalness;
      material.opacity = opacity;
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.alphaTest = texture ? 0.001 : 0;
      material.flatShading = object.material.flatShading;
      material.envMapIntensity = 1;
      material.needsUpdate = true;
    });

    mesh.castShadow = !transparent;
    mesh.receiveShadow = opacity > 0;
  }, [
    geometry,
    object.material.color,
    object.material.flatShading,
    object.material.metalness,
    object.material.opacity,
    object.material.roughness,
    scene,
    texture
  ]);
}

export function useSurfacePaint(
  object: SceneObjectData,
  selected: boolean,
  settings: SurfacePaintSettings,
  geometry: THREE.BufferGeometry
): SurfacePaintBinding {
  useNeutralMaterialEnvironment();
  useViewportPerformance(object, geometry);
  useObjectDimensionsOverlay(object, geometry);
  useOriginalCenterScaleHandle(object, geometry, selected, settings.enabled);
  useOriginalTranslateCenterHandle(object, geometry, selected, settings.enabled);
  const binding = useSurfacePaintGrid(object, selected, settings, geometry);
  const visibleTexture = object.material.paintTexture ? binding.texture : null;
  useSceneMaterialSync(object, geometry, visibleTexture);
  return { ...binding, texture: visibleTexture };
}
