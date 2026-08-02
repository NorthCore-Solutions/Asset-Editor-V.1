import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { PaintTextureData, SceneObjectData } from '../../types/editor';
import {
  DEFAULT_PAINT_SIZE,
  createFilledImageData,
  floodFill,
  hexToRgba,
  paintBrush,
  rgbaToHex,
  samplePixel
} from './pixelPaint';
import {
  getSurfacePaintSettings,
  setSurfacePaintSettings,
  subscribeSurfacePaint
} from './surfacePaintSession';

type PatchedRendererPrototype = THREE.WebGLRenderer & {
  __northcoreDirectSurfacePaintV2?: boolean;
};

interface PaintSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  sourceDataUrl?: string;
  requestedDataUrl?: string;
  baseColor: string;
}

interface ActiveRenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Object3D;
  camera: THREE.Camera;
}

interface ActiveStroke {
  pointerId: number;
  objectId: string;
  lastPoint: [number, number] | null;
  changed: boolean;
}

const OBJECT_ID = 'northcorePaintObjectId';
const LEGACY_OVERLAY_FLAG = 'northcorePaintOverlay';
const PAINT_SHIELD_ATTRIBUTE = 'data-northcore-paint-shield';
const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const surfaces = new Map<string, PaintSurface>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let activeContext: ActiveRenderContext | null = null;
let activeStroke: ActiveStroke | null = null;
let paintShield: HTMLDivElement | null = null;
let paintShieldHost: HTMLElement | null = null;

function configureTexture(texture: THREE.CanvasTexture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
}

function fillSurface(surface: PaintSurface, color: string): void {
  surface.context.putImageData(
    createFilledImageData(surface.canvas.width, surface.canvas.height, hexToRgba(color)),
    0,
    0
  );
  surface.baseColor = color;
  surface.sourceDataUrl = undefined;
  surface.requestedDataUrl = undefined;
  surface.texture.needsUpdate = true;
}

function createSurface(object: SceneObjectData): PaintSurface {
  const width = object.material.paintTexture?.width ?? DEFAULT_PAINT_SIZE;
  const height = object.material.paintTexture?.height ?? DEFAULT_PAINT_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D-Kontext für Oberflächenbemalung nicht verfügbar.');
  context.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(canvas);
  configureTexture(texture);

  const surface: PaintSurface = {
    canvas,
    context,
    texture,
    baseColor: object.material.color
  };
  fillSurface(surface, object.material.color);
  surfaces.set(object.id, surface);
  return surface;
}

function resizeSurface(surface: PaintSurface, width: number, height: number): void {
  if (surface.canvas.width === width && surface.canvas.height === height) return;
  surface.canvas.width = width;
  surface.canvas.height = height;
  surface.context.imageSmoothingEnabled = false;
  surface.texture.dispose();
  surface.texture = new THREE.CanvasTexture(surface.canvas);
  configureTexture(surface.texture);
}

function loadPaintTexture(surface: PaintSurface, paint: PaintTextureData): void {
  if (surface.sourceDataUrl === paint.dataUrl || surface.requestedDataUrl === paint.dataUrl) return;
  surface.requestedDataUrl = paint.dataUrl;
  const image = new Image();

  image.onload = () => {
    if (surface.requestedDataUrl !== paint.dataUrl) return;
    resizeSurface(surface, paint.width, paint.height);
    surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    surface.context.imageSmoothingEnabled = false;
    surface.context.drawImage(image, 0, 0, surface.canvas.width, surface.canvas.height);
    surface.sourceDataUrl = paint.dataUrl;
    surface.requestedDataUrl = undefined;
    surface.texture.needsUpdate = true;
  };

  image.onerror = () => {
    if (surface.requestedDataUrl === paint.dataUrl) surface.requestedDataUrl = undefined;
  };

  image.src = paint.dataUrl;
}

