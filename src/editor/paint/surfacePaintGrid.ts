import * as THREE from 'three';
import type {
  PaintSurfaceGridData,
  PaintSurfaceGridLayerData,
  PaintTextureData,
  Vec3
} from '../../types/editor';
import {
  atlasIslandAtUv,
  atlasPixelRegion,
  type SurfaceUvAtlas
} from '../../geometry/uvAtlas';
import { createFilledImageData, hexToRgba } from './pixelPaint';

export const PAINT_PIXELS_PER_WORLD_UNIT = 32;
const MAX_SURFACE_PIXELS = 384;
const EPSILON = 0.000001;

export interface SurfaceRasterMetric extends PaintSurfaceGridLayerData {
  worldWidth: number;
  worldHeight: number;
}

export interface SurfaceUvWindow {
  offsetU: number;
  offsetV: number;
  scaleU: number;
  scaleV: number;
}

interface SurfaceAccumulator {
  width: number;
  height: number;
  weight: number;
}

function vertexIndex(geometry: THREE.BufferGeometry, triangleOffset: number): number {
  return geometry.index?.getX(triangleOffset) ?? triangleOffset;
}

function vectorAt(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number
): THREE.Vector3 {
  return new THREE.Vector3(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
}

function uvAt(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number
): THREE.Vector2 {
  return new THREE.Vector2(attribute.getX(index), attribute.getY(index));
}

function localIslandUv(atlas: SurfaceUvAtlas, islandIndex: number, uv: THREE.Vector2): THREE.Vector2 | null {
  const island = atlas.islands[islandIndex];
  if (!island) return null;
  const width = island.uMax - island.uMin;
  const height = island.vMax - island.vMin;
  if (width <= EPSILON || height <= EPSILON) return null;
  return new THREE.Vector2(
    (uv.x - island.uMin) / width,
    (uv.y - island.vMin) / height
  );
}

function scaledVector(vector: THREE.Vector3, scale: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    vector.x * scale.x,
    vector.y * scale.y,
    vector.z * scale.z
  );
}

function fallbackExtent(
  label: string,
  worldSize: THREE.Vector3
): { width: number; height: number } {
  const direction = label.replace(/\s+\d+$/u, '');
  if (direction === 'Vorne' || direction === 'Hinten') {
    return { width: worldSize.x, height: worldSize.y };
  }
  if (direction === 'Links' || direction === 'Rechts') {
    return { width: worldSize.z, height: worldSize.y };
  }
  if (direction === 'Oben' || direction === 'Unten') {
    return { width: worldSize.x, height: worldSize.z };
  }
  const sorted = [worldSize.x, worldSize.y, worldSize.z].sort((left, right) => right - left);
  return { width: sorted[0] ?? 1, height: sorted[1] ?? sorted[0] ?? 1 };
}

function metricDimension(worldLength: number): { pixels: number; coverage: number } {
  const rawPixels = Math.max(EPSILON, worldLength) * PAINT_PIXELS_PER_WORLD_UNIT;
  const unclampedPixels = Math.max(1, Math.ceil(rawPixels));
  const pixels = Math.min(MAX_SURFACE_PIXELS, unclampedPixels);
  return {
    pixels,
    coverage: unclampedPixels === pixels
      ? THREE.MathUtils.clamp(rawPixels / pixels, 1 / pixels, 1)
      : 1
  };
}

