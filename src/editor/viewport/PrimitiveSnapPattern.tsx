import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';
import {
  buildGeometrySurfaceSnapAnchors,
  createSurfaceSnapPointsGeometry
} from '../snapping/surfaceSnapTopology';

const vertexShader = `
  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vLocalPosition = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uBoundsMin;
  uniform vec3 uBoundsMax;
  uniform vec3 uObjectScale;
  uniform float uCellSize;
  uniform float uOpacity;

  varying vec3 vLocalPosition;
  varying vec3 vWorldNormal;

  float gridLine(float value) {
    float fraction = fract(value);
    float distanceToLine = min(fraction, 1.0 - fraction);
    return 1.0 - smoothstep(0.006, 0.022, distanceToLine);
  }

  float edgeLine(float value, float extent) {
    float distanceToEdge = min(abs(value), abs(extent - value));
    return 1.0 - smoothstep(0.006, 0.022, distanceToEdge);
  }

  void main() {
    float safeCellSize = max(uCellSize, 0.05);
    vec3 coordinates = ((vLocalPosition - uBoundsMin) * uObjectScale) / safeCellSize;
    vec3 extents = ((uBoundsMax - uBoundsMin) * uObjectScale) / safeCellSize;
    vec3 axisLines = max(
      vec3(gridLine(coordinates.x), gridLine(coordinates.y), gridLine(coordinates.z)),
      vec3(
        edgeLine(coordinates.x, extents.x),
        edgeLine(coordinates.y, extents.y),
        edgeLine(coordinates.z, extents.z)
      )
    );

    vec3 normalWeight = pow(abs(normalize(vWorldNormal)), vec3(8.0));
    normalWeight /= max(normalWeight.x + normalWeight.y + normalWeight.z, 0.0001);

    float onXFace = max(axisLines.y, axisLines.z);
    float onYFace = max(axisLines.x, axisLines.z);
    float onZFace = max(axisLines.x, axisLines.y);
    float pattern = dot(vec3(onXFace, onYFace, onZFace), normalWeight);
    float alpha = pattern * uOpacity;

    if (alpha < 0.012) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

interface PrimitiveSnapPatternProps {
  geometry: THREE.BufferGeometry;
  object: SceneObjectData;
  cellSize: number;
  highlighted: boolean;
}

export function PrimitiveSnapPattern({ geometry, object, cellSize, highlighted }: PrimitiveSnapPatternProps) {
  const scaleX = object.scale[0];
  const scaleY = object.scale[1];
  const scaleZ = object.scale[2];
  const objectScale = useMemo(
    () => new THREE.Vector3(scaleX, scaleY, scaleZ),
    [scaleX, scaleY, scaleZ]
  );
  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.clone()
      ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  }, [geometry]);
  const anchors = useMemo(
    () => buildGeometrySurfaceSnapAnchors(geometry, cellSize, objectScale),
    [cellSize, geometry, objectScale]
  );
  const pointsGeometry = useMemo(
    () => createSurfaceSnapPointsGeometry(anchors),
    [anchors]
  );

  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);

  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#EFFF00') },
    uBoundsMin: { value: bounds.min.clone() },
    uBoundsMax: { value: bounds.max.clone() },
    uObjectScale: {
      value: new THREE.Vector3(
        Math.max(0.0001, Math.abs(scaleX)),
        Math.max(0.0001, Math.abs(scaleY)),
        Math.max(0.0001, Math.abs(scaleZ))
      )
    },
    uCellSize: { value: Math.max(0.05, Math.abs(cellSize)) },
    uOpacity: { value: highlighted ? 0.46 : 0.16 }
  }), [bounds, cellSize, highlighted, scaleX, scaleY, scaleZ]);
  const pointSize = Math.min(0.075, Math.max(0.025, Math.abs(cellSize) * 0.12));

  return (
    <group
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      visible={object.visible}
    >
      <mesh geometry={geometry} renderOrder={900} raycast={() => undefined}>
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthTest
          depthWrite={false}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      <points geometry={pointsGeometry} renderOrder={901} raycast={() => undefined}>
        <pointsMaterial
          color="#EFFF00"
          size={highlighted ? pointSize * 1.35 : pointSize}
          sizeAttenuation
          transparent
          opacity={highlighted ? 0.96 : 0.62}
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
