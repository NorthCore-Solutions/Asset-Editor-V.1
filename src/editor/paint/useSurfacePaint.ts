import { useEffect, useMemo } from 'react';
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

const sceneEnvironments = new WeakMap<THREE.Scene, SceneEnvironmentEntry>();
const MARKER_SOURCE_DIAMETER = 0.22;

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

function useContrastCenterMarker(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry,
  selected: boolean,
  paintModeEnabled: boolean
): void {
  const scene = useThree((state) => state.scene);
  const tool = useEditorStore((state) => state.tool);
  const selectedCount = useEditorStore((state) => state.selectedIds.length);
  const geometryMetrics = useMemo(() => {
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const size = bounds?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
    const center = bounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    return {
      localAverageSize: (Math.abs(size.x) + Math.abs(size.y) + Math.abs(size.z)) / 3,
      localCenter: center
    };
  }, [geometry]);
  const marker = useMemo(() => {
    const markerGeometry = new THREE.OctahedronGeometry(MARKER_SOURCE_DIAMETER / 2, 0);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: invertHexColor(object.material.color),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false
    });
    const mesh = new THREE.Mesh(markerGeometry, markerMaterial);
    mesh.name = `Kontrast-Mittelpunkt: ${object.id}`;
    mesh.renderOrder = 2005;
    mesh.frustumCulled = false;
    mesh.raycast = () => undefined;
    return mesh;
  }, [object.id]);

  useEffect(() => {
    scene.add(marker);
    return () => {
      scene.remove(marker);
      marker.geometry.dispose();
      const material = marker.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    };
  }, [marker, scene]);

  useEffect(() => {
    const material = marker.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.color.set(invertHexColor(object.material.color));
    }
  }, [marker, object.material.color]);

  useFrame(() => {
    const visible = selected
      && selectedCount === 1
      && !paintModeEnabled
      && object.visible
      && !object.locked
      && (tool === 'translate' || tool === 'scale');
    marker.visible = visible;
    if (!visible) return;

    const transformedCenter = geometryMetrics.localCenter.clone()
      .multiply(new THREE.Vector3(
        object.scale[0],
        object.scale[1],
        object.scale[2]
      ))
      .applyEuler(new THREE.Euler(
        object.rotation[0],
        object.rotation[1],
        object.rotation[2]
      ));
    marker.position
      .set(object.position[0], object.position[1], object.position[2])
      .add(transformedCenter);
    marker.quaternion.identity();
    const averageWorldSize = geometryMetrics.localAverageSize * (
      Math.abs(object.scale[0]) + Math.abs(object.scale[1]) + Math.abs(object.scale[2])
    ) / 3;
    const diameter = THREE.MathUtils.clamp(averageWorldSize * 0.064, 0.035, 0.32);
    marker.scale.setScalar(diameter / MARKER_SOURCE_DIAMETER);
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
  useContrastCenterMarker(object, geometry, selected, settings.enabled);
  const binding = useSurfacePaintGrid(object, selected, settings, geometry);
  const visibleTexture = object.material.paintTexture ? binding.texture : null;
  useSceneMaterialSync(object, geometry, visibleTexture);
  return { ...binding, texture: visibleTexture };
}
