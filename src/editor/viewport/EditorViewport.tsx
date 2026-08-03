import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import { findFormSurfaceSnap, isFormType } from '../snapping/primitiveSurfaceSnap';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData, SnapSettings, TransformMode } from '../../types/editor';
import { useSurfacePaint, useSurfacePaintSettings } from '../paint/useSurfacePaint';
import type { SurfacePaintSettings } from '../paint/surfacePaintSession';
import { PrimitiveSnapPattern } from './PrimitiveSnapPattern';

interface OrbitControlApi {
  target: THREE.Vector3;
  enabled: boolean;
  update: () => void;
}

type ScaleAxis = 'X' | 'Y' | 'Z';
type ScaleSide = -1 | 1;
type CornerSides = [ScaleSide, ScaleSide, ScaleSide];
type MeshRegistry = MutableRefObject<Map<string, THREE.Mesh>>;

interface AxisScaleDragState {
  kind: 'axis';
  axis: ScaleAxis;
  side: ScaleSide;
  pointerId: number;
  startPointer: THREE.Vector2;
  screenAxis: THREE.Vector2;
  pixelsPerWorldUnit: number;
  anchorCoordinate: number;
  localSize: number;
  startPosition: THREE.Vector3;
  startScale: THREE.Vector3;
  worldAxis: THREE.Vector3;
}

interface UniformScaleDragState {
  kind: 'uniform';
  pointerId: number;
  startPointer: THREE.Vector2;
  screenAxis: THREE.Vector2;
  pixelsPerWorldUnit: number;
  startDiagonalWorld: number;
  worldDirection: THREE.Vector3;
  anchorLocal: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startScale: THREE.Vector3;
}

interface CenterScaleDragState {
  kind: 'center';
  pointerId: number;
  startPointer: THREE.Vector2;
  anchorLocal: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startScale: THREE.Vector3;
  pixelsPerFactor: number;
}

type ScaleDragState = AxisScaleDragState | UniformScaleDragState | CenterScaleDragState;

interface GroupDragState {
  proxyMatrix: THREE.Matrix4;
  objectMatrices: Map<string, THREE.Matrix4>;
}

interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface SelectionApi {
  idsInRect: (rect: SelectionRect) => string[];
}

interface MarqueeState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const GRID_EXTENT = 400;
const SCALE_HANDLE_SIZE_RATIO = 0.06;
const CORNERS: CornerSides[] = [
  [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
  [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]
];

const axisValue = (vector: THREE.Vector3, axis: ScaleAxis): number => {
  if (axis === 'X') return vector.x;
  if (axis === 'Y') return vector.y;
  return vector.z;
};

const setAxisValue = (vector: THREE.Vector3, axis: ScaleAxis, value: number): void => {
  if (axis === 'X') vector.x = value;
  else if (axis === 'Y') vector.y = value;
  else vector.z = value;
};

const axisVector = (axis: ScaleAxis, value: number): THREE.Vector3 => {
  if (axis === 'X') return new THREE.Vector3(value, 0, 0);
  if (axis === 'Y') return new THREE.Vector3(0, value, 0);
  return new THREE.Vector3(0, 0, value);
};

const boundingValue = (box: THREE.Box3, axis: ScaleAxis, side: 'min' | 'max'): number => {
  const vector = side === 'min' ? box.min : box.max;
  return axisValue(vector, axis);
};

const cornerPoint = (bounds: THREE.Box3, sides: CornerSides): THREE.Vector3 => new THREE.Vector3(
  sides[0] === 1 ? bounds.max.x : bounds.min.x,
  sides[1] === 1 ? bounds.max.y : bounds.min.y,
  sides[2] === 1 ? bounds.max.z : bounds.min.z
);

const scaleHandleWorldSize = (mesh: THREE.Mesh, bounds: THREE.Box3): number => {
  const localSize = bounds.getSize(new THREE.Vector3());
  const averageWorldSize = (
    Math.abs(localSize.x * mesh.scale.x)
    + Math.abs(localSize.y * mesh.scale.y)
    + Math.abs(localSize.z * mesh.scale.z)
  ) / 3;
  return Math.max(0.0001, averageWorldSize * SCALE_HANDLE_SIZE_RATIO);
};

function KeyboardCameraControls({ active }: { active: boolean }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const pressedKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!active) {
      pressedKeys.current.clear();
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!CAMERA_KEYS.has(key)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pressedKeys.current.add(key);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!CAMERA_KEYS.has(key)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pressedKeys.current.delete(key);
    };

    const clearKeys = () => pressedKeys.current.clear();
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', clearKeys);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', clearKeys);
      pressedKeys.current.clear();
    };
  }, [active]);

  useFrame((_, delta) => {
    if (!active || !controls || pressedKeys.current.size === 0) return;

    const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 0.000001) {
      camera.getWorldDirection(forward);
      forward.y = 0;
    }
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const translation = new THREE.Vector3();
    if (pressedKeys.current.has('w')) translation.add(forward);
    if (pressedKeys.current.has('s')) translation.sub(forward);
    if (pressedKeys.current.has('a')) translation.sub(right);
    if (pressedKeys.current.has('d')) translation.add(right);

    if (translation.lengthSq() > 0) {
      translation.normalize().multiplyScalar(4.5 * delta);
      camera.position.add(translation);
      controls.target.add(translation);
    }

    const rotationDirection = Number(pressedKeys.current.has('q')) - Number(pressedKeys.current.has('e'));
    if (rotationDirection !== 0) {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationDirection * 1.6 * delta);
      camera.position.copy(controls.target).add(offset);
    }

    camera.updateMatrixWorld();
    controls.update();
  });

  return null;
}