export function getSurfaceRasterMetrics(
  geometry: THREE.BufferGeometry,
  scaleValue: Vec3,
  atlas: SurfaceUvAtlas
): SurfaceRasterMetric[] {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const scale = new THREE.Vector3(
    Math.abs(scaleValue[0]),
    Math.abs(scaleValue[1]),
    Math.abs(scaleValue[2])
  );

  geometry.computeBoundingBox();
  const localBox = geometry.boundingBox?.clone()
    ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const localSize = localBox.getSize(new THREE.Vector3());
  const worldSize = new THREE.Vector3(
    Math.abs(localSize.x * scale.x),
    Math.abs(localSize.y * scale.y),
    Math.abs(localSize.z * scale.z)
  );

  const accumulators: SurfaceAccumulator[] = atlas.islands.map(() => ({ width: 0, height: 0, weight: 0 }));

  if (position && uv && position.count >= 3 && uv.count >= 3) {
    const triangleValueCount = geometry.index?.count ?? position.count;

    for (let offset = 0; offset + 2 < triangleValueCount; offset += 3) {
      const indexA = vertexIndex(geometry, offset);
      const indexB = vertexIndex(geometry, offset + 1);
      const indexC = vertexIndex(geometry, offset + 2);
      const pointA = vectorAt(position, indexA);
      const pointB = vectorAt(position, indexB);
      const pointC = vectorAt(position, indexC);
      const uvA = uvAt(uv, indexA);
      const uvB = uvAt(uv, indexB);
      const uvC = uvAt(uv, indexC);
      const centroidUv = uvA.clone().add(uvB).add(uvC).multiplyScalar(1 / 3);
      const islandIndex = atlasIslandAtUv(atlas, centroidUv);
      const accumulator = accumulators[islandIndex];
      if (!accumulator) continue;

      const localA = localIslandUv(atlas, islandIndex, uvA);
      const localB = localIslandUv(atlas, islandIndex, uvB);
      const localC = localIslandUv(atlas, islandIndex, uvC);
      if (!localA || !localB || !localC) continue;

      const edgeOne = pointB.clone().sub(pointA);
      const edgeTwo = pointC.clone().sub(pointA);
      const uvOne = localB.clone().sub(localA);
      const uvTwo = localC.clone().sub(localA);
      const determinant = uvOne.x * uvTwo.y - uvOne.y * uvTwo.x;
      if (Math.abs(determinant) <= EPSILON) continue;

      const inverse = 1 / determinant;
      const tangentU = edgeOne.clone().multiplyScalar(uvTwo.y)
        .sub(edgeTwo.clone().multiplyScalar(uvOne.y))
        .multiplyScalar(inverse);
      const tangentV = edgeTwo.clone().multiplyScalar(uvOne.x)
        .sub(edgeOne.clone().multiplyScalar(uvTwo.x))
        .multiplyScalar(inverse);
      const worldU = scaledVector(tangentU, scale).length();
      const worldV = scaledVector(tangentV, scale).length();
      const worldArea = scaledVector(edgeOne, scale)
        .cross(scaledVector(edgeTwo, scale))
        .length() * 0.5;
      const weight = Math.max(EPSILON, worldArea);

      accumulator.width += worldU * weight;
      accumulator.height += worldV * weight;
      accumulator.weight += weight;
    }
  }

  return atlas.islands.map((island, index) => {
    const accumulator = accumulators[index];
    const fallback = fallbackExtent(island.label, worldSize);
    const worldWidth = accumulator && accumulator.weight > EPSILON
      ? accumulator.width / accumulator.weight
      : fallback.width;
    const worldHeight = accumulator && accumulator.weight > EPSILON
      ? accumulator.height / accumulator.weight
      : fallback.height;
    const width = metricDimension(worldWidth);
    const height = metricDimension(worldHeight);

    return {
      label: island.label,
      width: width.pixels,
      height: height.pixels,
      coverageU: width.coverage,
      coverageV: height.coverage,
      worldWidth,
      worldHeight
    };
  });
}

function bottomAnchored(label: string): boolean {
  const direction = label.replace(/\s+\d+$/u, '');
  return direction === 'Vorne'
    || direction === 'Hinten'
    || direction === 'Links'
    || direction === 'Rechts'
    || direction === 'Mantel'
    || direction === 'Rundung'
    || direction === 'Schräge';
}

export function surfaceUvWindow(metric: PaintSurfaceGridLayerData): SurfaceUvWindow {
  const scaleU = THREE.MathUtils.clamp(metric.coverageU, EPSILON, 1);
  const scaleV = THREE.MathUtils.clamp(metric.coverageV, EPSILON, 1);
  return {
    offsetU: (1 - scaleU) * 0.5,
    offsetV: bottomAnchored(metric.label) ? 0 : (1 - scaleV) * 0.5,
    scaleU,
    scaleV
  };
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D-Kontext für Flächenraster nicht verfügbar.');
  context.imageSmoothingEnabled = false;
  return context;
}

export function createFilledSurfaceCanvas(width: number, height: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  canvasContext(canvas).putImageData(
    createFilledImageData(canvas.width, canvas.height, hexToRgba(color)),
    0,
    0
  );
  return canvas;
}

export function cloneSurfaceCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvasContext(canvas).drawImage(source, 0, 0);
  return canvas;
}

