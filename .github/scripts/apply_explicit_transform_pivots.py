from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: erwartet 1 Treffer, gefunden {count}.")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: erwartet 1 Treffer, gefunden {count}.")
    return updated


paint_path = Path("src/editor/paint/useSurfacePaint.ts")
paint = paint_path.read_text(encoding="utf-8")

paint = replace_once(
    paint,
    "import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';",
    "import { useEffect } from 'react';",
    "React-Import"
)
paint = replace_once(
    paint,
    "import { useFrame, useThree } from '@react-three/fiber';",
    "import { useThree } from '@react-three/fiber';",
    "Fiber-Import"
)
paint = replace_once(
    paint,
    "import { useEditorStore } from '../../store/editorStore';\n",
    "",
    "Store-Import"
)
paint = regex_once(
    paint,
    r"\ninterface PositionCopyPatch \{.*?\nconst sceneEnvironments",
    "\nconst sceneEnvironments",
    "Patch-Interfaces"
)
paint = regex_once(
    paint,
    r"\nfunction setBasicMaterialAppearance\(.*?\n\}\n\nfunction setSceneEnvironment",
    "\nfunction setSceneEnvironment",
    "Material-Patchfunktion"
)
paint = regex_once(
    paint,
    r"\nfunction octahedronRadius\(.*?\nfunction useNeutralMaterialEnvironment",
    "\nfunction useNeutralMaterialEnvironment",
    "Interne Gizmo-Patches"
)
paint = replace_once(
    paint,
    "  useOriginalCenterScaleHandle(object, geometry, selected, settings.enabled);\n",
    "",
    "Skaliermittelpunkt-Hook"
)
paint = replace_once(
    paint,
    "  useOriginalTranslateGizmoCenter(object, geometry, selected, settings.enabled);\n",
    "",
    "Verschiebe-Pivot-Hook"
)

for forbidden in (
    "findOriginalCenterScaleHandle",
    "findOriginalTranslateGizmo",
    "patchPositionCopy",
    "candidate.name !== 'XYZ'",
    "Math.abs(radius - 0.1)",
    "Math.abs(radius - 0.2)"
):
    if forbidden in paint:
        raise SystemExit(f"Interner Gizmo-Patch ist noch vorhanden: {forbidden}")

paint_path.write_text(paint, encoding="utf-8")


viewport_path = Path("src/editor/viewport/EditorViewport.tsx")
viewport = viewport_path.read_text(encoding="utf-8")

viewport = replace_once(
    viewport,
    "import { useSurfacePaint, useSurfacePaintSettings } from '../paint/useSurfacePaint';",
    "import { invertHexColor, useSurfacePaint, useSurfacePaintSettings } from '../paint/useSurfacePaint';",
    "Surface-Paint-Import"
)
viewport = replace_once(
    viewport,
    "interface GroupDragState {\n  proxyMatrix: THREE.Matrix4;\n  objectMatrices: Map<string, THREE.Matrix4>;\n}\n",
    "interface SingleTranslateDragState {\n  startProxyPosition: THREE.Vector3;\n  startMeshWorldPosition: THREE.Vector3;\n}\n\ninterface GroupDragState {\n  proxyMatrix: THREE.Matrix4;\n  objectMatrices: Map<string, THREE.Matrix4>;\n}\n",
    "Single-Translate-State"
)

center_replacement = """function CenterScaleHandle({ mesh, bounds, color, onPointerDown }: {
  mesh: THREE.Mesh;
  bounds: THREE.Box3;
  color: string;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const handleRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const handle = handleRef.current;
    if (!handle) return;

    mesh.updateMatrixWorld(true);
    const localCenter = bounds.getCenter(new THREE.Vector3());
    handle.position.copy(mesh.localToWorld(localCenter));
    handle.quaternion.identity();
    handle.scale.setScalar(scaleHandleWorldSize(mesh, bounds) / 0.2);
  });

  return (
    <group ref={handleRef} renderOrder={Infinity}>
      <mesh renderOrder={Infinity}>
        <octahedronGeometry args={[CENTER_SCALE_VISUAL_RADIUS, 0]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <mesh renderOrder={Infinity} onPointerDown={onPointerDown}>
        <octahedronGeometry args={[CENTER_SCALE_HITBOX_RADIUS, 0]} />
        <meshBasicMaterial
          color={color}
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

function CornerScaleHandle"""
viewport = regex_once(
    viewport,
    r"function CenterScaleHandle\(\{ mesh, bounds, onPointerDown \}: \{.*?\n\}\n\nfunction CornerScaleHandle",
    center_replacement,
    "CenterScaleHandle"
)
viewport = replace_once(
    viewport,
    "      <CenterScaleHandle mesh={mesh} bounds={bounds} onPointerDown={startCenterDrag} />",
    "      <CenterScaleHandle\n        mesh={mesh}\n        bounds={bounds}\n        color={invertHexColor(object.material.color)}\n        onPointerDown={startCenterDrag}\n      />",
    "CenterScaleHandle-Aufruf"
)