function CameraController({ active }: { active: boolean }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const cameraView = useEditorStore((state) => state.cameraView);
  const cameraRequestId = useEditorStore((state) => state.cameraRequestId);

  useEffect(() => {
    if (!active) return;
    const { objects, selectedIds } = useEditorStore.getState();
    const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
    const target = selectedObjects.length > 0
      ? selectedObjects.reduce((sum, object) => sum.add(new THREE.Vector3(...object.position)), new THREE.Vector3()).divideScalar(selectedObjects.length)
      : new THREE.Vector3(0, 0.8, 0);
    const distance = selectedObjects.length > 0
      ? Math.max(3.5, ...selectedObjects.map((object) => Math.max(...object.scale) * 4))
      : 8;
    const positions: Record<Exclude<typeof cameraView, 'focus'>, [number, number, number]> = {
      perspective: [target.x + 6, target.y + 5, target.z + 7],
      front: [target.x, target.y, target.z + distance],
      back: [target.x, target.y, target.z - distance],
      left: [target.x - distance, target.y, target.z],
      right: [target.x + distance, target.y, target.z],
      top: [target.x, target.y + distance, target.z + 0.001],
      bottom: [target.x, target.y - distance, target.z + 0.001]
    };
    const position: [number, number, number] = cameraView === 'focus'
      ? [target.x + distance, target.y + distance * 0.65, target.z + distance]
      : (positions[cameraView] ?? positions.perspective);
    camera.up.set(0, 1, 0);
    if (cameraView === 'top') camera.up.set(0, 0, -1);
    if (cameraView === 'bottom') camera.up.set(0, 0, 1);
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target);
    controls?.target.copy(target);
    controls?.update();
    camera.updateProjectionMatrix();
  }, [active, camera, cameraRequestId, cameraView, controls]);

  return null;
}

function SelectionBridge({ registry, onReady }: { registry: MeshRegistry; onReady: (api: SelectionApi) => void }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const api: SelectionApi = {
      idsInRect: (rect) => {
        const canvasRect = gl.domElement.getBoundingClientRect();
        const ids: string[] = [];
        for (const [id, mesh] of registry.current) {
          if (!mesh.visible) continue;
          mesh.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(mesh);
          if (box.isEmpty()) continue;
          const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z), new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z), new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z), new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z)
          ];
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          for (const corner of corners) {
            const projected = corner.project(camera);
            const x = canvasRect.left + (projected.x + 1) * canvasRect.width * 0.5;
            const y = canvasRect.top + (1 - projected.y) * canvasRect.height * 0.5;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
          const intersects = maxX >= rect.left && minX <= rect.right && maxY >= rect.top && minY <= rect.bottom;
          if (intersects) ids.push(id);
        }
        return ids;
      }
    };

    onReady(api);
  }, [camera, gl, onReady, registry]);

  return null;
}

