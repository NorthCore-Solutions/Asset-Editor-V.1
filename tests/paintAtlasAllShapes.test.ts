import { describe, expect, it } from 'vitest';
import {
  atlasPixelToSourcePixel,
  atlasRegionPixelSize,
  chooseAtlasCellPixelSize,
  chooseAtlasInnerPixelSize,
  normalizedCoordinateToPixel
} from '../src/editor/paint/surfaceAtlasSizing';
import { getSurfaceRasterMetrics } from '../src/editor/paint/surfacePaintGrid';
import { createGeometry, createSceneObject, SHAPE_DEFINITIONS } from '../src/geometry/factory';
import { atlasPixelRegion, getSurfaceUvAtlas } from '../src/geometry/uvAtlas';
import type { PrimitiveType } from '../src/types/editor';

const MAX_SURFACE_PIXELS = 384;
const EPSILON = 0.000001;

const EXPECTED_ATLAS_MODES: Record<PrimitiveType, 'native' | 'groups' | 'planar'> = {
  box: 'groups',
  cuboid: 'groups',
  sphere: 'native',
  hemisphere: 'groups',
  cylinder: 'groups',
  cone: 'groups',
  pyramid: 'planar',
  plane: 'planar',
  torus: 'native',
  wedge: 'planar',
  prism: 'planar',
  wall: 'groups',
  floor: 'groups',
  flatRoof: 'groups',
  gableRoof: 'planar',
  shedRoof: 'planar',
  door: 'groups',
  window: 'groups',
  column: 'groups',
  chimney: 'groups',
  stairs: 'planar'
};

interface AxisMappingInput {
  atlasRegionStart: number;
  atlasRegionPixels: number;
  canvasPixels: number;
  sourceStart: number;
  sourcePixels: number;
  sourceLimit: number;
}

function mappedSourcePixel(input: AxisMappingInput, atlasPixel: number): number {
  return atlasPixelToSourcePixel(
    atlasPixel,
    input.atlasRegionStart,
    input.atlasRegionPixels,
    input.sourceStart,
    input.sourcePixels,
    input.sourceLimit
  );
}

function expectCompleteAtlasPixelHitArea(input: AxisMappingInput): void {
  let previousSourcePixel = -1;
  const hitCounts = Array.from({ length: input.sourceLimit }, () => 0);

  for (let localPixel = 0; localPixel < input.atlasRegionPixels; localPixel += 1) {
    const atlasPixel = input.atlasRegionStart + localPixel;
    const expectedSourcePixel = mappedSourcePixel(input, atlasPixel);
    const leftInside = (atlasPixel + 0.001) / input.canvasPixels;
    const rightInside = (atlasPixel + 0.999) / input.canvasPixels;

    for (const coordinate of [leftInside, rightInside]) {
      const resolvedAtlasPixel = normalizedCoordinateToPixel(coordinate, input.canvasPixels);
      expect(resolvedAtlasPixel).toBe(atlasPixel);
      expect(mappedSourcePixel(input, resolvedAtlasPixel)).toBe(expectedSourcePixel);
    }

    expect(expectedSourcePixel).toBeGreaterThanOrEqual(0);
    expect(expectedSourcePixel).toBeLessThan(input.sourceLimit);
    expect(expectedSourcePixel).toBeGreaterThanOrEqual(previousSourcePixel);
    hitCounts[expectedSourcePixel] = (hitCounts[expectedSourcePixel] ?? 0) + 1;
    previousSourcePixel = expectedSourcePixel;
  }

  const firstVisiblePixel = Math.max(0, Math.floor(input.sourceStart));
  const lastVisiblePixel = Math.min(
    input.sourceLimit - 1,
    Math.floor(input.sourceStart + input.sourcePixels - EPSILON)
  );

  for (let sourcePixel = firstVisiblePixel; sourcePixel <= lastVisiblePixel; sourcePixel += 1) {
    expect(hitCounts[sourcePixel]).toBeGreaterThan(0);
  }

  if (
    Math.abs(input.sourceStart - Math.round(input.sourceStart)) <= EPSILON
    && Math.abs(input.sourcePixels - Math.round(input.sourcePixels)) <= EPSILON
    && Math.round(input.sourcePixels) === input.sourceLimit
  ) {
    const visibleCounts = hitCounts.slice(firstVisiblePixel, lastVisiblePixel + 1);
    const minimum = Math.min(...visibleCounts);
    const maximum = Math.max(...visibleCounts);

    expect(maximum - minimum).toBeLessThanOrEqual(1);
    if (input.atlasRegionPixels % input.sourceLimit === 0) {
      expect(new Set(visibleCounts).size).toBe(1);
    }
  }
}

