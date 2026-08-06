import fs from 'node:fs';

const path = 'src/editor/viewport/EditorViewport.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOrThrow(search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Composite-Viewport-Patch fehlt: ${label}`);
  source = source.replace(search, replacement);
}

replaceOrThrow(
`  createTranslationSurfaceSnapSession,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession`,
`  createTranslationSurfaceSnapSession,
  resolveCompositeTranslationSurfaceSnap,
  resolveTranslationSurfaceSnap,
  type TranslationSurfaceSnapSession`,
  'Composite-Resolver-Import'
);
replaceOrThrow(
`import { PrimitiveSnapPattern } from './PrimitiveSnapPattern';`,
`import { PrimitiveSnapPattern } from './PrimitiveSnapPattern';
import { CompositeSnapPattern } from './CompositeSnapPattern';
import {
  surfaceSnapTargetFromSceneObject,
  surfaceSnapTargetFromSceneObjects
} from '../snapping/objectSurfaceSnap';`,
  'Composite-Imports'
);
replaceOrThrow(
`interface GroupDragState {
  proxyMatrix: THREE.Matrix4;
  objectMatrices: Map<string, THREE.Matrix4>;
}`,
`interface GroupDragState {
  proxyMatrix: THREE.Matrix4;
  objectMatrices: Map<string, THREE.Matrix4>;
  surfaceSnapSession: TranslationSurfaceSnapSession;
}`,
  'GroupDragState'
);
replaceOrThrow(
`  const objects = useEditorStore((state) => state.objects);
  const updateObject = useEditorStore((state) => state.updateObject);`,
`  const updateObject = useEditorStore((state) => state.updateObject);`,
  'ungenutztes Single-Objects-Abonnement'
);
replaceOrThrow(
`  const stop = () => {
    sync();
    dragRef.current = null;
    onSnapTargetChange(null);`,
`  const stop = () => {
    dragRef.current = null;
    onSnapTargetChange(null);`,
  'Single-Stop ohne Zusatzschritt'
);
replaceOrThrow(
`function GroupTransformControls({ selectedIds, registry, tool, snap, onTransformDraggingChange }: {
  selectedIds: string[];
  registry: MeshRegistry;
  tool: TransformMode;
  snap: SnapSettings;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {`,
`function GroupTransformControls({ selectedIds, registry, tool, snap, onSnapTargetChange, onTransformDraggingChange }: {
  selectedIds: string[];
  registry: MeshRegistry;
  tool: TransformMode;
  snap: SnapSettings;
  onSnapTargetChange: (targetId: string | null) => void;
  onTransformDraggingChange: (dragging: boolean) => void;
}) {`,
  'Group-Props'
);
replaceOrThrow(
`    dragRef.current = { proxyMatrix: proxy.matrixWorld.clone(), objectMatrices };
    beginTransaction();`,
`    dragRef.current = {
      proxyMatrix: proxy.matrixWorld.clone(),
      objectMatrices,
      surfaceSnapSession: createTranslationSurfaceSnapSession()
    };
    onSnapTargetChange(null);
    beginTransaction();`,
  'Group-Start'
);

const oldGroupSync = `  const sync = () => {
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
  };`;