function ScaleHandle({ mesh, bounds, axis, side, color, onPointerDown }: {
  mesh: THREE.Mesh;
  bounds: THREE.Box3;
  axis: ScaleAxis;
  side: ScaleSide;
  color: string;
  onPointerDown: (axis: ScaleAxis, side: ScaleSide, event: ThreeEvent<PointerEvent>) => void;
}) {
  const handleRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;
    mesh.updateMatrixWorld();
    const localPoint = bounds.getCenter(new THREE.Vector3());
    const edge = boundingValue(bounds, axis, side === 1 ? 'max' : 'min');
    setAxisValue(localPoint, axis, edge);
    handle.position.copy(mesh.localToWorld(localPoint));
    handle.quaternion.copy(mesh.quaternion);
    handle.scale.setScalar(scaleHandleWorldSize(mesh, bounds) / 0.72);
  });

  return (
    <mesh ref={handleRef} renderOrder={1000} onPointerDown={(event) => onPointerDown(axis, side, event)}>
      <boxGeometry args={[0.72, 0.72, 0.72]} />
      <meshBasicMaterial color={color} transparent opacity={0.96} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function CenterScaleHandle({ mesh, bounds, onPointerDown }: {
  mesh: THREE.Mesh;
  bounds: THREE.Box3;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const handleRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;

    mesh.updateMatrixWorld(true);
    const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
    handle.position.copy(worldPosition);
    handle.quaternion.identity();
    handle.scale.setScalar(scaleHandleWorldSize(mesh, bounds) / 0.2);
  });

  return (
    <group ref={handleRef} renderOrder={Infinity}>
      <mesh renderOrder={Infinity}>
        <octahedronGeometry args={[0.1, 0]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.25}
          depthTest={false}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <mesh renderOrder={Infinity} onPointerDown={onPointerDown}>
        <octahedronGeometry args={[0.2, 0]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function CornerScaleHandle({ mesh, bounds, sides, onPointerDown }: {
  mesh: THREE.Mesh;
  bounds: THREE.Box3;
  sides: CornerSides;
  onPointerDown: (sides: CornerSides, event: ThreeEvent<PointerEvent>) => void;
}) {
  const handleRef = useRef<THREE.Mesh>(null);
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;
    mesh.updateMatrixWorld();
    const localPoint = cornerPoint(bounds, sides);
    handle.position.copy(mesh.localToWorld(localPoint));
    handle.quaternion.copy(camera.quaternion);
    handle.scale.setScalar((scaleHandleWorldSize(mesh, bounds) * 1.08) / 1.05);
  });

  return (
    <mesh ref={handleRef} renderOrder={1001} onPointerDown={(event) => onPointerDown(sides, event)}>
      <planeGeometry args={[1.05, 1.05]} />
      <meshBasicMaterial color="#ffff00" transparent opacity={0.48} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function ScaleHandles({ mesh, geometry, object, snap, onSnapTargetChange, onTransformDraggingChange }: {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  object: SceneObjectData;
  snap: SnapSettings;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const objects = useEditorStore((state) => state.objects);
  const dragRef = useRef<ScaleDragState | null>(null);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.clone() ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  }, [geometry]);

  const removeWindowListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', finishDrag, true);
    window.removeEventListener('pointercancel', finishDrag, true);
    window.removeEventListener('blur', finishDrag, true);
  };

  const syncTransform = () => {
    updateObject(object.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
    }, false);
  };

  const applySurfaceScaleSnap = (drag: ScaleDragState) => {
    if (drag.kind === 'center') {
      onSnapTargetChange(null);
      return;
    }

    if (!snap.surface || !isFormType(object.type)) {
      onSnapTargetChange(null);
      return;
    }

    const candidate: SceneObjectData = {
      ...object,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
    };
    const result = findFormSurfaceSnap(candidate, objects, snap.position);
    if (!result.targetId) {
      onSnapTargetChange(null);
      return;
    }

    const correction = new THREE.Vector3(...result.position).sub(mesh.position);
    const correctionLength = correction.length();
    if (correctionLength <= 0.000001) {
      onSnapTargetChange(result.targetId);
      return;
    }

    if (drag.kind === 'axis') {
      const outwardAxis = drag.worldAxis.clone().multiplyScalar(drag.side);
      const projectedCorrection = correction.dot(outwardAxis);
      const alignment = Math.abs(projectedCorrection) / correctionLength;
      if (alignment < 0.7) {
        onSnapTargetChange(null);
        return;
      }

      const startScale = axisValue(drag.startScale, drag.axis);
      const currentScale = axisValue(mesh.scale, drag.axis);
      const snappedScale = Math.max(0.02, currentScale + projectedCorrection / drag.localSize);
      setAxisValue(mesh.scale, drag.axis, snappedScale);
      const anchorOffset = drag.anchorCoordinate * (startScale - snappedScale);
      mesh.position.copy(drag.startPosition).addScaledVector(drag.worldAxis, anchorOffset);
      mesh.updateMatrixWorld(true);
      onSnapTargetChange(result.targetId);
      return;
    }

    const projectedCorrection = correction.dot(drag.worldDirection);
    const alignment = Math.abs(projectedCorrection) / correctionLength;
    if (alignment < 0.35) {
      onSnapTargetChange(null);
      return;
    }

    const factors = [
      Math.abs(drag.startScale.x) > 0.000001 ? mesh.scale.x / drag.startScale.x : 1,
      Math.abs(drag.startScale.y) > 0.000001 ? mesh.scale.y / drag.startScale.y : 1,
      Math.abs(drag.startScale.z) > 0.000001 ? mesh.scale.z / drag.startScale.z : 1
    ];
    const currentFactor = factors.reduce((sum, factor) => sum + factor, 0) / factors.length;
    const snappedFactor = Math.max(0.02, currentFactor + projectedCorrection / drag.startDiagonalWorld);
    const snappedScale = drag.startScale.clone().multiplyScalar(snappedFactor);
    mesh.scale.copy(snappedScale);
    const localOffset = new THREE.Vector3(
      drag.anchorLocal.x * (drag.startScale.x - snappedScale.x),
      drag.anchorLocal.y * (drag.startScale.y - snappedScale.y),
      drag.anchorLocal.z * (drag.startScale.z - snappedScale.z)
    ).applyQuaternion(drag.startQuaternion);
    mesh.position.copy(drag.startPosition).add(localOffset);
    mesh.updateMatrixWorld(true);
    onSnapTargetChange(result.targetId);
  };

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    if (drag.kind === 'center') {
      const upwardPixels = drag.startPointer.y - event.clientY;
      let factor = Math.max(0.02, 1 + upwardPixels / drag.pixelsPerFactor);
      if (snap.enabled && snap.scale > 0) {
        factor = Math.max(0.02, Math.round(factor / snap.scale) * snap.scale);
      }
      const nextScale = drag.startScale.clone().multiplyScalar(factor);
      mesh.scale.copy(nextScale);
      const localOffset = new THREE.Vector3(
        drag.anchorLocal.x * (drag.startScale.x - nextScale.x),
        drag.anchorLocal.y * (drag.startScale.y - nextScale.y),
        drag.anchorLocal.z * (drag.startScale.z - nextScale.z)
      ).applyQuaternion(drag.startQuaternion);
      mesh.position.copy(drag.startPosition).add(localOffset);
      mesh.updateMatrixWorld();
      onSnapTargetChange(null);
      syncTransform();
      return;
    }

    const pointerDelta = new THREE.Vector2(event.clientX - drag.startPointer.x, event.clientY - drag.startPointer.y);
    const worldDelta = pointerDelta.dot(drag.screenAxis) / drag.pixelsPerWorldUnit;

    if (drag.kind === 'axis') {
      const startScale = axisValue(drag.startScale, drag.axis);
      const startWorldSize = drag.localSize * startScale;
      const minimumScale = 0.02;
      let nextScale = Math.max(minimumScale, (startWorldSize + worldDelta) / drag.localSize);
      if (snap.enabled && snap.scale > 0) nextScale = Math.max(minimumScale, Math.round(nextScale / snap.scale) * snap.scale);
      const nextScaleVector = drag.startScale.clone();
      setAxisValue(nextScaleVector, drag.axis, nextScale);
      mesh.scale.copy(nextScaleVector);
      const anchorOffset = drag.anchorCoordinate * (startScale - nextScale);
      mesh.position.copy(drag.startPosition).addScaledVector(drag.worldAxis, anchorOffset);
      mesh.updateMatrixWorld();
      applySurfaceScaleSnap(drag);
      syncTransform();
      return;
    }

    let factor = Math.max(0.02, (drag.startDiagonalWorld + worldDelta) / drag.startDiagonalWorld);
    if (snap.enabled && snap.scale > 0) factor = Math.max(0.02, Math.round(factor / snap.scale) * snap.scale);
    const nextScale = drag.startScale.clone().multiplyScalar(factor);
    mesh.scale.copy(nextScale);
    const localOffset = new THREE.Vector3(
      drag.anchorLocal.x * (drag.startScale.x - nextScale.x),
      drag.anchorLocal.y * (drag.startScale.y - nextScale.y),
      drag.anchorLocal.z * (drag.startScale.z - nextScale.z)
    ).applyQuaternion(drag.startQuaternion);
    mesh.position.copy(drag.startPosition).add(localOffset);
    mesh.updateMatrixWorld();
    applySurfaceScaleSnap(drag);
    syncTransform();
  }

  function finishDrag(event?: Event) {
    const drag = dragRef.current;
    if (!drag || (event instanceof PointerEvent && event.pointerId !== drag.pointerId)) return;
    event?.preventDefault();
    event?.stopPropagation();
    dragRef.current = null;
    removeWindowListeners();
    syncTransform();
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
    if (controls) controls.enabled = true;
  }

  const beginDrag = () => {
    if (controls) controls.enabled = false;
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finishDrag, true);
    window.addEventListener('pointercancel', finishDrag, true);
    window.addEventListener('blur', finishDrag, true);
  };

  const startAxisDrag = (axis: ScaleAxis, side: ScaleSide, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    const localSize = boundingValue(bounds, axis, 'max') - boundingValue(bounds, axis, 'min');
    if (localSize <= 0.000001) return;
    const startQuaternion = mesh.quaternion.clone();
    const positiveWorldAxis = axisVector(axis, 1).applyQuaternion(startQuaternion).normalize();
    const outwardWorldAxis = positiveWorldAxis.clone().multiplyScalar(side);
    const centerProjected = mesh.position.clone().project(camera);
    const axisProjected = mesh.position.clone().add(outwardWorldAxis).project(camera);
    const screenAxis = new THREE.Vector2((axisProjected.x - centerProjected.x) * size.width * 0.5, -(axisProjected.y - centerProjected.y) * size.height * 0.5);
    const pixelsPerWorldUnit = screenAxis.length();
    if (pixelsPerWorldUnit < 2) return;
    screenAxis.normalize();
    dragRef.current = {
      kind: 'axis', axis, side, pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY), screenAxis, pixelsPerWorldUnit,
      anchorCoordinate: boundingValue(bounds, axis, side === 1 ? 'min' : 'max'), localSize,
      startPosition: mesh.position.clone(), startScale: mesh.scale.clone(), worldAxis: positiveWorldAxis
    };
    beginDrag();
  };

  const startCenterDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    const anchorLocal = bounds.getCenter(new THREE.Vector3());
    anchorLocal.y = bounds.min.y;
    dragRef.current = {
      kind: 'center',
      pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY),
      anchorLocal,
      startPosition: mesh.position.clone(),
      startQuaternion: mesh.quaternion.clone(),
      startScale: mesh.scale.clone(),
      pixelsPerFactor: 140
    };
    beginDrag();
  };

  const startUniformDrag = (sides: CornerSides, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    event.nativeEvent.stopImmediatePropagation();
    const startQuaternion = mesh.quaternion.clone();
    const draggedLocal = cornerPoint(bounds, sides);
    const oppositeSides: CornerSides = [-sides[0], -sides[1], -sides[2]];
    const anchorLocal = cornerPoint(bounds, oppositeSides);
    const scaledDiagonal = draggedLocal.clone().sub(anchorLocal).multiply(mesh.scale);
    const startDiagonalWorld = scaledDiagonal.length();
    if (startDiagonalWorld <= 0.000001) return;
    const worldDirection = scaledDiagonal.applyQuaternion(startQuaternion).normalize();
    const centerProjected = mesh.position.clone().project(camera);
    const axisProjected = mesh.position.clone().add(worldDirection).project(camera);
    const screenAxis = new THREE.Vector2((axisProjected.x - centerProjected.x) * size.width * 0.5, -(axisProjected.y - centerProjected.y) * size.height * 0.5);
    const pixelsPerWorldUnit = screenAxis.length();
    if (pixelsPerWorldUnit < 2) return;
    screenAxis.normalize();
    dragRef.current = {
      kind: 'uniform', pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY), screenAxis, pixelsPerWorldUnit,
      startDiagonalWorld, worldDirection, anchorLocal, startPosition: mesh.position.clone(), startQuaternion, startScale: mesh.scale.clone()
    };
    beginDrag();
  };

  useEffect(() => () => {
    if (!dragRef.current) return;
    removeWindowListeners();
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();
    if (controls) controls.enabled = true;
    onTransformDraggingChange(false);
  }, [controls, endTransaction, onSnapTargetChange, onTransformDraggingChange]);

  return (
    <>
      <CenterScaleHandle mesh={mesh} bounds={bounds} onPointerDown={startCenterDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="X" side={-1} color="#ff3653" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="X" side={1} color="#ff3653" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Y" side={-1} color="#8adb00" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Y" side={1} color="#8adb00" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Z" side={-1} color="#2c8fff" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Z" side={1} color="#2c8fff" onPointerDown={startAxisDrag} />
      {CORNERS.map((sides) => <CornerScaleHandle key={sides.join(':')} mesh={mesh} bounds={bounds} sides={sides} onPointerDown={startUniformDrag} />)}
    </>
  );
}