describe('Paint-Atlas aller Inventarformen', () => {
  it('enthält genau die 21 vorgesehenen Formen', () => {
    expect(SHAPE_DEFINITIONS).toHaveLength(21);
    expect(new Set(SHAPE_DEFINITIONS.map(({ type }) => type)).size).toBe(21);
  });

  it.each(SHAPE_DEFINITIONS)(
    '$label nutzt pixelstabile Atlasflächen und vollständig klickbare Kacheln',
    ({ type }) => {
      const object = createSceneObject(type);
      const geometry = createGeometry(object);

      try {
        const atlas = getSurfaceUvAtlas(geometry);
        const metrics = getSurfaceRasterMetrics(geometry, object.scale, atlas);

        expect(atlas.mode).toBe(EXPECTED_ATLAS_MODES[type]);
        expect(geometry.getAttribute('uv')).toBeDefined();
        expect(atlas.islands.length).toBeGreaterThan(0);
        expect(metrics).toHaveLength(atlas.islands.length);

        metrics.forEach((metric) => {
          expect(Number.isInteger(metric.width)).toBe(true);
          expect(Number.isInteger(metric.height)).toBe(true);
          expect(metric.width).toBeGreaterThan(0);
          expect(metric.height).toBeGreaterThan(0);
          expect(metric.width).toBeLessThanOrEqual(MAX_SURFACE_PIXELS);
          expect(metric.height).toBeLessThanOrEqual(MAX_SURFACE_PIXELS);
          expect(metric.coverageU).toBeGreaterThan(0);
          expect(metric.coverageU).toBeLessThanOrEqual(1);
          expect(metric.coverageV).toBeGreaterThan(0);
          expect(metric.coverageV).toBeLessThanOrEqual(1);
        });

        const innerWidth = chooseAtlasInnerPixelSize(
          metrics.map((metric) => metric.width),
          MAX_SURFACE_PIXELS
        );
        const innerHeight = chooseAtlasInnerPixelSize(
          metrics.map((metric) => metric.height),
          MAX_SURFACE_PIXELS
        );
        const cellWidth = chooseAtlasCellPixelSize(innerWidth, atlas.padding);
        const cellHeight = chooseAtlasCellPixelSize(innerHeight, atlas.padding);
        const canvasWidth = Math.max(1, atlas.columns * cellWidth);
        const canvasHeight = Math.max(1, atlas.rows * cellHeight);

        expect(atlasRegionPixelSize(cellWidth, atlas.padding)).toBe(innerWidth);
        expect(atlasRegionPixelSize(cellHeight, atlas.padding)).toBe(innerHeight);

        metrics.forEach((metric, islandIndex) => {
          const region = atlasPixelRegion(
            atlas,
            islandIndex,
            canvasWidth,
            canvasHeight
          );
          const regionWidth = Math.max(1, region.maxX - region.minX + 1);
          const regionHeight = Math.max(1, region.maxY - region.minY + 1);
          const sourceWidth = Math.max(EPSILON, metric.coverageU * metric.width);
          const sourceHeight = Math.max(EPSILON, metric.coverageV * metric.height);
          const sourceStartX = (1 - metric.coverageU) * metric.width * 0.5;
          const bottomAnchored = /^(Vorne|Hinten|Links|Rechts|Mantel|Rundung|Schräge)(?:\s+\d+)?$/u
            .test(metric.label);
          const sourceStartY = bottomAnchored
            ? metric.height - sourceHeight
            : (metric.height - sourceHeight) * 0.5;

          expect(regionWidth).toBe(innerWidth);
          expect(regionHeight).toBe(innerHeight);
          expect(regionWidth).toBeGreaterThanOrEqual(metric.width);
          expect(regionHeight).toBeGreaterThanOrEqual(metric.height);

          expectCompleteAtlasPixelHitArea({
            atlasRegionStart: region.minX,
            atlasRegionPixels: regionWidth,
            canvasPixels: canvasWidth,
            sourceStart: sourceStartX,
            sourcePixels: sourceWidth,
            sourceLimit: metric.width
          });
          expectCompleteAtlasPixelHitArea({
            atlasRegionStart: region.minY,
            atlasRegionPixels: regionHeight,
            canvasPixels: canvasHeight,
            sourceStart: sourceStartY,
            sourcePixels: sourceHeight,
            sourceLimit: metric.height
          });
        });
      } finally {
        geometry.dispose();
      }
    }
  );
});