function ensureSurface(object: SceneObjectData, createWithoutPaint = false): PaintSurface | null {
  const paint = object.material.paintTexture;
  let surface = surfaces.get(object.id);

  if (!paint && !createWithoutPaint) {
    if (surface) {
      surface.texture.dispose();
      surfaces.delete(object.id);
    }
    return null;
  }

  surface ??= createSurface(object);

  if (paint) {
    loadPaintTexture(surface, paint);
  } else if (surface.baseColor !== object.material.color) {
    fillSurface(surface, object.material.color);
  }

  return surface;
}

function removeLegacyOverlay(mesh: THREE.Mesh): void {
  for (const child of [...mesh.children]) {
    if (child.userData[LEGACY_OVERLAY_FLAG] !== true) continue;
    mesh.remove(child);
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  }
}

function applyMaterial(
  material: THREE.MeshStandardMaterial,
  object: SceneObjectData,
  surface: PaintSurface | null
): void {
  const textured = Boolean(surface);
  const nextTransparent = object.material.opacity < 1 || textured;
  const nextAlphaTest = textured ? 0.001 : 0;
  const programChanged = material.map !== (surface?.texture ?? null)
    || material.transparent !== nextTransparent
    || material.alphaTest !== nextAlphaTest
    || material.flatShading !== object.material.flatShading;

  material.map = surface?.texture ?? null;
  material.color.set(textured ? '#FFFFFF' : object.material.color);
  material.emissive.set('#000000');
  material.emissiveIntensity = 0;
  material.opacity = object.material.opacity;
  material.roughness = object.material.roughness;
  material.metalness = object.material.metalness;
  material.flatShading = object.material.flatShading;
  material.transparent = nextTransparent;
  material.alphaTest = nextAlphaTest;

  if (programChanged) material.needsUpdate = true;
}

function mapSceneObjects(scene: THREE.Object3D): void {
  const state = useEditorStore.getState();
  const grouped = new Map<string, SceneObjectData[]>();
  const used = new Map<string, number>();
  const paintSettings = getSurfacePaintSettings();

  for (const object of state.objects) {
    const entries = grouped.get(object.name) ?? [];
    entries.push(object);
    grouped.set(object.name, entries);
  }

  const meshes: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.name) return;
    if (node.userData[LEGACY_OVERLAY_FLAG] === true) return;
    meshes.push(node);
  });

  for (const mesh of meshes) {
    const objects = grouped.get(mesh.name);
    if (!objects || objects.length === 0) continue;
    const index = used.get(mesh.name) ?? 0;
    const object = objects[index];
    if (!object) continue;
    used.set(mesh.name, index + 1);

    mesh.userData[OBJECT_ID] = object.id;
    removeLegacyOverlay(mesh);

    const createForActivePaint = paintSettings.enabled && state.selectedId === object.id;
    const surface = ensureSurface(object, createForActivePaint);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) applyMaterial(material, object, surface);
    }
  }
}

function selectedPaintObject(): SceneObjectData | null {
  const state = useEditorStore.getState();
  if (!state.selectedId) return null;
  return state.objects.find((object) => object.id === state.selectedId && object.visible && !object.locked) ?? null;
}

function objectIdFromIntersection(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const objectId = current.userData[OBJECT_ID];
    if (typeof objectId === 'string') return objectId;
    current = current.parent;
  }
  return null;
}

function hitPixel(clientX: number, clientY: number, objectId: string, surface: PaintSurface): [number, number] | null {
  const context = activeContext;
  if (!context) return null;
  const bounds = context.renderer.domElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  pointer.set(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -((clientY - bounds.top) / bounds.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, context.camera);

  const intersections = raycaster.intersectObjects(context.scene.children, true);
  for (const intersection of intersections) {
    if (!intersection.uv || objectIdFromIntersection(intersection.object) !== objectId) continue;
    const u = THREE.MathUtils.clamp(intersection.uv.x, 0, 0.999999);
    const v = THREE.MathUtils.clamp(intersection.uv.y, 0, 0.999999);
    return [
      Math.max(0, Math.min(surface.canvas.width - 1, Math.floor(u * surface.canvas.width))),
      Math.max(0, Math.min(surface.canvas.height - 1, Math.floor((1 - v) * surface.canvas.height)))
    ];
  }

  return null;
}

function linePoints(from: [number, number], to: [number, number]): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let [x0, y0] = from;
  const [x1, y1] = to;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x0 += sx; }
    if (doubled <= dx) { error += dx; y0 += sy; }
  }

  return points;
}

