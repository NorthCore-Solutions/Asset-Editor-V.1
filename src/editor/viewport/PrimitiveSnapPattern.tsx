import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';

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
  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.clone()
      ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  }, [geometry]);

  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#EFFF00') },
    uBoundsMin: { value: bounds.min.clone() },
    uBoundsMax: { value: bounds.max.clone() },
    uObjectScale: {
      value: new THREE.Vector3(
        Math.max(0.0001, Math.abs(object.scale[0])),
        Math.max(0.0001, Math.abs(object.scale[1])),
        Math.max(0.0001, Math.abs(object.scale[2]))
      )
    },
    uCellSize: { value: Math.max(0.05, Math.abs(cellSize)) },
    uOpacity: { value: highlighted ? 0.76 : 0.32 }
  }), [bounds, cellSize, highlighted, object.scale]);

  return (
    <mesh
      geometry={geometry}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      visible={object.visible}
      renderOrder={900}
      raycast={() => undefined}
    >
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
  );
}