export function resizeSurfaceCanvas(
  source: HTMLCanvasElement,
  metric: PaintSurfaceGridLayerData,
  baseColor: string
): HTMLCanvasElement {
  if (source.width === metric.width && source.height === metric.height) return cloneSurfaceCanvas(source);

  const target = createFilledSurfaceCanvas(metric.width, metric.height, baseColor);
  const sourceContext = canvasContext(source);
  const targetContext = canvasContext(target);
  const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);
  const targetPixels = targetContext.getImageData(0, 0, target.width, target.height);
  const offsetX = Math.floor((target.width - source.width) / 2);
  const offsetY = bottomAnchored(metric.label)
    ? target.height - source.height
    : Math.floor((target.height - source.height) / 2);

  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    const targetY = sourceY + offsetY;
    if (targetY < 0 || targetY >= target.height) continue;

    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const targetX = sourceX + offsetX;
      if (targetX < 0 || targetX >= target.width) continue;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (targetY * target.width + targetX) * 4;
      targetPixels.data[targetOffset] = sourcePixels.data[sourceOffset] ?? 0;
      targetPixels.data[targetOffset + 1] = sourcePixels.data[sourceOffset + 1] ?? 0;
      targetPixels.data[targetOffset + 2] = sourcePixels.data[sourceOffset + 2] ?? 0;
      targetPixels.data[targetOffset + 3] = sourcePixels.data[sourceOffset + 3] ?? 0;
    }
  }

  targetContext.putImageData(targetPixels, 0, 0);
  return target;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Bemalung konnte nicht geladen werden.'));
    image.src = dataUrl;
  });
}

export async function loadSurfaceCanvases(
  texture: PaintTextureData | undefined,
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): Promise<HTMLCanvasElement[]> {
  if (!texture) {
    return metrics.map((metric) => createFilledSurfaceCanvas(metric.width, metric.height, baseColor));
  }

  const storedGrid = texture.surfaceGrid;
  const compatibleGrid = storedGrid?.version === 1
    && storedGrid.atlasSignature === atlas.signature
    && storedGrid.surfaces.length === atlas.islands.length;
  const sourceDataUrl = compatibleGrid && storedGrid.sourceDataUrl
    ? storedGrid.sourceDataUrl
    : texture.dataUrl;
  const sourceWidth = compatibleGrid && storedGrid.sourceWidth
    ? storedGrid.sourceWidth
    : texture.width;
  const sourceHeight = compatibleGrid && storedGrid.sourceHeight
    ? storedGrid.sourceHeight
    : texture.height;
  const image = await loadImage(sourceDataUrl);

  return metrics.map((metric, index) => {
    const region = atlasPixelRegion(atlas, index, sourceWidth, sourceHeight);
    const regionWidth = Math.max(1, region.maxX - region.minX + 1);
    const regionHeight = Math.max(1, region.maxY - region.minY + 1);
    const stored = compatibleGrid ? storedGrid.surfaces[index] : undefined;
    const storedWidth = Math.max(1, stored?.width ?? metric.width);
    const storedHeight = Math.max(1, stored?.height ?? metric.height);
    const extracted = document.createElement('canvas');
    extracted.width = storedWidth;
    extracted.height = storedHeight;
    const extractedContext = canvasContext(extracted);
    extractedContext.drawImage(
      image,
      region.minX,
      region.minY,
      regionWidth,
      regionHeight,
      0,
      0,
      storedWidth,
      storedHeight
    );
    return resizeSurfaceCanvas(extracted, metric, baseColor);
  });
}

export function resizeSurfaceCanvases(
  surfaces: HTMLCanvasElement[],
  metrics: SurfaceRasterMetric[],
  baseColor: string
): HTMLCanvasElement[] {
  return metrics.map((metric, index) => {
    const source = surfaces[index]
      ?? createFilledSurfaceCanvas(metric.width, metric.height, baseColor);
    return resizeSurfaceCanvas(source, metric, baseColor);
  });
}

