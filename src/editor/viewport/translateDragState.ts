import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';

export interface TranslateDragFrame {
  lastProxyPosition: THREE.Vector3;
  lastAcceptedMeshWorldPosition: THREE.Vector3;
  lastAcceptedObject: SceneObjectData;
}

export function nextTranslatedWorldPosition(
  frame: TranslateDragFrame,
  proxyPosition: THREE.Vector3
): THREE.Vector3 {
  return frame.lastAcceptedMeshWorldPosition.clone().add(
    proxyPosition.clone().sub(frame.lastProxyPosition)
  );
}

export function rebaseTranslateDragFrame(
  frame: TranslateDragFrame,
  proxyPosition: THREE.Vector3,
  acceptedMeshWorldPosition: THREE.Vector3,
  acceptedObject: SceneObjectData
): void {
  frame.lastProxyPosition.copy(proxyPosition);
  frame.lastAcceptedMeshWorldPosition.copy(acceptedMeshWorldPosition);
  frame.lastAcceptedObject = acceptedObject;
}

export function objectsWithAcceptedSource(
  objects: readonly SceneObjectData[],
  acceptedSource: SceneObjectData
): SceneObjectData[] {
  return [
    acceptedSource,
    ...objects.filter((object) => object.id !== acceptedSource.id)
  ];
}
