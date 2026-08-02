import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData, SnapSettings, TransformMode } from '../../types/editor';

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
  anchorLocal: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startScale: THREE.Vector3;
}

type ScaleDragState = AxisScaleDragState | UniformScaleDragState;

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
  hitTest: (clientX: number, clientY: number) => boolean;
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

function CameraController() {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const cameraView = useEditorStore((state) => state.cameraView);
  const cameraRequestId = useEditorStore((state) => state.cameraRequestId);

  useEffect(() => {
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
  }, [camera, cameraRequestId, cameraView, controls]);

  return null;
}

function SelectionBridge({ registry, onReady }: { registry: MeshRegistry; onReady: (api: SelectionApi) => void }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const clientToNdc = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const api: SelectionApi = {
      hitTest: (clientX, clientY) => {
        clientToNdc(clientX, clientY);
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects([...registry.current.values()].filter((mesh) => mesh.visible), false).length > 0;
      },
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
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;
    mesh.updateMatrixWorld();
    const localPoint = bounds.getCenter(new THREE.Vector3());
    const scaleOnAxis = Math.max(0.0001, Math.abs(axisValue(mesh.scale, axis)));
    const distance = camera.position.distanceTo(mesh.position);
    const marginWorld = Math.max(0.16, distance * 0.018);
    const edge = boundingValue(bounds, axis, side === 1 ? 'max' : 'min');
    setAxisValue(localPoint, axis, edge + side * marginWorld / scaleOnAxis);
    handle.position.copy(mesh.localToWorld(localPoint));
    handle.quaternion.copy(mesh.quaternion);
    handle.scale.setScalar(Math.max(0.1, Math.min(0.28, distance * 0.018)));
  });

  return (
    <mesh ref={handleRef} renderOrder={1000} onPointerDown={(event) => onPointerDown(axis, side, event)}>
      <boxGeometry args={[0.72, 0.72, 0.72]} />
      <meshBasicMaterial color={color} transparent opacity={0.96} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
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
    const distance = camera.position.distanceTo(mesh.position);
    const marginWorld = Math.max(0.2, distance * 0.022);
    const localPoint = cornerPoint(bounds, sides);
    localPoint.x += sides[0] * marginWorld / Math.max(0.0001, Math.abs(mesh.scale.x));
    localPoint.y += sides[1] * marginWorld / Math.max(0.0001, Math.abs(mesh.scale.y));
    localPoint.z += sides[2] * marginWorld / Math.max(0.0001, Math.abs(mesh.scale.z));
    handle.position.copy(mesh.localToWorld(localPoint));
    handle.quaternion.copy(camera.quaternion);
    handle.scale.setScalar(Math.max(0.14, Math.min(0.36, distance * 0.024)));
  });

  return (
    <mesh ref={handleRef} renderOrder={1001} onPointerDown={(event) => onPointerDown(sides, event)}>
      <planeGeometry args={[1.05, 1.05]} />
      <meshBasicMaterial color="#ffff00" transparent opacity={0.48} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function ScaleHandles({ mesh, geometry, object, snap, onTransformDraggingChange }: {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  object: SceneObjectData;
  snap: SnapSettings;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
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

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
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
    endTransaction();
    onTransformDraggingChange(false);
    if (controls) controls.enabled = true;
  }

  const beginDrag = () => {
    if (controls) controls.enabled = false;
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
      kind: 'axis', axis, pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY), screenAxis, pixelsPerWorldUnit,
      anchorCoordinate: boundingValue(bounds, axis, side === 1 ? 'min' : 'max'), localSize,
      startPosition: mesh.position.clone(), startScale: mesh.scale.clone(), worldAxis: positiveWorldAxis
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
      startDiagonalWorld, anchorLocal, startPosition: mesh.position.clone(), startQuaternion, startScale: mesh.scale.clone()
    };
    beginDrag();
  };

  useEffect(() => () => {
    if (!dragRef.current) return;
    removeWindowListeners();
    dragRef.current = null;
    endTransaction();
    if (controls) controls.enabled = true;
    onTransformDraggingChange(false);
  }, [controls, endTransaction, onTransformDraggingChange]);

  return (
    <>
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

function SceneMesh({ object, registry, onTransformDraggingChange }: {
  object: SceneObjectData;
  registry: MeshRegistry;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
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

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    if (mesh) registry.current.set(object.id, mesh);
    return () => { registry.current.delete(object.id); };
  }, [mesh, object.id, registry]);

  const syncTransform = () => {
    if (!mesh) return;
    updateObject(object.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
    }, false);
  };

  const startTransform = () => { beginTransaction(); onTransformDraggingChange(true); };
  const stopTransform = () => { syncTransform(); endTransaction(); onTransformDraggingChange(false); };

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
          if (event.button === 2) event.stopPropagation();
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          select(object.id, event.shiftKey);
        }}
      >
        <meshStandardMaterial
          color={object.material.color}
          roughness={object.material.roughness}
          metalness={object.material.metalness}
          opacity={object.material.opacity}
          transparent={object.material.opacity < 1}
          flatShading={object.material.flatShading}
          emissive={selected ? '#24603d' : '#000000'}
          emissiveIntensity={selected ? 0.72 : 0}
        />
      </mesh>

      {singleSelection && !object.locked && object.visible && mesh && (
        tool === 'scale' ? (
          <ScaleHandles mesh={mesh} geometry={geometry} object={object} snap={snap} onTransformDraggingChange={onTransformDraggingChange} />
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

function EditorScene({ keyboardActive, selectionActive, registry, onSelectionApi }: {
  keyboardActive: boolean;
  selectionActive: boolean;
  registry: MeshRegistry;
  onSelectionApi: (api: SelectionApi) => void;
}) {
  const objects = useEditorStore((state) => state.objects);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);
  const [transformDragging, setTransformDragging] = useState(false);
  const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
  const groupMovable = selectedObjects.length > 1 && selectedObjects.every((object) => object.visible && !object.locked);

  return (
    <>
      <color attach="background" args={[scene.background]} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[6, 10, 5]} intensity={2.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <hemisphereLight args={['#dbe7ee', '#2a312c', 0.8]} />
      {scene.gridVisible && <StableGrid cellSize={scene.gridSize} />}
      {scene.axesVisible && <axesHelper args={[3]} />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow onClick={(event) => { if (event.button === 0) select(null); }}>
        <planeGeometry args={[GRID_EXTENT, GRID_EXTENT]} />
        <shadowMaterial opacity={0.14} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {objects.map((object) => <SceneMesh key={object.id} object={object} registry={registry} onTransformDraggingChange={setTransformDragging} />)}
      {groupMovable && <GroupTransformControls selectedIds={selectedIds} registry={registry} tool={tool} snap={snap} onTransformDraggingChange={setTransformDragging} />}
      <OrbitControls
        makeDefault
        enabled={!transformDragging && !selectionActive}
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
      />
      <KeyboardCameraControls active={keyboardActive && !transformDragging && !selectionActive} />
      <CameraController />
      <SelectionBridge registry={registry} onReady={onSelectionApi} />
    </>
  );
}

export function EditorViewport() {
  const select = useEditorStore((state) => state.select);
  const selectMany = useEditorStore((state) => state.selectMany);
  const viewportRef = useRef<HTMLDivElement>(null);
  const registry = useRef(new Map<string, THREE.Mesh>());
  const selectionApiRef = useRef<SelectionApi | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  const registerSelectionApi = useCallback((api: SelectionApi) => { selectionApiRef.current = api; }, []);

  const removeMarqueeListeners = useCallback(() => {
    window.removeEventListener('pointermove', handleMarqueeMove, true);
    window.removeEventListener('pointerup', finishMarquee, true);
    window.removeEventListener('pointercancel', finishMarquee, true);
    window.removeEventListener('blur', finishMarquee, true);
  }, []);

  function handleMarqueeMove(event: PointerEvent) {
    const current = marqueeRef.current;
    const viewport = viewportRef.current;
    if (!current || !viewport || event.pointerId !== current.pointerId) return;
    event.preventDefault();
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
    event?.preventDefault();
    removeMarqueeListeners();
    marqueeRef.current = null;
    setMarquee(null);

    const width = Math.abs(current.currentX - current.startX);
    const height = Math.abs(current.currentY - current.startY);
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
    if (event.button !== 2 || !event.ctrlKey || !viewportRef.current) return;
    if (selectionApiRef.current?.hitTest(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = viewportRef.current.getBoundingClientRect();
    const state: MarqueeState = {
      pointerId: event.pointerId,
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
      currentX: event.clientX - bounds.left,
      currentY: event.clientY - bounds.top
    };
    marqueeRef.current = state;
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
      onPointerDown={startMarquee}
      onContextMenu={(event) => event.preventDefault()}
      onFocus={() => setKeyboardActive(true)}
      onBlur={() => setKeyboardActive(false)}
    >
      <Canvas
        shadows
        camera={{ position: [6, 5, 7], fov: 45, near: 0.05, far: 500 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={(event) => { if (event.button === 0) select(null); }}
      >
        <EditorScene keyboardActive={keyboardActive} selectionActive={Boolean(marquee)} registry={registry} onSelectionApi={registerSelectionApi} />
      </Canvas>
      {marquee && <div className="selection-marquee" style={marqueeStyle} />}
      <div className="viewport-hint">
        Strg + Rechtsziehen auf leerer Fläche: Auswahlrahmen · Shift + Linksklick: Mehrfachauswahl · Strg + G: gruppieren
      </div>
    </div>
  );
}
