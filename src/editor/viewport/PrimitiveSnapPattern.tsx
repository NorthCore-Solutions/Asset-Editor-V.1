import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneObjectData } from '../../types/editor';

const vertexShader = `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uCellSize;
  uniform float uOpacity;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  float gridLine(float value) {
    float fraction = fract(value);
    float distanceToLine = min(fraction, 1.0 - fraction);
    return 1.0 - smoothstep(0.025, 0.075, distanceToLine);
  }

  void main() {
    vec3 coordinates = vWorldPosition / max(uCellSize, 0.05);
    vec3 normalWeight = pow(abs(normalize(vWorldNormal)), vec3(8.0));
    normalWeight /= max(normalWeight.x + normalWeight.y + normalWeight.z, 0.0001);

    float onXFace = max(gridLine(coordinates.y), gridLine(coordinates.z));
    float onYFace = max(gridLine(coordinates.x), gridLine(coordinates.z));
    float onZFace = max(gridLine(coordinates.x), gridLine(coordinates.y));
    float pattern = dot(vec3(onXFace, onYFace, onZFace), normalWeight);
    float alpha = pattern * uOpacity;

    if (alpha < 0.02) discard;
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
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#EFFF00') },
    uCellSize: { value: Math.max(0.05, Math.abs(cellSize)) },
    uOpacity: { value: highlighted ? 0.98 : 0.52 }
  }), [cellSize, highlighted]);

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