function GroupTransformControls({ selectedIds, registry, tool, snap, onTransformDraggingChange }: {
  selectedIds: string[];
  registry: MeshRegistry;
  tool: TransformMode;
  snap: SnapSettings;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const proxy = useMemo(() => new THREE.Object3D(), []);
  const dragRef = useRef<GroupDragState | null>(null);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const selectionKey = selectedIds.join(':');

  const resetProxy = useCallback(() => {
    const meshes = selectedIds.map((id) => registry.current.get(id)).filter((mesh): mesh is THREE.Mesh => Boolean(mesh));
    if (meshes.length === 0) return;
    const center = meshes.reduce((sum, mesh) => sum.add(mesh.getWorldPosition(new THREE.Vector3())), new THREE.Vector3()).divideScalar(meshes.length);
    proxy.position.copy(center);
    proxy.rotation.set(0, 0, 0);
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld(true);
  }, [proxy, registry, selectedIds]);

  useEffect(() => resetProxy(), [resetProxy, selectionKey]);

  const start = () => {
    resetProxy();
    const objectMatrices = new Map<string, THREE.Matrix4>();
    for (const id of selectedIds) {
      const mesh = registry.current.get(id);
      if (!mesh) continue;
      mesh.updateMatrixWorld(true);
      objectMatrices.set(id, mesh.matrixWorld.clone());
    }
    proxy.updateMatrixWorld(true);
    dragRef.current = { proxyMatrix: proxy.matrixWorld.clone(), objectMatrices };
    beginTransaction();
    onTransformDraggingChange(true);
  };

  const sync = () => {
    const drag = dragRef.current;
    if (!drag) return;
    proxy.updateMatrixWorld(true);
    const delta = proxy.matrixWorld.clone().multiply(drag.proxyMatrix.clone().invert());
    for (const [id, startMatrix] of drag.objectMatrices) {
      const mesh = registry.current.get(id);
      if (!mesh) continue;
      const worldMatrix = delta.clone().multiply(startMatrix);
      const localMatrix = mesh.parent ? mesh.parent.matrixWorld.clone().invert().multiply(worldMatrix) : worldMatrix;
      localMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrixWorld(true);
      updateObject(id, {
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
      }, false);
    }
  };

  const stop = () => {
    sync();
    dragRef.current = null;
    endTransaction();
    onTransformDraggingChange(false);
    resetProxy();
  };

  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode={tool}
        space="world"
        size={tool === 'rotate' ? 1.4 : 1.15}
        translationSnap={snap.enabled ? snap.position : undefined}
        rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}
        scaleSnap={snap.enabled ? snap.scale : undefined}
        onMouseDown={start}
        onObjectChange={sync}
        onMouseUp={stop}
      />
    </>
  );
}

