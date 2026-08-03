import type { PaintTextureData } from '../../types/editor';
import type { SurfaceUvAtlas } from '../../geometry/uvAtlas';
import {
  composeSurfaceAtlasCanvas,
  createPaintTextureData,
  loadSurfaceCanvases,
  type SurfaceRasterMetric
} from './surfacePaintGrid';

export function createSurfacePaintDocument(
  surfaces: HTMLCanvasElement[],
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): PaintTextureData {
  const displayTexture = createPaintTextureData(surfaces, atlas, metrics, baseColor);
  const sourceMetrics = metrics.map((metric) => ({
    ...metric,
    coverageU: 1,
    coverageV: 1
  }));
  const sourceCanvas = composeSurfaceAtlasCanvas(surfaces, atlas, sourceMetrics, baseColor);

  return {
    ...displayTexture,
    surfaceGrid: displayTexture.surfaceGrid
      ? {
          ...displayTexture.surfaceGrid,
          sourceDataUrl: sourceCanvas.toDataURL('image/png'),
          sourceWidth: sourceCanvas.width,
          sourceHeight: sourceCanvas.height
        }
      : undefined
  };
}

export function loadSurfacePaintDocument(
  texture: PaintTextureData | undefined,
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[],
  baseColor: string
): Promise<HTMLCanvasElement[]> {
  const sourceDataUrl = texture?.surfaceGrid?.sourceDataUrl;
  const sourceWidth = texture?.surfaceGrid?.sourceWidth;
  const sourceHeight = texture?.surfaceGrid?.sourceHeight;

  if (!texture || !sourceDataUrl || !sourceWidth || !sourceHeight) {
    return loadSurfaceCanvases(texture, atlas, metrics, baseColor);
  }

  return loadSurfaceCanvases({
    ...texture,
    dataUrl: sourceDataUrl,
    width: sourceWidth,
    height: sourceHeight
  }, atlas, metrics, baseColor);
}
