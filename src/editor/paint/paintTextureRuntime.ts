import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { SceneObjectData } from '../../types/editor';

type PatchedRendererPrototype = THREE.WebGLRenderer & {
  __northcorePaintTextureOverlayV1?: boolean;
};

const OVERLAY_FLAG = 'northcorePaintOverlay';
const textureCache = new Map<string, THREE.Texture>();
const pendingCallbacks = new Map<string, Array<(texture: THREE.Texture) => void>>();

function configureTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
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

function resetBaseMaterial(material: THREE.MeshStandardMaterial, object: SceneObjectData): void {
  const nextTransparent = object.material.opacity < 1;
  const requiresProgramUpdate = material.map !== null
    || material.transparent !== nextTransparent
    || material.alphaTest !== 0
    || material.flatShading !== object.material.flatShading;

  material.map = null;
  material.color.set(object.material.color);
  material.emissive.set('#000000');
  material.emissiveIntensity = 0;
  material.opacity = object.material.opacity;
  material.roughness = object.material.roughness;
  material.metalness = object.material.metalness;
  material.flatShading = object.material.flatShading;
  material.transparent = nextTransparent;
  material.alphaTest = 0;

  if (requiresProgramUpdate) material.needsUpdate = true;
}

function paintOverlay(mesh: THREE.Mesh): THREE.Mesh | null {
  return mesh.children.find((child) => child.userData[OVERLAY_FLAG] === true) as THREE.Mesh | undefined ?? null;
}

function removePaintOverlay(mesh: THREE.Mesh): void {
  const overlay = paintOverlay(mesh);
  if (!overlay) return;
  mesh.remove(overlay);
  const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material];
  materials.forEach((material) => material.dispose());
}

function createPaintOverlay(mesh: THREE.Mesh, object: SceneObjectData): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: object.material.roughness,
    metalness: object.material.metalness,
    opacity: object.material.opacity,
    transparent: true,
    alphaTest: 0.001,
    flatShading: object.material.flatShading,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });

  const overlay = new THREE.Mesh(mesh.geometry, material);
  overlay.name = `${mesh.name} Bemalung`;
  overlay.userData[OVERLAY_FLAG] = true;
  overlay.scale.setScalar(1.001);
  overlay.renderOrder = mesh.renderOrder + 1;
  overlay.castShadow = false;
  overlay.receiveShadow = mesh.receiveShadow;
  overlay.frustumCulled = mesh.frustumCulled;
  overlay.visible = false;
  overlay.raycast = () => {};
  mesh.add(overlay);
  return overlay;
}

function updatePaintOverlay(mesh: THREE.Mesh, object: SceneObjectData): void {
  const paint = object.material.paintTexture;
  if (!paint) {
    removePaintOverlay(mesh);
    return;
  }

  const overlay = paintOverlay(mesh) ?? createPaintOverlay(mesh, object);
  overlay.geometry = mesh.geometry;
  overlay.renderOrder = mesh.renderOrder + 1;

  const material = overlay.material as THREE.MeshStandardMaterial;
  material.roughness = object.material.roughness;
  material.metalness = object.material.metalness;
  material.opacity = object.material.opacity;
  material.flatShading = object.material.flatShading;
  material.transparent = true;
  material.alphaTest = 0.001;
  material.color.set('#FFFFFF');

  const activeUrl = material.userData.northcorePaintDataUrl as string | undefined;
  material.userData.northcorePaintDataUrl = paint.dataUrl;

  const cached = textureCache.get(paint.dataUrl);
  if (cached) {
    if (material.map !== cached) {
      material.map = cached;
      material.needsUpdate = true;
    }
    overlay.visible = true;
    return;
  }

  if (activeUrl !== paint.dataUrl) {
    overlay.visible = false;
    material.map = null;
    material.needsUpdate = true;
  }

  requestTexture(paint.dataUrl, (texture) => {
    if (material.userData.northcorePaintDataUrl !== paint.dataUrl) return;
    material.map = texture;
    material.needsUpdate = true;
    overlay.visible = true;
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

if (!prototype.__northcorePaintTextureOverlayV1) {
  const originalRender = prototype.render;

  prototype.render = function renderWithPaintTextureOverlay(
    this: THREE.WebGLRenderer,
    scene: THREE.Object3D,
    camera: THREE.Camera
  ): void {
    const objectsByName = sceneObjectsByName();
    const usedByName = new Map<string, number>();
    const meshes: THREE.Mesh[] = [];

    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.userData[OVERLAY_FLAG] === true) return;
      if (!node.name) return;
      meshes.push(node);
    });

    for (const mesh of meshes) {
      const objects = objectsByName.get(mesh.name);
      if (!objects || objects.length === 0) continue;

      const index = usedByName.get(mesh.name) ?? 0;
      const object = objects[index];
      if (!object) continue;
      usedByName.set(mesh.name, index + 1);

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) resetBaseMaterial(material, object);
      }

      updatePaintOverlay(mesh, object);
    }

    originalRender.call(this, scene, camera);
  };

  prototype.__northcorePaintTextureOverlayV1 = true;
}