function SceneMesh({ object, registry, snapTargetId, onSnapTargetChange, onTransformDraggingChange, paintSettings }: {
  object: SceneObjectData;
  registry: MeshRegistry;
  snapTargetId: string | null;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
  paintSettings: SurfacePaintSettings;
}) {
  const objects = useEditorStore((state) => state.objects);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const geometry = useMemo(() => createGeometry({ type: object.type, geometry: object.geometry }), [object.geometry, object.type]);
  const selected = selectedIds.includes(object.id);
  const singleSelection = selected && selectedIds.length === 1;
  const paint = useSurfacePaint(object, singleSelection, paintSettings, geometry);
  const snapToolActive = tool === 'translate' || tool === 'scale';
  const showSnapPattern = !paintSettings.enabled && snap.surface && snapToolActive && isFormType(object.type) && !singleSelection && object.visible;

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    if (mesh) registry.current.set(object.id, mesh);
    return () => { registry.current.delete(object.id); };
  }, [mesh, object.id, registry]);

  const syncTransform = () => {
    if (!mesh) return;

    let position: SceneObjectData['position'] = [mesh.position.x, mesh.position.y, mesh.position.z];
    const rotation: SceneObjectData['rotation'] = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
    const scale: SceneObjectData['scale'] = [mesh.scale.x, mesh.scale.y, mesh.scale.z];

    if (tool === 'translate' && snap.surface && singleSelection && isFormType(object.type)) {
      const candidate: SceneObjectData = { ...object, position, rotation, scale };
      const result = findFormSurfaceSnap(candidate, objects, snap.position);
      position = result.position;
      if (result.targetId) {
        mesh.position.set(position[0], position[1], position[2]);
        mesh.updateMatrixWorld(true);
      }
      onSnapTargetChange(result.targetId);
    } else if (tool === 'translate') {
      onSnapTargetChange(null);
    }

    updateObject(object.id, { position, rotation, scale }, false);
  };

  const startTransform = () => {
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
  };
  const stopTransform = () => {
    syncTransform();
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
  };

  return (
    <>
      <mesh
        ref={setMesh}
        name={object.name}
        geometry={geometry}
        position={object.position}
        rotation={object.rotation}
        scale={object.scale}
        visible={object.visible}
        castShadow
        receiveShadow
        onPointerDown={(event) => {
          if (paintSettings.enabled) {
            paint.onPointerDown(event);
            event.stopPropagation();
            return;
          }
          if (event.button === 2) event.stopPropagation();
        }}
        onPointerMove={paint.onPointerMove}
        onPointerUp={paint.onPointerUp}
        onPointerCancel={paint.onPointerCancel}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          if (paintSettings.enabled) return;
          select(object.id, event.shiftKey);
        }}
      >
        <meshStandardMaterial
          map={paint.texture}
          color={paint.texture ? '#FFFFFF' : object.material.color}
          roughness={object.material.roughness}
          metalness={object.material.metalness}
          opacity={object.material.opacity}
          transparent={object.material.opacity < 1 || Boolean(paint.texture)}
          alphaTest={paint.texture ? 0.001 : 0}
          flatShading={object.material.flatShading}
          emissive="#000000"
          emissiveIntensity={0}
        />
      </mesh>

      {showSnapPattern && (
        <PrimitiveSnapPattern
          geometry={geometry}
          object={object}
          cellSize={snap.position}
          highlighted={snapTargetId === object.id}
        />
      )}

      {!paintSettings.enabled && singleSelection && !object.locked && object.visible && mesh && (
        tool === 'scale' ? (
          <ScaleHandles
            mesh={mesh}
            geometry={geometry}
            object={object}
            snap={snap}
            onSnapTargetChange={onSnapTargetChange}
            onTransformDraggingChange={onTransformDraggingChange}
          />
        ) : (
          <TransformControls
            object={mesh}
            mode={tool}
            space="world"
            size={tool === 'rotate' ? 1.4 : 1.15}
            translationSnap={snap.enabled ? snap.position : undefined}
            rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}
            onMouseDown={startTransform}
            onObjectChange={syncTransform}
            onMouseUp={stopTransform}
          />
        )
      )}
    </>
  );
}

