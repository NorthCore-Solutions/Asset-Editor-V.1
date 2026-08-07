import { useEffect, useMemo } from 'react';
import type { SceneObjectData } from '../../types/editor';
import { surfaceSnapTargetFromSceneObjects } from '../snapping/objectSurfaceSnap';
import {
  createSurfaceSnapPointsGeometry,
  transformSurfaceSnapAnchors
} from '../snapping/surfaceSnapTopology';

interface CompositeSnapPatternProps {
  objects: readonly SceneObjectData[];
  highlighted: boolean;
}

export function CompositeSnapPattern({ objects, highlighted }: CompositeSnapPatternProps) {
  const target = useMemo(
    () => surfaceSnapTargetFromSceneObjects(objects, 'selected-composite'),
    [objects]
  );
  const pointsGeometry = useMemo(() => {
    const anchors = target
      ? transformSurfaceSnapAnchors(target.anchors, target.matrixWorld)
      : [];
    return createSurfaceSnapPointsGeometry(anchors);
  }, [target]);

  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);

  if (!target) return null;
  return (
    <points geometry={pointsGeometry} renderOrder={903} raycast={() => undefined}>
      <pointsMaterial
        color="#EFFF00"
        size={highlighted ? 0.045 : 0.034}
        sizeAttenuation
        transparent
        opacity={highlighted ? 0.98 : 0.74}
        depthTest
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}
