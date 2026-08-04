import { useEffect } from 'react';
import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';
import { useObjectDimensionsOverlay } from '../measurement/useObjectDimensionsOverlay';
import { useEdgeFreePreview } from '../view/edgeFreePreviewSession';
import type { SurfacePaintSettings } from './surfacePaintSession';
import {
  useSurfacePaint as useSurfacePaintGrid,
  useSurfacePaintSettings,
  type SurfacePaintBinding
} from './useSurfacePaintGrid';

export { useSurfacePaintSettings };
export type { SurfacePaintBinding };

export function useSurfacePaint(
  object: SceneObjectData,
  selected: boolean,
  settings: SurfacePaintSettings,
  geometry: THREE.BufferGeometry
): SurfacePaintBinding {
  useObjectDimensionsOverlay(object, geometry);
  const edgeFreePreview = useEdgeFreePreview();
  const binding = useSurfacePaintGrid(object, selected, settings, geometry);

  useEffect(() => {
    const texture = binding.texture;
    if (!texture) return;

    const filter = edgeFreePreview && !settings.enabled
      ? THREE.LinearFilter
      : THREE.NearestFilter;
    if (texture.magFilter === filter && texture.minFilter === filter) return;

    texture.magFilter = filter;
    texture.minFilter = filter;
    texture.needsUpdate = true;
  }, [binding.texture, edgeFreePreview, settings.enabled]);

  return binding;
}