function StableGrid({ cellSize }: { cellSize: number }) {
  const gridProps = {
    args: [GRID_EXTENT, GRID_EXTENT] as [number, number], cellSize, cellThickness: 0.6, cellColor: '#53626a',
    sectionSize: cellSize * 5, sectionThickness: 1, sectionColor: '#4f8f68', fadeDistance: 1000,
    fadeStrength: 0, followCamera: false, infiniteGrid: false, frustumCulled: false, renderOrder: 1
  };
  return <group><Grid {...gridProps} position={[0, 0.003, 0]} /><Grid {...gridProps} position={[0, -0.003, 0]} rotation={[Math.PI, 0, 0]} /></group>;
}

function EditorScene({ keyboardActive, selectionActive, registry, onSelectionApi, paintSettings }: {
  keyboardActive: boolean;
  selectionActive: boolean;
  registry: MeshRegistry;
  onSelectionApi: (api: SelectionApi) => void;
  paintSettings: SurfacePaintSettings;
}) {
  const objects = useEditorStore((state) => state.objects);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);
  const [transformDragging, setTransformDragging] = useState(false);
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null);
  const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
  const groupMovable = !paintSettings.enabled
    && selectedObjects.length > 1
    && selectedObjects.every((object) => object.visible && !object.locked);

  useEffect(() => {
    if (!snap.surface || (tool !== 'translate' && tool !== 'scale') || paintSettings.enabled) setSnapTargetId(null);
  }, [paintSettings.enabled, snap.surface, tool]);

  return (
    <>
      <color attach="background" args={[scene.background]} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[6, 10, 5]} intensity={2.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <hemisphereLight args={['#dbe7ee', '#2a312c', 0.8]} />
      {scene.gridVisible && <StableGrid cellSize={scene.gridSize} />}
      {scene.axesVisible && <axesHelper args={[3]} />}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        onClick={(event) => {
          if (!paintSettings.enabled && event.button === 0 && !event.ctrlKey) select(null);
        }}
      >
        <planeGeometry args={[GRID_EXTENT, GRID_EXTENT]} />
        <shadowMaterial opacity={0.14} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {objects.map((object) => (
        <SceneMesh
          key={object.id}
          object={object}
          registry={registry}
          snapTargetId={snapTargetId}
          onSnapTargetChange={setSnapTargetId}
          onTransformDraggingChange={setTransformDragging}
          paintSettings={paintSettings}
        />
      ))}
      {groupMovable && <GroupTransformControls selectedIds={selectedIds} registry={registry} tool={tool} snap={snap} onTransformDraggingChange={setTransformDragging} />}
      <OrbitControls
        makeDefault
        enabled={!transformDragging && !selectionActive}
        enablePan={!paintSettings.enabled}
        enableRotate={!paintSettings.enabled}
        enableZoom
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
      />
      <KeyboardCameraControls active={!paintSettings.enabled && keyboardActive && !transformDragging && !selectionActive} />
      <CameraController active />
      <SelectionBridge registry={registry} onReady={onSelectionApi} />
    </>
  );
}

