import { useEffect, useMemo, useRef } from 'react';
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

interface OrbitToggleApi {
  enabled: boolean;
}

interface TranslateMarkerDrag {
  kind: 'translate';
  pointerId: number;
  objectId: string;
  startPosition: THREE.Vector3;
  plane: THREE.Plane;
  startPlanePoint: THREE.Vector3;
}

interface ScaleMarkerDrag {
  kind: 'scale';
  pointerId: number;
  objectId: string;
  startPointerY: number;
  startPosition: THREE.Vector3;
  startScale: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  anchorLocal: THREE.Vector3;
}

type MarkerDrag = TranslateMarkerDrag | ScaleMarkerDrag;

const sceneEnvironments = new WeakMap<THREE.Scene, SceneEnvironmentEntry>();
const MARKER_SOURCE_DIAMETER = 0.22;
const MARKER_HIT_DIAMETER = 0.42;
const SCALE_PIXELS_PER_FACTOR = 140;

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

function stopPointerEvent(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function useContrastCenterMarker(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry,
  selected: boolean,
  paintModeEnabled: boolean
): void {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as unknown as OrbitToggleApi | undefined;
  const tool = useEditorStore((state) => state.tool);
  const selectedCount = useEditorStore((state) => state.selectedIds.length);
  const snap = useEditorStore((state) => state.snap);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const dragRef = useRef<MarkerDrag | null>(null);
  const latestRef = useRef({ object, selected, selectedCount, paintModeEnabled, tool, snap });
  latestRef.current = { object, selected, selectedCount, paintModeEnabled, tool, snap };

  const geometryMetrics = useMemo(() => {
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox?.clone()
      ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const size = bounds.getSize(new THREE.Vector3());
    return {
      bounds,
      localAverageSize: (Math.abs(size.x) + Math.abs(size.y) + Math.abs(size.z)) / 3,
      localCenter: bounds.getCenter(new THREE.Vector3())
    };
  }, [geometry]);

  const marker = useMemo(() => {
    const group = new THREE.Group();
    const visualGeometry = new THREE.OctahedronGeometry(MARKER_SOURCE_DIAMETER / 2, 0);
    const visualMaterial = new THREE.MeshBasicMaterial({
      color: invertHexColor(object.material.color),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false
    });
    const visual = new THREE.Mesh(visualGeometry, visualMaterial);
    visual.name = 'Kontrast-Mittelpunkt sichtbar';
    visual.renderOrder = 2005;
    visual.frustumCulled = false;

    const hitGeometry = new THREE.OctahedronGeometry(MARKER_HIT_DIAMETER / 2, 0);
    const hitMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false
    });
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.name = 'Kontrast-Mittelpunkt Klickfläche';
    hit.renderOrder = 2006;
    hit.frustumCulled = false;

    group.name = `Kontrast-Mittelpunkt: ${object.id}`;
    group.renderOrder = 2005;
    group.frustumCulled = false;
    group.add(visual, hit);
    return group;
  }, [object.id]);

  useEffect(() => {
    scene.add(marker);
    return () => {
      scene.remove(marker);
      marker.traverse((entry) => {
        if (!(entry instanceof THREE.Mesh)) return;
        entry.geometry.dispose();
        const materials = Array.isArray(entry.material) ? entry.material : [entry.material];
        materials.forEach((material) => material.dispose());
      });
      marker.clear();
    };
  }, [marker, scene]);

  useEffect(() => {
    const visual = marker.getObjectByName('Kontrast-Mittelpunkt sichtbar');
    if (!(visual instanceof THREE.Mesh)) return;
    const material = visual.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.color.set(invertHexColor(object.material.color));
    }
  }, [marker, object.material.color]);

  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const setRayFromPointer = (clientX: number, clientY: number): void => {
      const bounds = gl.domElement.getBoundingClientRect();
      pointer.set(
        (clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1,
        -((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
    };

    const removeDragListeners = (): void => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finishDrag, true);
      window.removeEventListener('pointercancel', finishDrag, true);
      window.removeEventListener('blur', finishDrag, true);
    };

    const finishDrag = (event?: Event): void => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event instanceof PointerEvent && event.pointerId !== drag.pointerId) return;
      if (event instanceof PointerEvent) stopPointerEvent(event);

      dragRef.current = null;
      removeDragListeners();
      try {
        gl.domElement.releasePointerCapture(drag.pointerId);
      } catch {
        // Pointer-Capture kann bereits durch den Browser aufgehoben worden sein.
      }
      if (controls) controls.enabled = true;
      endTransaction();
    };

    const handlePointerMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      stopPointerEvent(event);
      const current = latestRef.current;
      if (current.object.id !== drag.objectId) {
        finishDrag(event);
        return;
      }

      if (drag.kind === 'scale') {
        const upwardPixels = drag.startPointerY - event.clientY;
        let factor = Math.max(0.02, 1 + upwardPixels / SCALE_PIXELS_PER_FACTOR);
        if (current.snap.enabled && current.snap.scale > 0) {
          factor = Math.max(0.02, Math.round(factor / current.snap.scale) * current.snap.scale);
        }
        const nextScale = drag.startScale.clone().multiplyScalar(factor);
        const localOffset = new THREE.Vector3(
          drag.anchorLocal.x * (drag.startScale.x - nextScale.x),
          drag.anchorLocal.y * (drag.startScale.y - nextScale.y),
          drag.anchorLocal.z * (drag.startScale.z - nextScale.z)
        ).applyQuaternion(drag.startQuaternion);
        const nextPosition = drag.startPosition.clone().add(localOffset);
        updateObject(drag.objectId, {
          position: [nextPosition.x, nextPosition.y, nextPosition.z],
          scale: [nextScale.x, nextScale.y, nextScale.z]
        }, false);
        return;
      }

      setRayFromPointer(event.clientX, event.clientY);
      const currentPlanePoint = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(drag.plane, currentPlanePoint)) return;
      const nextPosition = drag.startPosition.clone().add(
        currentPlanePoint.clone().sub(drag.startPlanePoint)
      );
      if (current.snap.enabled && current.snap.position > 0) {
        nextPosition.set(
          Math.round(nextPosition.x / current.snap.position) * current.snap.position,
          Math.round(nextPosition.y / current.snap.position) * current.snap.position,
          Math.round(nextPosition.z / current.snap.position) * current.snap.position
        );
      }
      updateObject(drag.objectId, {
        position: [nextPosition.x, nextPosition.y, nextPosition.z]
      }, false);
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || dragRef.current) return;
      const current = latestRef.current;
      const active = current.selected
        && current.selectedCount === 1
        && !current.paintModeEnabled
        && current.object.visible
        && !current.object.locked
        && (current.tool === 'translate' || current.tool === 'scale');
      if (!active || !marker.visible) return;

      marker.updateMatrixWorld(true);
      setRayFromPointer(event.clientX, event.clientY);
      if (raycaster.intersectObject(marker, true).length === 0) return;
      stopPointerEvent(event);

      if (current.tool === 'scale') {
        const anchorLocal = geometryMetrics.localCenter.clone();
        anchorLocal.y = geometryMetrics.bounds.min.y;
        dragRef.current = {
          kind: 'scale',
          pointerId: event.pointerId,
          objectId: current.object.id,
          startPointerY: event.clientY,
          startPosition: new THREE.Vector3(...current.object.position),
          startScale: new THREE.Vector3(...current.object.scale),
          startQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...current.object.rotation)),
          anchorLocal
        };
      } else {
        const normal = camera.getWorldDirection(new THREE.Vector3()).normalize();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, marker.position);
        const startPlanePoint = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, startPlanePoint)) return;
        dragRef.current = {
          kind: 'translate',
          pointerId: event.pointerId,
          objectId: current.object.id,
          startPosition: new THREE.Vector3(...current.object.position),
          plane,
          startPlanePoint
        };
      }

      beginTransaction();
      if (controls) controls.enabled = false;
      try {
        gl.domElement.setPointerCapture(event.pointerId);
      } catch {
        // Pointer-Capture ist nicht in jeder Browser-Situation verfügbar.
      }
      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('pointerup', finishDrag, true);
      window.addEventListener('pointercancel', finishDrag, true);
      window.addEventListener('blur', finishDrag, true);
    };

    gl.domElement.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      gl.domElement.removeEventListener('pointerdown', handlePointerDown, true);
      finishDrag();
      removeDragListeners();
    };
  }, [
    beginTransaction,
    camera,
    controls,
    endTransaction,
    geometryMetrics,
    gl,
    marker,
    updateObject
  ]);

  useFrame(() => {
    const current = latestRef.current;
    const visible = current.selected
      && current.selectedCount === 1
      && !current.paintModeEnabled
      && current.object.visible
      && !current.object.locked
      && (current.tool === 'translate' || current.tool === 'scale');
    marker.visible = visible;
    if (!visible) return;

    const transformedCenter = geometryMetrics.localCenter.clone()
      .multiply(new THREE.Vector3(...current.object.scale))
      .applyEuler(new THREE.Euler(...current.object.rotation));
    marker.position
      .set(...current.object.position)
      .add(transformedCenter);
    marker.quaternion.identity();
    const averageWorldSize = geometryMetrics.localAverageSize * (
      Math.abs(current.object.scale[0])
      + Math.abs(current.object.scale[1])
      + Math.abs(current.object.scale[2])
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