export function composeSurfaceAtlasCanvas(
  surfaces: HTMLCanvasElement[],
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): HTMLCanvasElement {
  const innerRatio = Math.max(0.1, 1 - atlas.padding * 2);
  const maxWidth = Math.max(1, ...metrics.map((metric) => metric.width));
  const maxHeight = Math.max(1, ...metrics.map((metric) => metric.height));
  const cellWidth = Math.max(4, Math.ceil(maxWidth / innerRatio));
  const cellHeight = Math.max(4, Math.ceil(maxHeight / innerRatio));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, atlas.columns * cellWidth);
  canvas.height = Math.max(1, atlas.rows * cellHeight);
  const context = canvasContext(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);

  atlas.islands.forEach((_, index) => {
    const metric = metrics[index];
    if (!metric) return;
    const surface = surfaces[index]
      ?? createFilledSurfaceCanvas(metric.width, metric.height, baseColor);
    const region = atlasPixelRegion(atlas, index, canvas.width, canvas.height);
    const targetWidth = Math.max(1, region.maxX - region.minX + 1);
    const targetHeight = Math.max(1, region.maxY - region.minY + 1);
    const window = surfaceUvWindow(metric);
    const sourceX = window.offsetU * surface.width;
    const sourceY = (1 - window.offsetV - window.scaleV) * surface.height;
    const sourceWidth = Math.max(EPSILON, window.scaleU * surface.width);
    const sourceHeight = Math.max(EPSILON, window.scaleV * surface.height);

    context.drawImage(
      surface,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      region.minX,
      region.minY,
      targetWidth,
      targetHeight
    );
  });

  return canvas;
}

export function createPaintTextureData(
  surfaces: HTMLCanvasElement[],
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): PaintTextureData {
  const displayCanvas = composeSurfaceAtlasCanvas(surfaces, atlas, metrics, baseColor);
  const sourceMetrics = metrics.map((metric) => ({
    ...metric,
    coverageU: 1,
    coverageV: 1
  }));
  const sourceCanvas = composeSurfaceAtlasCanvas(surfaces, atlas, sourceMetrics, baseColor);
  const surfaceGrid: PaintSurfaceGridData = {
    version: 1,
    atlasSignature: atlas.signature,
    pixelsPerWorldUnit: PAINT_PIXELS_PER_WORLD_UNIT,
    surfaces: metrics.map(({ label, width, height, coverageU, coverageV }) => ({
      label,
      width,
      height,
      coverageU,
      coverageV
    })),
    sourceDataUrl: sourceCanvas.toDataURL('image/png'),
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height
  };

  return {
    dataUrl: displayCanvas.toDataURL('image/png'),
    width: displayCanvas.width,
    height: displayCanvas.height,
    pixelated: true,
    surfaceGrid
  };
}

export function copySurfaceCanvas(
  source: HTMLCanvasElement,
  targetMetric: SurfaceRasterMetric
): HTMLCanvasElement {
  const target = document.createElement('canvas');
  target.width = targetMetric.width;
  target.height = targetMetric.height;
  const context = canvasContext(target);
  context.drawImage(source, 0, 0, source.width, source.height, 0, 0, target.width, target.height);
  return target;
}

export function surfacePointFromUv(
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  uv: THREE.Vector2
): { islandIndex: number; point: [number, number] } | null {
  const islandIndex = atlasIslandAtUv(atlas, uv);
  const island = atlas.islands[islandIndex];
  const metric = metrics[islandIndex];
  if (!island || !metric) return null;

  const islandWidth = Math.max(EPSILON, island.uMax - island.uMin);
  const islandHeight = Math.max(EPSILON, island.vMax - island.vMin);
  const localU = THREE.MathUtils.clamp((uv.x - island.uMin) / islandWidth, 0, 0.999999);
  const localV = THREE.MathUtils.clamp((uv.y - island.vMin) / islandHeight, 0, 0.999999);
  const window = surfaceUvWindow(metric);
  const sampleU = window.offsetU + localU * window.scaleU;
  const sampleV = window.offsetV + localV * window.scaleV;

  return {
    islandIndex,
    point: [
      Math.max(0, Math.min(metric.width - 1, Math.floor(sampleU * metric.width))),
      Math.max(0, Math.min(metric.height - 1, Math.floor((1 - sampleV) * metric.height)))
    ]
  };
}

export function surfaceMetricsKey(metrics: SurfaceRasterMetric[]): string {
  return metrics.map((metric) => [
    metric.label,
    metric.width,
    metric.height,
    metric.coverageU.toFixed(6),
    metric.coverageV.toFixed(6)
  ].join(':')).join('|');
}

export function surfaceDimensionsKey(metrics: SurfaceRasterMetric[]): string {
  return metrics.map((metric) => `${metric.width}x${metric.height}`).join('|');
}