const newGroupSync = `  const sync = () => {
    const drag = dragRef.current;
    if (!drag) return;
    proxy.updateMatrixWorld(true);
    const rawProxyPosition = proxy.position.clone();
    const effectiveProxyPosition = rawProxyPosition.clone();
    if (tool === 'translate' && snap.enabled && snap.position > 0) {
      effectiveProxyPosition.set(
        Math.round(effectiveProxyPosition.x / snap.position) * snap.position,
        Math.round(effectiveProxyPosition.y / snap.position) * snap.position,
        Math.round(effectiveProxyPosition.z / snap.position) * snap.position
      );
    }

    const effectiveProxyMatrix = proxy.matrixWorld.clone();
    if (tool === 'translate') {
      effectiveProxyMatrix.setPosition(effectiveProxyPosition);
    }
    const delta = effectiveProxyMatrix.multiply(drag.proxyMatrix.clone().invert());
    const liveObjects = useEditorStore.getState().objects;
    const transformedObjects = new Map<string, SceneObjectData>();

    for (const [id, startMatrix] of drag.objectMatrices) {
      const mesh = registry.current.get(id);
      const storedObject = liveObjects.find((object) => object.id === id);
      if (!mesh || !storedObject) continue;
      const worldMatrix = delta.clone().multiply(startMatrix);
      const localMatrix = mesh.parent
        ? mesh.parent.matrixWorld.clone().invert().multiply(worldMatrix)
        : worldMatrix;
      localMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrixWorld(true);
      transformedObjects.set(id, {
        ...storedObject,
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
      });
    }

    if (tool === 'translate' && snap.surface && transformedObjects.size > 1) {
      const selectedObjects = selectedIds.flatMap((id) => {
        const object = transformedObjects.get(id);
        return object ? [object] : [];
      });
      const sourceTarget = surfaceSnapTargetFromSceneObjects(
        selectedObjects,
        'selected-composite'
      );
      const targetObjects = liveObjects.filter((object) => (
        object.visible && !selectedIds.includes(object.id)
      ));
      const targets = targetObjects.flatMap((object) => {
        const target = surfaceSnapTargetFromSceneObject(object);
        return target ? [target] : [];
      });

      if (sourceTarget) {
        const resolution = resolveCompositeTranslationSurfaceSnap(
          sourceTarget,
          targets,
          [rawProxyPosition.x, rawProxyPosition.y, rawProxyPosition.z],
          drag.surfaceSnapSession,
          Math.min(0.12, Math.max(0.04, Math.abs(snap.position) * 0.4))
        );
        drag.surfaceSnapSession = resolution.session;
        const sourceCenter = new THREE.Vector3().setFromMatrixPosition(sourceTarget.matrixWorld);
        const correction = new THREE.Vector3(...resolution.result.position).sub(sourceCenter);
        if (correction.lengthSq() > 0.0000000001) {
          for (const [id, transformedObject] of transformedObjects) {
            const mesh = registry.current.get(id);
            if (!mesh) continue;
            mesh.position.add(correction);
            mesh.updateMatrixWorld(true);
            transformedObjects.set(id, {
              ...transformedObject,
              position: [mesh.position.x, mesh.position.y, mesh.position.z]
            });
          }
        }
        proxy.position.copy(effectiveProxyPosition).add(correction);
        proxy.updateMatrixWorld(true);
        onSnapTargetChange(resolution.result.targetId);
      } else {
        drag.surfaceSnapSession = createTranslationSurfaceSnapSession();
        proxy.position.copy(effectiveProxyPosition);
        proxy.updateMatrixWorld(true);
        onSnapTargetChange(null);
      }
    } else {
      drag.surfaceSnapSession = createTranslationSurfaceSnapSession();
      if (tool === 'translate') {
        proxy.position.copy(effectiveProxyPosition);
        proxy.updateMatrixWorld(true);
      }
      onSnapTargetChange(null);
    }

    for (const [id, transformedObject] of transformedObjects) {
      updateObject(id, {
        position: transformedObject.position,
        rotation: transformedObject.rotation,
        scale: transformedObject.scale
      }, false);
    }
  };`;
replaceOrThrow(oldGroupSync, newGroupSync, 'Group-Sync');
replaceOrThrow(
`  const stop = () => {
    sync();
    dragRef.current = null;
    endTransaction();`,
`  const stop = () => {
    dragRef.current = null;
    onSnapTargetChange(null);
    endTransaction();`,
  'Group-Stop ohne Zusatzschritt'
);
replaceOrThrow(
`        translationSnap={snap.enabled ? snap.position : undefined}
        rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}`, 
`        translationSnap={tool === 'translate' ? undefined : (snap.enabled ? snap.position : undefined)}
        rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotation) : undefined}`,
  'Group-Rohbewegung'
);
replaceOrThrow(
`  const showSnapPattern = !paintSettings.enabled && snap.surface && snapToolActive && isFormType(object.type) && !singleSelection && object.visible;`,
`  const showSnapPattern = !paintSettings.enabled
    && snap.surface
    && snapToolActive
    && isFormType(object.type)
    && !selected
    && object.visible;`,
  'Komponenten-/Composite-Anzeige trennen'
);
replaceOrThrow(
`      {groupMovable && <GroupTransformControls selectedIds={selectedIds} registry={registry} tool={tool} snap={snap} onTransformDraggingChange={setTransformDragging} />}`, 
`      {groupMovable && snap.surface && (tool === 'translate' || tool === 'scale') && (
        <CompositeSnapPattern
          objects={selectedObjects}
          highlighted={snapTargetId === 'selected-composite'}
        />
      )}
      {groupMovable && (
        <GroupTransformControls
          selectedIds={selectedIds}
          registry={registry}
          tool={tool}
          snap={snap}
          onSnapTargetChange={setSnapTargetId}
          onTransformDraggingChange={setTransformDragging}
        />
      )}`,
  'Composite-Anzeige und Group-Props'
);

fs.writeFileSync(path, source);
