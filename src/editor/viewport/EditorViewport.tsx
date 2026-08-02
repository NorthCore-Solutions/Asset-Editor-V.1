import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData, SnapSettings } from '../../types/editor';

interface OrbitControlApi {
  target: THREE.Vector3;
  enabled: boolean;
  update: () => void;
}

type ScaleAxis = 'X' | 'Y' | 'Z';
type ScaleSide = -1 | 1;
type CornerSides = [ScaleSide, ScaleSide, ScaleSide];

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

const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const GRID_EXTENT = 400;
const CORNERS: CornerSides[] = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1]
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
    const { objects, selectedId } = useEditorStore.getState();
    const selected = objects.find((object) => object.id === selectedId);
    const target = selected ? new THREE.Vector3(...selected.position) : new THREE.Vector3(0, 0.8, 0);
    const distance = selected ? Math.max(3.5, Math.max(...selected.scale) * 4) : 8;
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

function ScaleHandle({
  mesh,
  bounds,
  axis,
  side,
  color,
  onPointerDown
}: {
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
    handle.scale.setScalar(Math.max(0.12, Math.min(0.34, distance * 0.022)));
  });

  return (
    <mesh
      ref={handleRef}
      renderOrder={1000}
      onPointerDown={(event) => onPointerDown(axis, side, event)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function CornerScaleHandle({
  mesh,
  bounds,
  sides,
  onPointerDown
}: {
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
    handle.quaternion.copy(mesh.quaternion);
    handle.scale.setScalar(Math.max(0.1, Math.min(0.28, distance * 0.019)));
  });

  return (
    <mesh
      ref={handleRef}
      renderOrder={1001}
      onPointerDown={(event) => onPointerDown(sides, event)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#f1f4f5" depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function ScaleHandles({
  mesh,
  geometry,
  object,
  snap,
  onTransformDraggingChange
}: {
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
    return geometry.boundingBox?.clone() ?? new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5)
    );
  }, [geometry]);

  const removeWindowListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', finishDrag, true);
    window.removeEventListener('pointercancel', finishDrag, true);
    window.removeEventListener('blur', finishDrag, true);
  };

  const commitTransform = () => {
    const position: SceneObjectData['position'] = [mesh.position.x, mesh.position.y, mesh.position.z];
    const rotation: SceneObjectData['rotation'] = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
    const scale: SceneObjectData['scale'] = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
    updateObject(object.id, { position, rotation, scale }, false);
  };

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    const pointerDelta = new THREE.Vector2(
      event.clientX - drag.startPointer.x,
      event.clientY - drag.startPointer.y
    );
    const worldDelta = pointerDelta.dot(drag.screenAxis) / drag.pixelsPerWorldUnit;

    if (drag.kind === 'axis') {
      const startScale = axisValue(drag.startScale, drag.axis);
      const startWorldSize = drag.localSize * startScale;
      const minimumScale = 0.02;
      let nextScale = Math.max(minimumScale, (startWorldSize + worldDelta) / drag.localSize);

      if (snap.enabled && snap.scale > 0) {
        nextScale = Math.max(minimumScale, Math.round(nextScale / snap.scale) * snap.scale);
      }

      const nextScaleVector = drag.startScale.clone();
      setAxisValue(nextScaleVector, drag.axis, nextScale);
      mesh.scale.copy(nextScaleVector);

      const anchorOffset = drag.anchorCoordinate * (startScale - nextScale);
      mesh.position.copy(drag.startPosition).addScaledVector(drag.worldAxis, anchorOffset);
      mesh.updateMatrixWorld();
      return;
    }

    let factor = Math.max(0.02, (drag.startDiagonalWorld + worldDelta) / drag.startDiagonalWorld);
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
  }

  function finishDrag(event?: Event) {
    const drag = dragRef.current;
    if (!drag) return;
    if (event instanceof PointerEvent && event.pointerId !== drag.pointerId) return;

    event?.preventDefault();
    event?.stopPropagation();
    dragRef.current = null;
    removeWindowListeners();
    commitTransform();
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
    const screenAxis = new THREE.Vector2(
      (axisProjected.x - centerProjected.x) * size.width * 0.5,
      -(axisProjected.y - centerProjected.y) * size.height * 0.5
    );
    const pixelsPerWorldUnit = screenAxis.length();

    if (pixelsPerWorldUnit < 2) return;

    screenAxis.normalize();
    dragRef.current = {
      kind: 'axis',
      axis,
      pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY),
      screenAxis,
      pixelsPerWorldUnit,
      anchorCoordinate: boundingValue(bounds, axis, side === 1 ? 'min' : 'max'),
      localSize,
      startPosition: mesh.position.clone(),
      startScale: mesh.scale.clone(),
      worldAxis: positiveWorldAxis
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
    const localDiagonal = draggedLocal.clone().sub(anchorLocal);
    const scaledDiagonal = localDiagonal.clone().multiply(mesh.scale);
    const startDiagonalWorld = scaledDiagonal.length();
    if (startDiagonalWorld <= 0.000001) return;

    const worldDirection = scaledDiagonal.applyQuaternion(startQuaternion).normalize();
    const centerProjected = mesh.position.clone().project(camera);
    const axisProjected = mesh.position.clone().add(worldDirection).project(camera);
    const screenAxis = new THREE.Vector2(
      (axisProjected.x - centerProjected.x) * size.width * 0.5,
      -(axisProjected.y - centerProjected.y) * size.height * 0.5
    );
    const pixelsPerWorldUnit = screenAxis.length();

    if (pixelsPerWorldUnit < 2) return;

    screenAxis.normalize();
    dragRef.current = {
      kind: 'uniform',
      pointerId: event.pointerId,
      startPointer: new THREE.Vector2(event.clientX, event.clientY),
      screenAxis,
      pixelsPerWorldUnit,
      startDiagonalWorld,
      anchorLocal,
      startPosition: mesh.position.clone(),
      startQuaternion,
      startScale: mesh.scale.clone()
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
      <ScaleHandle mesh={mesh} bounds={bounds} axis="X" side={-1} color="#ff3b30" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="X" side={1} color="#ff3b30" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Y" side={-1} color="#22d63a" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Y" side={1} color="#22d63a" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Z" side={-1} color="#275dff" onPointerDown={startAxisDrag} />
      <ScaleHandle mesh={mesh} bounds={bounds} axis="Z" side={1} color="#275dff" onPointerDown={startAxisDrag} />
      {CORNERS.map((sides) => (
        <CornerScaleHandle
          key={sides.join(':')}
          mesh={mesh}
          bounds={bounds}
          sides={sides}
          onPointerDown={startUniformDrag}
        />
      ))}
    </>
  );
}

