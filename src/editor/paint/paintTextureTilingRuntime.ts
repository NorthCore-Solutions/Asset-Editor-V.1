import * as THREE from 'three';
import type { SurfaceUvAtlas, SurfaceUvIsland } from '../../geometry/uvAtlas';
import type { SurfaceTileRepeat } from '../../geometry/surfaceTileGrid';

interface PaintTextureTilingData {
  signature: string;
  islands: SurfaceUvIsland[];
  repeats: THREE.Vector2[];
}

type PaintTexture = THREE.Texture & {
  userData: Record<string, unknown> & {
    northcorePaintTiling?: PaintTextureTilingData;
  };
};

type PatchedMaterialPrototype = THREE.MeshStandardMaterial & {
  __northcorePaintTilingInstalled?: boolean;
};

type ShaderParameters = Parameters<THREE.Material['onBeforeCompile']>[0];
type ShaderRenderer = Parameters<THREE.Material['onBeforeCompile']>[1];

const DATA_KEY = 'northcorePaintTiling';

function uniformName(index: number): string {
  return `ncPaintRepeat${index}`;
}

function glslFloat(value: number): string {
  const formatted = Number(value.toFixed(8)).toString();
  return formatted.includes('.') ? formatted : `${formatted}.0`;
}

function tilingData(material: THREE.MeshStandardMaterial): PaintTextureTilingData | undefined {
  const texture = material.map as PaintTexture | null;
  return texture?.userData[DATA_KEY] as PaintTextureTilingData | undefined;
}

function shaderBranches(data: PaintTextureTilingData): string {
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
      ncLocalUv = fract(ncLocalUv * ${uniformName(index)});
      ncPaintUv = ncIslandMin + ncLocalUv * ncIslandSize;
    }`;
  }).join('\n');
}

const prototype = THREE.MeshStandardMaterial.prototype as PatchedMaterialPrototype;

if (!prototype.__northcorePaintTilingInstalled) {
  const originalOnBeforeCompile = prototype.onBeforeCompile;
  const originalProgramCacheKey = prototype.customProgramCacheKey;

  prototype.onBeforeCompile = function onBeforeCompileWithPaintTiling(
    this: THREE.MeshStandardMaterial,
    shader: ShaderParameters,
    renderer: ShaderRenderer
  ): void {
    originalOnBeforeCompile.call(this, shader, renderer);
    const data = tilingData(this);
    if (!data) return;

    const declarations = data.islands
      .map((_, index) => `uniform vec2 ${uniformName(index)};`)
      .join('\n');

    data.repeats.forEach((repeat, index) => {
      shader.uniforms[uniformName(index)] = { value: repeat };
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

  prototype.customProgramCacheKey = function paintTilingProgramCacheKey(
    this: THREE.MeshStandardMaterial
  ): string {
    const originalKey = originalProgramCacheKey.call(this);
    const data = tilingData(this);
    return data ? `${originalKey}|northcore-paint:${data.signature}` : originalKey;
  };

  prototype.__northcorePaintTilingInstalled = true;
}

export function configurePaintTextureTiling(
  texture: THREE.Texture,
  atlas: SurfaceUvAtlas,
  repeats: SurfaceTileRepeat[]
): void {
  const paintTexture = texture as PaintTexture;
  const existing = paintTexture.userData[DATA_KEY] as PaintTextureTilingData | undefined;

  if (
    existing
    && existing.signature === atlas.signature
    && existing.repeats.length === atlas.islands.length
  ) {
    existing.repeats.forEach((repeat, index) => {
      const next = repeats[index] ?? { u: 1, v: 1 };
      repeat.set(next.u, next.v);
    });
    return;
  }

  paintTexture.userData[DATA_KEY] = {
    signature: atlas.signature,
    islands: atlas.islands.map((island) => ({ ...island })),
    repeats: atlas.islands.map((_, index) => {
      const repeat = repeats[index] ?? { u: 1, v: 1 };
      return new THREE.Vector2(repeat.u, repeat.v);
    })
  };
}
