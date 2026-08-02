import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { createGeometry } from '../../geometry/factory';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData } from '../../types/editor';

interface OrbitControlApi {
  target: THREE.Vector3;
  update: () => void;
}

const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

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

function SceneMesh({ object }: { object: SceneObjectData }) {
  const selectedId = useEditorStore((state) => state.selectedId);
  const select = useEditorStore((state) => state.select);
  const tool = useEditorStore((state) => state.tool);
  const snap = useEditorStore((state) => state.snap);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(
    () => createGeometry({ type: object.type, geometry: object.geometry }),
    [object.geometry, object.type]
  );
  const selected = selectedId === object.id;

  useEffect(() => () => geometry.dispose(), [geometry]);

  const syncTransform = () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    updateTransform(object.id, 'position', [mesh.position.x, mesh.position.y, mesh.position.z], false);
    updateTransform(object.id, 'rotation', [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], false);
    updateTransform(object.id, 'scale', [mesh.scale.x, mesh.scale.y, mesh.scale.z], false);
  };

  const mesh = (
    <mesh
      ref={meshRef}
      name={object.name}
      geometry={geometry}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      visible={object.visible}
      castShadow
      receiveShadow
      onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); select(object.id); }}
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
  );

  if (!selected || object.locked || !object.visible) return mesh;
  return (
    <TransformControls
      mode={tool}
      translationSnap={snap.enabled ? snap.position : undefined}
      rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}
      scaleSnap={snap.enabled ? snap.scale : undefined}
      onMouseDown={beginTransaction}
      onMouseUp={endTransaction}
      onObjectChange={syncTransform}
    >
      {mesh}
    </TransformControls>
  );
}

function EditorScene({ keyboardActive }: { keyboardActive: boolean }) {
  const objects = useEditorStore((state) => state.objects);
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);
  return (
    <>
      <color attach="background" args={[scene.background]} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[6, 10, 5]} intensity={2.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <hemisphereLight args={['#dbe7ee', '#2a312c', 0.8]} />
      {scene.gridVisible && <Grid args={[40, 40]} cellSize={scene.gridSize} cellThickness={0.6} cellColor="#53626a" sectionSize={5} sectionThickness={1} sectionColor="#4f8f68" fadeDistance={35} infiniteGrid />}
      {scene.axesVisible && <axesHelper args={[3]} />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow onClick={() => select(null)}>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial opacity={0.14} transparent />
      </mesh>
      {objects.map((object) => <SceneMesh key={object.id} object={object} />)}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.ROTATE
        }}
      />
      <KeyboardCameraControls active={keyboardActive} />
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
      onPointerDownCapture={() => viewportRef.current?.focus()}
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
      <div className="viewport-hint">Links: verschieben · Rechts: drehen · WASD: bewegen · Q/E: drehen · Mausrad: zoomen</div>
    </div>
  );
}