function SceneMesh({
  object,
  onTransformDraggingChange
}: {
  object: SceneObjectData;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const selectedId = useEditorStore((state) => state.selectedId);
  const select = useEditorStore((state) => state.select);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const geometry = useMemo(
    () => createGeometry({ type: object.type, geometry: object.geometry }),
    [object.geometry, object.type]
  );
  const selected = selectedId === object.id;

  useEffect(() => () => geometry.dispose(), [geometry]);

  const startTransform = () => {
    beginTransaction();
    onTransformDraggingChange(true);
  };

  const stopTransform = () => {
    if (!mesh) {
      onTransformDraggingChange(false);
      endTransaction();
      return;
    }

    const position: SceneObjectData['position'] = [mesh.position.x, mesh.position.y, mesh.position.z];
    const rotation: SceneObjectData['rotation'] = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
    const scale: SceneObjectData['scale'] = [mesh.scale.x, mesh.scale.y, mesh.scale.z];

    updateObject(object.id, { position, rotation, scale }, false);
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
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          select(object.id);
        }}
      >
        <meshStandardMaterial
          color={object.material.color}
          roughness={object.material.roughness}
          metalness={object.material.metalness}
          opacity={object.material.opacity}
          transparent={object.material.opacity < 1}
          flatShading={object.material.flatShading}
          emissive={selected ? '#163b25' : '#000000'}
          emissiveIntensity={selected ? 0.55 : 0}
        />
      </mesh>

      {selected && !object.locked && object.visible && mesh && (
        tool === 'scale' ? (
          <ScaleHandles
            mesh={mesh}
            geometry={geometry}
            object={object}
            snap={snap}
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
            onMouseUp={stopTransform}
          />
        )
      )}
    </>
  );
}

function StableGrid({ cellSize }: { cellSize: number }) {
  const gridProps = {
    args: [GRID_EXTENT, GRID_EXTENT] as [number, number],
    cellSize,
    cellThickness: 0.6,
    cellColor: '#53626a',
    sectionSize: cellSize * 5,
    sectionThickness: 1,
    sectionColor: '#4f8f68',
    fadeDistance: 1000,
    fadeStrength: 0,
    followCamera: false,
    infiniteGrid: false,
    frustumCulled: false,
    renderOrder: 1
  };

  return (
    <group>
      <Grid {...gridProps} position={[0, 0.003, 0]} />
      <Grid {...gridProps} position={[0, -0.003, 0]} rotation={[Math.PI, 0, 0]} />
    </group>
  );
}

function EditorScene({ keyboardActive }: { keyboardActive: boolean }) {
  const objects = useEditorStore((state) => state.objects);
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);
  const [transformDragging, setTransformDragging] = useState(false);

  return (
    <>
      <color attach="background" args={[scene.background]} />
      <ambientLight intensity={1.4} />
      <directionalLight
        position={[6, 10, 5]}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={['#dbe7ee', '#2a312c', 0.8]} />
      {scene.gridVisible && <StableGrid cellSize={scene.gridSize} />}
      {scene.axesVisible && <axesHelper args={[3]} />}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        onClick={() => select(null)}
      >
        <planeGeometry args={[GRID_EXTENT, GRID_EXTENT]} />
        <shadowMaterial opacity={0.14} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {objects.map((object) => (
        <SceneMesh
          key={object.id}
          object={object}
          onTransformDraggingChange={setTransformDragging}
        />
      ))}
      <OrbitControls
        makeDefault
        enabled={!transformDragging}
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.ROTATE
        }}
      />
      <KeyboardCameraControls active={keyboardActive && !transformDragging} />
      <CameraController />
    </>
  );
}

export function EditorViewport() {
  const select = useEditorStore((state) => state.select);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [keyboardActive, setKeyboardActive] = useState(false);

  return (
    <div
      ref={viewportRef}
      className="viewport"
      tabIndex={0}
      onPointerDown={() => viewportRef.current?.focus()}
      onFocus={() => setKeyboardActive(true)}
      onBlur={() => setKeyboardActive(false)}
    >
      <Canvas
        shadows
        camera={{ position: [6, 5, 7], fov: 45, near: 0.05, far: 500 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => select(null)}
      >
        <EditorScene keyboardActive={keyboardActive} />
      </Canvas>
      <div className="viewport-hint">
        Links: verschieben · Rechts: drehen · Gizmo mit Links ziehen · WASD: bewegen · Q/E: drehen · Mausrad: zoomen
      </div>
    </div>
  );
}