function paintAt(
  surface: PaintSurface,
  point: [number, number],
  previous: [number, number] | null
): boolean {
  const settings = getSurfacePaintSettings();
  const image = surface.context.getImageData(0, 0, surface.canvas.width, surface.canvas.height);

  if (settings.tool === 'eyedropper') {
    const sampled = samplePixel(image, point[0], point[1]);
    if (sampled.a > 0) setSurfacePaintSettings({ color: rgbaToHex(sampled) });
    return false;
  }

  if (settings.tool === 'fill') {
    floodFill(image, point[0], point[1], hexToRgba(settings.color));
  } else {
    const color = settings.tool === 'eraser'
      ? hexToRgba('#000000', 0)
      : hexToRgba(settings.color);
    const points = previous ? linePoints(previous, point) : [point];
    points.forEach(([x, y]) => paintBrush(image, x, y, settings.brushSize, color));
  }

  surface.context.putImageData(image, 0, 0);
  surface.texture.needsUpdate = true;
  return true;
}

function persistSurface(objectId: string, surface: PaintSurface): void {
  const dataUrl = surface.canvas.toDataURL('image/png');
  surface.sourceDataUrl = dataUrl;
  surface.requestedDataUrl = undefined;
  useEditorStore.getState().updateMaterial(objectId, {
    paintTexture: {
      dataUrl,
      width: surface.canvas.width,
      height: surface.canvas.height,
      pixelated: true
    }
  });
}

function blockPointerEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
}

function handleShieldPointerDown(event: PointerEvent): void {
  if (!getSurfacePaintSettings().enabled) return;
  blockPointerEvent(event);
  if (event.button !== 0) return;

  const object = selectedPaintObject();
  if (!object) return;
  const surface = ensureSurface(object, true);
  if (!surface) return;
  const point = hitPixel(event.clientX, event.clientY, object.id, surface);
  if (!point) return;

  try { paintShield?.setPointerCapture(event.pointerId); } catch { /* Pointer-Capture optional */ }

  const settings = getSurfacePaintSettings();
  const changed = paintAt(surface, point, null);
  if (settings.tool === 'fill') {
    if (changed) persistSurface(object.id, surface);
    return;
  }
  if (settings.tool === 'eyedropper') return;

  activeStroke = {
    pointerId: event.pointerId,
    objectId: object.id,
    lastPoint: point,
    changed
  };
}

function handleShieldPointerMove(event: PointerEvent): void {
  if (!getSurfacePaintSettings().enabled) return;
  blockPointerEvent(event);
  const stroke = activeStroke;
  if (!stroke || stroke.pointerId !== event.pointerId) return;

  const object = useEditorStore.getState().objects.find((entry) => entry.id === stroke.objectId);
  const surface = surfaces.get(stroke.objectId);
  if (!object || !surface) return;
  const point = hitPixel(event.clientX, event.clientY, stroke.objectId, surface);
  if (!point) {
    stroke.lastPoint = null;
    return;
  }

  const previous = stroke.lastPoint;
  const crossesUvSeam = previous
    ? Math.abs(previous[0] - point[0]) > surface.canvas.width / 2
      || Math.abs(previous[1] - point[1]) > surface.canvas.height / 2
    : false;
  stroke.changed = paintAt(surface, point, crossesUvSeam ? null : previous) || stroke.changed;
  stroke.lastPoint = point;
}

