import fs from 'node:fs';

const path = 'src/editor/viewport/EditorViewport.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOrThrow(search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Viewport-Patch fehlt: ${label}`);
  source = source.replace(search, replacement);
}

replaceOrThrow(
  "import { findFormSurfaceSnap, isFormType } from '../snapping/primitiveSurfaceSnap';",
  "import { findFormSurfaceSnap, isFormType } from '../snapping/primitiveSurfaceSnap';\nimport {\n  createTranslationSurfaceSnapSession,\n  resolveTranslationSurfaceSnap,\n  type TranslationSurfaceSnapSession\n} from '../snapping/translationSurfaceSnap';",
  'Import'
);

replaceOrThrow(
`interface SingleTranslateDragState {
  startProxyPosition: THREE.Vector3;
  startMeshWorldPosition: THREE.Vector3;
}`,
`interface SingleTranslateDragState {
  lastRawProxyPosition: THREE.Vector3;
  rawMeshWorldPosition: THREE.Vector3;
  surfaceSnapSession: TranslationSurfaceSnapSession;
}`,
  'SingleTranslateDragState'
);

replaceOrThrow(
`    dragRef.current = {
      startProxyPosition: proxy.position.clone(),
      startMeshWorldPosition: mesh.getWorldPosition(new THREE.Vector3())
    };`,
`    dragRef.current = {
      lastRawProxyPosition: proxy.position.clone(),
      rawMeshWorldPosition: mesh.getWorldPosition(new THREE.Vector3()),
      surfaceSnapSession: createTranslationSurfaceSnapSession()
    };`,
  'Drag-Start'
);

replaceOrThrow(
`    const worldDelta = proxy.position.clone().sub(drag.startProxyPosition);
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
    ];`,
`    const rawProxyPosition = proxy.position.clone();
    const rawDelta = rawProxyPosition.clone().sub(drag.lastRawProxyPosition);
    drag.lastRawProxyPosition.copy(rawProxyPosition);
    drag.rawMeshWorldPosition.add(rawDelta);

    const rawLocalPosition = mesh.parent
      ? mesh.parent.worldToLocal(drag.rawMeshWorldPosition.clone())
      : drag.rawMeshWorldPosition.clone();
    const nextWorldPosition = drag.rawMeshWorldPosition.clone();
    if (snap.enabled && snap.position > 0) {
      nextWorldPosition.set(
        Math.round(nextWorldPosition.x / snap.position) * snap.position,
        Math.round(nextWorldPosition.y / snap.position) * snap.position,
        Math.round(nextWorldPosition.z / snap.position) * snap.position
      );
    }
    const nextLocalPosition = mesh.parent
      ? mesh.parent.worldToLocal(nextWorldPosition.clone())
      : nextWorldPosition;
    mesh.position.copy(nextLocalPosition);
    mesh.updateMatrixWorld(true);

    let position: SceneObjectData['position'] = [
      mesh.position.x,
      mesh.position.y,
      mesh.position.z
    ];`,
  'kontinuierliche Rohbewegung'
);

replaceOrThrow(
`    if (snap.surface && isFormType(object.type)) {
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

    updateObject(object.id, { position, rotation, scale }, false);`,
`    if (snap.surface && isFormType(object.type)) {
      const liveObjects = useEditorStore.getState().objects;
      const resolution = resolveTranslationSurfaceSnap(
        { ...object, position, rotation, scale },
        liveObjects,
        snap.position,
        [rawLocalPosition.x, rawLocalPosition.y, rawLocalPosition.z],
        drag.surfaceSnapSession
      );
      drag.surfaceSnapSession = resolution.session;
      position = resolution.result.position;
      mesh.position.set(position[0], position[1], position[2]);
      mesh.updateMatrixWorld(true);
      onSnapTargetChange(resolution.result.targetId);
    } else {
      drag.surfaceSnapSession = createTranslationSurfaceSnapSession();
      onSnapTargetChange(null);
    }

    updateObject(object.id, { position, rotation, scale }, false);

    // Gizmo und Objekt verwenden nach jedem Pointer-Schritt denselben Pivot.
    mesh.updateMatrixWorld(true);
    proxy.position.copy(mesh.localToWorld(localCenter.clone()));
    proxy.updateMatrixWorld(true);`,
  'gemeinsamer Surface-Snap'
);

replaceOrThrow(
`        translationSnap={snap.enabled ? snap.position : undefined}
        onMouseDown={start}
        onObjectChange={sync}
        onMouseUp={stop}`,
`        translationSnap={undefined}
        onMouseDown={start}
        onObjectChange={sync}
        onMouseUp={stop}`,
  'TransformControls-Rasterung'
);

fs.writeFileSync(path, source);
