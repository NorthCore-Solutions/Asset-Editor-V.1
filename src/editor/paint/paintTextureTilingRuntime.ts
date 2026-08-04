import * as THREE from 'three';
import type { SurfaceUvAtlas, SurfaceUvIsland } from '../../geometry/uvAtlas';
import type { SurfaceRasterMetric } from './surfacePaintGrid';
import { surfaceUvWindow } from './surfacePaintGrid';

interface PaintTextureGridData {
  signature: string;
  islands: SurfaceUvIsland[];
  windows: THREE.Vector4[];
}

type PatchedMaterialPrototype = THREE.MeshStandardMaterial & {
  __northcorePaintGridInstalled?: boolean;
};

type ShaderParameters = Parameters<THREE.Material['onBeforeCompile']>[0];
type ShaderRenderer = Parameters<THREE.Material['onBeforeCompile']>[1];

const DATA_KEY = 'northcorePaintGrid';

function uniformName(index: number): string {
  return `ncPaintWindow${index}`;
}

function glslFloat(value: number): string {
  const formatted = Number(value.toFixed(8)).toString();
  return formatted.includes('.') ? formatted : `${formatted}.0`;
}

function isPaintTextureGridData(value: unknown): value is PaintTextureGridData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.signature === 'string'
    && Array.isArray(candidate.islands)
    && Array.isArray(candidate.windows);
}

function textureGridData(texture: THREE.Texture | null): PaintTextureGridData | undefined {
  const value: unknown = texture?.userData[DATA_KEY];
  return isPaintTextureGridData(value) ? value : undefined;
}

function gridData(material: THREE.MeshStandardMaterial): PaintTextureGridData | undefined {
  return textureGridData(material.map);
}

function shaderBranches(data: PaintTextureGridData): string {
  return data.islands.map((island, index) => {
    const prefix = index === 0 ? 'if' : 'else if';
    const width = island.uMax - island.uMin;
    const height = island.vMax - island.vMin;

    return `${prefix} (
      ncPaintUv.x >= ${glslFloat(island.uMin)}
      && ncPaintUv.x <= ${glslFloat(island.uMax)}
      && ncPaintUv.y >= ${glslFloat(island.vMin)}
      && ncPaintUv.y <= ${glslFloat(island.vMax)}
    ) {
      vec2 ncIslandMin = vec2(${glslFloat(island.uMin)}, ${glslFloat(island.vMin)});
      vec2 ncIslandSize = vec2(${glslFloat(width)}, ${glslFloat(height)});
      vec2 ncLocalUv = clamp((ncPaintUv - ncIslandMin) / ncIslandSize, vec2(0.0), vec2(0.999999));
      vec4 ncWindow = ${uniformName(index)};
      ncLocalUv = ncWindow.xy + ncLocalUv * ncWindow.zw;
      ncPaintUv = ncIslandMin + ncLocalUv * ncIslandSize;
    }`;
  }).join('\n');
}

const prototype = THREE.MeshStandardMaterial.prototype as PatchedMaterialPrototype;

if (!prototype.__northcorePaintGridInstalled) {
  prototype.onBeforeCompile = function onBeforeCompileWithPaintGrid(
    this: THREE.MeshStandardMaterial,
    shader: ShaderParameters,
    renderer: ShaderRenderer
  ): void {
    void renderer;
    const data = gridData(this);
    if (!data) return;

    const declarations = data.islands
      .map((_, index) => `uniform vec4 ${uniformName(index)};`)
      .join('\n');

    data.windows.forEach((window, index) => {
      shader.uniforms[uniformName(index)] = { value: window };
    });

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>\n${declarations}`
      )
      .replace(
        '#include <map_fragment>',
        `
#ifdef USE_MAP
  vec2 ncPaintUv = vMapUv;
  ${shaderBranches(data)}
  vec4 sampledDiffuseColor = texture2D(map, ncPaintUv);
  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif`
      );
  };

  prototype.customProgramCacheKey = function paintGridProgramCacheKey(
    this: THREE.MeshStandardMaterial
  ): string {
    const originalKey = THREE.Material.prototype.customProgramCacheKey.call(this);
    const data = gridData(this);
    return data ? `${originalKey}|northcore-paint-grid:${data.signature}` : originalKey;
  };

  prototype.__northcorePaintGridInstalled = true;
}

export function configurePaintTextureGrid(
  texture: THREE.Texture,
  atlas: SurfaceUvAtlas,
  metrics: SurfaceRasterMetric[]
): void {
  const existing = textureGridData(texture);

  if (
    existing
    && existing.signature === atlas.signature
    && existing.windows.length === atlas.islands.length
  ) {
    existing.windows.forEach((window, index) => {
      const metric = metrics[index];
      const next = metric
        ? surfaceUvWindow(metric)
        : { offsetU: 0, offsetV: 0, scaleU: 1, scaleV: 1 };
      window.set(next.offsetU, next.offsetV, next.scaleU, next.scaleV);
    });
    return;
  }

  texture.userData[DATA_KEY] = {
    signature: atlas.signature,
    islands: atlas.islands.map((island) => ({ ...island })),
    windows: atlas.islands.map((_, index) => {
      const metric = metrics[index];
      const window = metric
        ? surfaceUvWindow(metric)
        : { offsetU: 0, offsetV: 0, scaleU: 1, scaleV: 1 };
      return new THREE.Vector4(window.offsetU, window.offsetV, window.scaleU, window.scaleV);
    })
  };
}