function finishShieldStroke(event: PointerEvent): void {
  if (!getSurfacePaintSettings().enabled) return;
  blockPointerEvent(event);
  const stroke = activeStroke;
  if (!stroke || stroke.pointerId !== event.pointerId) return;
  activeStroke = null;

  const surface = surfaces.get(stroke.objectId);
  if (surface && stroke.changed) persistSurface(stroke.objectId, surface);
  try {
    if (paintShield?.hasPointerCapture(event.pointerId)) paintShield.releasePointerCapture(event.pointerId);
  } catch { /* Pointer-Capture optional */ }
}

function handleShieldWheel(event: WheelEvent): void {
  if (!getSurfacePaintSettings().enabled) return;
  blockPointerEvent(event);
}

function handleShieldContextMenu(event: MouseEvent): void {
  if (!getSurfacePaintSettings().enabled) return;
  blockPointerEvent(event);
}

function removePaintShield(): void {
  activeStroke = null;
  if (paintShield) paintShield.remove();
  paintShield = null;
  paintShieldHost = null;
}

function createPaintShield(host: HTMLElement): HTMLDivElement {
  const shield = document.createElement('div');
  shield.setAttribute(PAINT_SHIELD_ATTRIBUTE, 'true');
  shield.tabIndex = -1;
  Object.assign(shield.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '50',
    cursor: 'crosshair',
    touchAction: 'none',
    userSelect: 'none',
    background: 'transparent',
    pointerEvents: 'auto'
  });

  const badge = document.createElement('div');
  badge.textContent = 'Malmodus aktiv · Kamera und Transformation gesperrt';
  Object.assign(badge.style, {
    position: 'absolute',
    left: '12px',
    top: '12px',
    padding: '6px 9px',
    border: '1px solid #68a47d',
    borderRadius: '4px',
    color: '#dff4e7',
    background: 'rgba(25, 48, 36, 0.9)',
    fontSize: '12px',
    pointerEvents: 'none'
  });
  shield.appendChild(badge);

  shield.addEventListener('pointerdown', handleShieldPointerDown, true);
  shield.addEventListener('pointermove', handleShieldPointerMove, true);
  shield.addEventListener('pointerup', finishShieldStroke, true);
  shield.addEventListener('pointercancel', finishShieldStroke, true);
  shield.addEventListener('lostpointercapture', () => { activeStroke = null; }, true);
  shield.addEventListener('wheel', handleShieldWheel, { capture: true, passive: false });
  shield.addEventListener('contextmenu', handleShieldContextMenu, true);

  const position = window.getComputedStyle(host).position;
  if (position === 'static') host.style.position = 'relative';
  host.appendChild(shield);
  return shield;
}

function ensurePaintShield(): void {
  const canvas = activeContext?.renderer.domElement;
  const host = canvas?.closest<HTMLElement>('.viewport') ?? null;
  if (!host) return;

  if (paintShield && paintShieldHost === host && paintShield.isConnected) return;
  removePaintShield();
  paintShieldHost = host;
  paintShield = createPaintShield(host);
}

function handleCameraKey(event: KeyboardEvent): void {
  if (!getSurfacePaintSettings().enabled) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (!CAMERA_KEYS.has(event.key.toLowerCase())) return;
  blockPointerEvent(event);
}

window.addEventListener('keydown', handleCameraKey, true);

subscribeSurfacePaint((settings) => {
  if (settings.enabled) ensurePaintShield();
  else removePaintShield();
});

const prototype = THREE.WebGLRenderer.prototype as PatchedRendererPrototype;

if (!prototype.__northcoreDirectSurfacePaintV2) {
  const originalRender = prototype.render;

  prototype.render = function renderWithDirectSurfacePaint(
    this: THREE.WebGLRenderer,
    scene: THREE.Object3D,
    camera: THREE.Camera
  ): void {
    activeContext = { renderer: this, scene, camera };
    mapSceneObjects(scene);

    if (getSurfacePaintSettings().enabled) ensurePaintShield();
    else removePaintShield();

    originalRender.call(this, scene, camera);
  };

  prototype.__northcoreDirectSurfacePaintV2 = true;
}
