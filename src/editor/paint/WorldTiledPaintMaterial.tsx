import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getSurfaceUvAtlas } from '../../geometry/uvAtlas';
import {
  getSurfaceTileRepeats,
  type SurfaceTileRepeat
} from '../../geometry/surfaceTileGrid';
import type { Vec3 } from '../../types/editor';

interface WorldTiledPaintMaterialProps {
  geometry: THREE.BufferGeometry;
  scale: Vec3;
  texture: THREE.Texture | null;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  flatShading: boolean;
}

type RepeatUniform = { value: THREE.Vector2 };
type RepeatUniformMap = Record<string, RepeatUniform>;

function glslFloat(value: number): string {
  const formatted = Number(value.toFixed(8)).toString();
  return formatted.includes('.') ? formatted : `${formatted}.0`;
}

function uniformName(index: number): string {
  return `ncPaintRepeat${index}`;
}

export function WorldTiledPaintMaterial({
  geometry,
  scale,
  texture,
  color,
  roughness,
  metalness,
  opacity,
  flatShading
}: WorldTiledPaintMaterialProps) {
  const atlas = useMemo(() => getSurfaceUvAtlas(geometry), [geometry]);
  const repeats = useMemo(
    () => getSurfaceTileRepeats(geometry, scale),
    [geometry, scale[0], scale[1], scale[2]]
  );
  const repeatsRef = useRef<SurfaceTileRepeat[]>(repeats);
  const uniformsRef = useRef<RepeatUniformMap>({});
  repeatsRef.current = repeats;

  const shaderPatch = useMemo(() => {
    const declarations = atlas.islands
      .map((_, index) => `uniform vec2 ${uniformName(index)};`)
      .join('\n');
    const branches = atlas.islands.map((island, index) => {
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
    }).join('\nelse ');

    return {
      declarations,
      mapFragment: `
#ifdef USE_MAP
  vec2 ncPaintUv = vMapUv;
  ${branches}
  vec4 sampledDiffuseColor = texture2D(map, ncPaintUv);
  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif`
    };
  }, [atlas]);

  const material = useMemo(() => {
    const nextMaterial = new THREE.MeshStandardMaterial();
    nextMaterial.onBeforeCompile = (shader) => {
      const nextUniforms: RepeatUniformMap = {};
      atlas.islands.forEach((_, index) => {
        const repeat = repeatsRef.current[index] ?? { u: 1, v: 1 };
        const uniform = { value: new THREE.Vector2(repeat.u, repeat.v) };
        nextUniforms[uniformName(index)] = uniform;
        shader.uniforms[uniformName(index)] = uniform;
      });
      uniformsRef.current = nextUniforms;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_pars_fragment>',
          `#include <map_pars_fragment>\n${shaderPatch.declarations}`
        )
        .replace('#include <map_fragment>', shaderPatch.mapFragment);
    };
    nextMaterial.customProgramCacheKey = () => `northcore-world-paint:${atlas.signature}`;
    return nextMaterial;
  }, [atlas, shaderPatch]);

  useLayoutEffect(() => {
    repeats.forEach((repeat, index) => {
      uniformsRef.current[uniformName(index)]?.value.set(repeat.u, repeat.v);
    });
  }, [repeats]);

  useLayoutEffect(() => {
    const mapModeChanged = Boolean(material.map) !== Boolean(texture);
    const flatModeChanged = material.flatShading !== flatShading;
    const transparent = opacity < 1 || Boolean(texture);
    const transparencyChanged = material.transparent !== transparent;

    material.map = texture;
    material.color.set(texture ? '#FFFFFF' : color);
    material.roughness = roughness;
    material.metalness = metalness;
    material.opacity = opacity;
    material.transparent = transparent;
    material.alphaTest = texture ? 0.001 : 0;
    material.flatShading = flatShading;
    material.emissive.set('#000000');
    material.emissiveIntensity = 0;

    if (mapModeChanged || flatModeChanged || transparencyChanged) material.needsUpdate = true;
  }, [color, flatShading, material, metalness, opacity, roughness, texture]);

  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={material} attach="material" />;
}
