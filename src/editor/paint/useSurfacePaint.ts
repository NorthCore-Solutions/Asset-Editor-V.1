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

function setBasicMaterialAppearance(
  material: THREE.MeshBasicMaterial,
  color: THREE.ColorRepresentation,
  opacity: number
): void {
  material.color.set(color);
  material.opacity = opacity;
  material.needsUpdate = true;
}

function setSceneEnvironment(scene: THREE.Scene, environment: THREE.Texture | null): void {
  scene.environment = environment;
}

function materialList(value: unknown): THREE.Material[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is THREE.Material => entry instanceof THREE.Material);
  }
  return value instanceof THREE.Material ? [value] : [];
}

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

function octahedronRadius(object: THREE.Object3D): number | null {
  if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.OctahedronGeometry)) return null;
  const parameters = object.geometry.parameters as { radius?: number };
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
  const originalCopy = position.copy.bind(position);
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
  group: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
} | null {
  let result: { group: THREE.Object3D; material: THREE.MeshBasicMaterial } | null = null;

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

    const visualMaterial: unknown = visual?.material;
    if (!visual || !hitArea || !(visualMaterial instanceof THREE.MeshBasicMaterial)) return;
    result = { group: candidate, material: visualMaterial };
  });

  return result;
}

function isEffectivelyVisible(object: THREE.Object3D, scene: THREE.Scene): boolean {
  let current: THREE.Object3D | null = object;
  while (current && current !== scene) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function transformControlsRootForHandle(
  handle: THREE.Object3D,
  scene: THREE.Scene
): THREE.Object3D | null {
  let current = handle.parent;
  let topmost: THREE.Object3D | null = null;

  while (current && current !== scene) {
    topmost = current;
    const root = current as THREE.Object3D & { isTransformControlsRoot?: boolean };
    if (root.isTransformControlsRoot || current.constructor.name === 'TransformControlsRoot') {
      return current;
    }
    current = current.parent;
  }

  return topmost;
}

function findOriginalTranslateGizmo(scene: THREE.Scene): {
  root: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
} | null {
  let result: { root: THREE.Object3D; material: THREE.MeshBasicMaterial } | null = null;

  scene.traverse((candidate) => {
    if (result || !(candidate instanceof THREE.Mesh) || candidate.name !== 'XYZ') return;
    if (!isEffectivelyVisible(candidate, scene)) return;

    const radius = octahedronRadius(candidate);
    if (radius === null || Math.abs(radius - 0.1) >= 0.0001) return;
    const material: unknown = candidate.material;
    if (!(material instanceof THREE.MeshBasicMaterial) || material.opacity <= 0.001) return;

    const root = transformControlsRootForHandle(candidate, scene);
    if (!root) return;
    result = { root, material };
  });

  return result;
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
    setBasicMaterialAppearance(patch.material, patch.originalColor, patch.originalOpacity);
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

    setBasicMaterialAppearance(patch.material, invertHexColor(object.material.color), 1);
  });
}

function useOriginalTranslateGizmoCenter(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry,
  selected: boolean,
  paintModeEnabled: boolean
): void {
  const scene = useThree((state) => state.scene);
  const tool = useEditorStore((state) => state.tool);
  const selectedCount = useEditorStore((state) => state.selectedIds.length);
  const patchRef = useRef<PositionCopyPatch | null>(null);
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

  const restorePatch = (): void => {
    const patch = patchRef.current;
    if (patch) {
      restorePositionCopy(patch);
      patchRef.current = null;
    }

    const storedMaterial = materialRef.current;
    if (storedMaterial) {
      storedMaterial.material.color.copy(storedMaterial.color);
      storedMaterial.material.opacity = storedMaterial.opacity;
      storedMaterial.material.needsUpdate = true;
      materialRef.current = null;
    }
  };

  useEffect(() => () => restorePatch(), []);

  useFrame(() => {
    const active = selected
      && selectedCount === 1
      && !paintModeEnabled
      && object.visible
      && !object.locked
      && tool === 'translate';

    if (!active) {
      restorePatch();
      return;
    }

    geometryCenterWorld(centerWorldRef.current, localCenter, object);

    const patch = patchRef.current;
    if (!patch || !patch.target.parent) {
      restorePatch();
      const found = findOriginalTranslateGizmo(scene);
      if (!found) return;

      patchRef.current = patchPositionCopy(found.root, centerWorldRef);
      materialRef.current = {
        material: found.material,
        color: found.material.color.clone(),
        opacity: found.material.opacity
      };
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
      setSceneEnvironment(scene, target.texture);
    }

    entry.references += 1;

    return () => {
      const current = sceneEnvironments.get(scene);
      if (!current) return;
      current.references -= 1;
      if (current.references > 0) return;

      if (scene.environment === current.target.texture) {
        setSceneEnvironment(scene, current.previous);
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
    const rawMaterial: unknown = mesh.material;
    const materials = materialList(rawMaterial);

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
  useOriginalTranslateGizmoCenter(object, geometry, selected, settings.enabled);
  const binding = useSurfacePaintGrid(object, selected, settings, geometry);
  const visibleTexture = object.material.paintTexture ? binding.texture : null;
  useSceneMaterialSync(object, geometry, visibleTexture);
  return { ...binding, texture: visibleTexture };
}