single_translate_component = """function SingleTranslateControls({
  mesh,
  geometry,
  object,
  snap,
  onSnapTargetChange,
  onTransformDraggingChange
}: {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  object: SceneObjectData;
  snap: SnapSettings;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {
  const proxy = useMemo(() => new THREE.Object3D(), []);
  const dragRef = useRef<SingleTranslateDragState | null>(null);
  const objects = useEditorStore((state) => state.objects);
  const updateObject = useEditorStore((state) => state.updateObject);
  const beginTransaction = useEditorStore((state) => state.beginTransaction);
  const endTransaction = useEditorStore((state) => state.endTransaction);
  const localCenter = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  }, [geometry]);

  const resetProxy = useCallback(() => {
    mesh.updateMatrixWorld(true);
    proxy.position.copy(mesh.localToWorld(localCenter.clone()));
    proxy.rotation.set(0, 0, 0);
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld(true);
  }, [localCenter, mesh, proxy]);

  useFrame(() => {
    if (!dragRef.current) resetProxy();
  });

  const start = () => {
    resetProxy();
    dragRef.current = {
      startProxyPosition: proxy.position.clone(),
      startMeshWorldPosition: mesh.getWorldPosition(new THREE.Vector3())
    };
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
  };

  const sync = () => {
    const drag = dragRef.current;
    if (!drag) return;

    const worldDelta = proxy.position.clone().sub(drag.startProxyPosition);
    const nextWorldPosition = drag.startMeshWorldPosition.clone().add(worldDelta);
    const nextLocalPosition = mesh.parent
      ? mesh.parent.worldToLocal(nextWorldPosition.clone())
      : nextWorldPosition;
    mesh.position.copy(nextLocalPosition);
    mesh.updateMatrixWorld(true);

    let position: SceneObjectData['position'] = [
      mesh.position.x,
      mesh.position.y,
      mesh.position.z
    ];
    const rotation: SceneObjectData['rotation'] = [
      mesh.rotation.x,
      mesh.rotation.y,
      mesh.rotation.z
    ];
    const scale: SceneObjectData['scale'] = [
      mesh.scale.x,
      mesh.scale.y,
      mesh.scale.z
    ];

    if (snap.surface && isFormType(object.type)) {
      const result = findFormSurfaceSnap(
        { ...object, position, rotation, scale },
        objects,
        snap.position
      );
      position = result.position;
      mesh.position.set(position[0], position[1], position[2]);
      mesh.updateMatrixWorld(true);
      onSnapTargetChange(result.targetId);
    } else {
      onSnapTargetChange(null);
    }

    updateObject(object.id, { position, rotation, scale }, false);
  };

  const stop = () => {
    sync();
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
    resetProxy();
  };

  useEffect(() => () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();
    onTransformDraggingChange(false);
  }, [endTransaction, onSnapTargetChange, onTransformDraggingChange]);

  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode="translate"
        space="world"
        size={1.15}
        translationSnap={snap.enabled ? snap.position : undefined}
        onMouseDown={start}
        onObjectChange={sync}
        onMouseUp={stop}
      />
    </>
  );
}

"""
viewport = replace_once(
    viewport,
    "function GroupTransformControls(",
    single_translate_component + "function GroupTransformControls(",
    "SingleTranslateControls-Einfügepunkt"
)

scene_start = viewport.index("function SceneMesh(")
scene_end = viewport.index("\nfunction StableGrid", scene_start)
scene = viewport[scene_start:scene_end]

scene = replace_once(
    scene,
    "  const objects = useEditorStore((state) => state.objects);\n",
    "",
    "SceneMesh-Objektliste"
)
scene = regex_once(
    scene,
    r"\n  const syncTransform = \(\) => \{.*?\n  const stopTransform = \(\) => \{.*?\n  \};\n",
    """
  const syncRotation = () => {
    if (!mesh) return;
    updateObject(object.id, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
    }, false);
  };

  const startRotation = () => {
    onSnapTargetChange(null);
    beginTransaction();
    onTransformDraggingChange(true);
  };

  const stopRotation = () => {
    syncRotation();
    endTransaction();
    onTransformDraggingChange(false);
  };
""",
    "SceneMesh-Transformationsfunktionen"
)

controls_start_marker = "\n      {!paintSettings.enabled && singleSelection && !object.locked && object.visible && mesh && (\n"
controls_start = scene.index(controls_start_marker)
controls_end_marker = "\n      )}\n"
controls_end = scene.index(controls_end_marker, controls_start) + len(controls_end_marker)
controls_replacement = """
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
        ) : tool === 'translate' ? (
          <SingleTranslateControls
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
            mode="rotate"
            space="world"
            size={1.4}
            rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}
            onMouseDown={startRotation}
            onObjectChange={syncRotation}
            onMouseUp={stopRotation}
          />
        )
      )}
"""
scene = scene[:controls_start] + controls_replacement + scene[controls_end:]
viewport = viewport[:scene_start] + scene + viewport[scene_end:]

for required in (
    "function SingleTranslateControls(",
    "color={invertHexColor(object.material.color)}",
    "mode=\"translate\"",
    "mode=\"rotate\""
):
    if required not in viewport:
        raise SystemExit(f"Erwarteter Pivot-Code fehlt: {required}")

viewport_path.write_text(viewport, encoding="utf-8")
