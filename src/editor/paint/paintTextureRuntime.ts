import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData } from '../../types/editor';

type PatchedRendererPrototype = THREE.WebGLRenderer & {
  __northcorePaintTextureRuntimeV3?: boolean;
};

const textureCache = new Map<string, THREE.Texture>();
const pendingCallbacks = new Map<string, Array<(texture: THREE.Texture) => void>>();

function configureTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
}

function requestTexture(dataUrl: string, onReady: (texture: THREE.Texture) => void): void {
  const cached = textureCache.get(dataUrl);
  if (cached) {
    onReady(cached);
    return;
  }

  const waiting = pendingCallbacks.get(dataUrl);
  if (waiting) {
    waiting.push(onReady);
    return;
  }

  pendingCallbacks.set(dataUrl, [onReady]);
  const image = new Image();

  image.onload = () => {
    const texture = new THREE.Texture(image);
    configureTexture(texture);
    textureCache.set(dataUrl, texture);

    const callbacks = pendingCallbacks.get(dataUrl) ?? [];
    pendingCallbacks.delete(dataUrl);
    callbacks.forEach((callback) => callback(texture));
  };

  image.onerror = () => {
    pendingCallbacks.delete(dataUrl);
  };

  image.src = dataUrl;
}

function applyTexture(material: THREE.MeshStandardMaterial, object: SceneObjectData): void {
  const paint = object.material.paintTexture;
  const activeUrl = material.userData.northcorePaintDataUrl as string | undefined;

  material.emissive.set('#000000');
  material.emissiveIntensity = 0;
  material.opacity = object.material.opacity;
  material.roughness = object.material.roughness;
  material.metalness = object.material.metalness;
  material.flatShading = object.material.flatShading;

  if (!paint) {
    material.transparent = object.material.opacity < 1;
    material.alphaTest = 0;
    material.userData.northcorePaintDataUrl = undefined;
    material.map = null;
    material.color.set(object.material.color);
    material.needsUpdate = true;
    return;
  }

  material.transparent = true;
  material.alphaTest = 0.001;
  material.color.set('#FFFFFF');
  material.userData.northcorePaintDataUrl = paint.dataUrl;

  const cached = textureCache.get(paint.dataUrl);
  if (cached) {
    if (material.map !== cached) {
      material.map = cached;
      material.needsUpdate = true;
    }
    return;
  }

  if (activeUrl === paint.dataUrl && material.map) return;

  requestTexture(paint.dataUrl, (texture) => {
    if (material.userData.northcorePaintDataUrl !== paint.dataUrl) return;
    material.map = texture;
    material.needsUpdate = true;
  });
}

function sceneObjectsByName(): Map<string, SceneObjectData[]> {
  const grouped = new Map<string, SceneObjectData[]>();
  for (const object of useEditorStore.getState().objects) {
    const entries = grouped.get(object.name) ?? [];
    entries.push(object);
    grouped.set(object.name, entries);
  }
  return grouped;
}

const prototype = THREE.WebGLRenderer.prototype as PatchedRendererPrototype;

if (!prototype.__northcorePaintTextureRuntimeV3) {
  const originalRender = prototype.render;

  prototype.render = function renderWithPaintTextures(
    this: THREE.WebGLRenderer,
    scene: THREE.Object3D,
    camera: THREE.Camera
  ): void {
    const objectsByName = sceneObjectsByName();
    const usedByName = new Map<string, number>();

    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !node.name) return;
      const objects = objectsByName.get(node.name);
      if (!objects || objects.length === 0) return;

      const index = usedByName.get(node.name) ?? 0;
      const object = objects[index];
      if (!object) return;
      usedByName.set(node.name, index + 1);

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) applyTexture(material, object);
      }
    });

    originalRender.call(this, scene, camera);
  };

  prototype.__northcorePaintTextureRuntimeV3 = true;
}