export function EditorViewport() {
  const select = useEditorStore((state) => state.select);
  const selectMany = useEditorStore((state) => state.selectMany);
  const paintSettings = useSurfacePaintSettings();
  const viewportRef = useRef<HTMLDivElement>(null);
  const registry = useRef(new Map<string, THREE.Mesh>());
  const selectionApiRef = useRef<SelectionApi | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const suppressNextClickRef = useRef(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  const registerSelectionApi = useCallback((api: SelectionApi) => { selectionApiRef.current = api; }, []);

  const removeMarqueeListeners = useCallback(() => {
    window.removeEventListener('pointermove', handleMarqueeMove, true);
    window.removeEventListener('pointerup', finishMarquee, true);
    window.removeEventListener('pointercancel', finishMarquee, true);
    window.removeEventListener('blur', finishMarquee, true);
  }, []);

  function stopMarqueeEvent(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
  }

  function handleMarqueeMove(event: PointerEvent) {
    const current = marqueeRef.current;
    const viewport = viewportRef.current;
    if (!current || !viewport || event.pointerId !== current.pointerId) return;
    stopMarqueeEvent(event);
    const bounds = viewport.getBoundingClientRect();
    const next = {
      ...current,
      currentX: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      currentY: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    };
    marqueeRef.current = next;
    setMarquee(next);
  }

  function finishMarquee(event?: Event) {
    const current = marqueeRef.current;
    const viewport = viewportRef.current;
    if (!current || !viewport) return;
    if (event instanceof PointerEvent && event.pointerId !== current.pointerId) return;
    if (event) stopMarqueeEvent(event);
    removeMarqueeListeners();
    marqueeRef.current = null;
    setMarquee(null);

    const width = Math.abs(current.currentX - current.startX);
    const height = Math.abs(current.currentY - current.startY);
    suppressNextClickRef.current = true;
    if (width < 4 || height < 4) return;

    const viewportBounds = viewport.getBoundingClientRect();
    const rect: SelectionRect = {
      left: viewportBounds.left + Math.min(current.startX, current.currentX),
      top: viewportBounds.top + Math.min(current.startY, current.currentY),
      right: viewportBounds.left + Math.max(current.startX, current.currentX),
      bottom: viewportBounds.top + Math.max(current.startY, current.currentY)
    };
    const ids = selectionApiRef.current?.idsInRect(rect) ?? [];
    selectMany(ids, event instanceof PointerEvent && event.shiftKey);
  }

  useEffect(() => () => removeMarqueeListeners(), [removeMarqueeListeners]);

  const startMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    viewportRef.current?.focus();
    if (paintSettings.enabled || event.button !== 0 || !event.ctrlKey || !viewportRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();

    const bounds = viewportRef.current.getBoundingClientRect();
    const state: MarqueeState = {
      pointerId: event.pointerId,
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
      currentX: event.clientX - bounds.left,
      currentY: event.clientY - bounds.top
    };
    marqueeRef.current = state;
    suppressNextClickRef.current = false;
    setMarquee(state);
    window.addEventListener('pointermove', handleMarqueeMove, true);
    window.addEventListener('pointerup', finishMarquee, true);
    window.addEventListener('pointercancel', finishMarquee, true);
    window.addEventListener('blur', finishMarquee, true);
  };

  const marqueeStyle = marquee ? {
    left: Math.min(marquee.startX, marquee.currentX),
    top: Math.min(marquee.startY, marquee.currentY),
    width: Math.abs(marquee.currentX - marquee.startX),
    height: Math.abs(marquee.currentY - marquee.startY)
  } : undefined;

  return (
    <div
      ref={viewportRef}
      className="viewport"
      tabIndex={0}
      onPointerDownCapture={startMarquee}
      onClickCapture={(event) => {
        if (!suppressNextClickRef.current) return;
        suppressNextClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onFocus={() => setKeyboardActive(true)}
      onBlur={() => setKeyboardActive(false)}
    >
      <Canvas
        shadows
        camera={{ position: [6, 5, 7], fov: 45, near: 0.05, far: 500 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={(event) => {
          if (!paintSettings.enabled && event.button === 0 && !event.ctrlKey && !suppressNextClickRef.current) select(null);
        }}
      >
        <EditorScene
          keyboardActive={keyboardActive}
          selectionActive={Boolean(marquee)}
          registry={registry}
          onSelectionApi={registerSelectionApi}
          paintSettings={paintSettings}
        />
      </Canvas>
      {marquee && <div className="selection-marquee" style={marqueeStyle} />}
      {paintSettings.enabled && (
        <div style={{
          position: 'absolute', left: 12, top: 12, zIndex: 10, pointerEvents: 'none',
          padding: '6px 9px', border: '1px solid #68a47d', borderRadius: 4,
          background: 'rgba(25, 48, 36, 0.9)', color: '#dff4e7', fontSize: 12
        }}>
          Malmodus aktiv · direkt auf das ausgewählte Objekt malen
        </div>
      )}
      <div className="viewport-hint">
        {paintSettings.enabled
          ? 'Malmodus: Mausrad-Zoom und Perspektivwechsel verfügbar · Transformation gesperrt'
          : 'Strg + Linksklick-Ziehen: Auswahlrahmen · Shift + Linksklick: Mehrfachauswahl · Strg + G: gruppieren'}
      </div>
    </div>
  );
}
