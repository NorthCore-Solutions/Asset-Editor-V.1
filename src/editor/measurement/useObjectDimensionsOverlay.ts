import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObjectData, Vec3 } from '../../types/editor';
import { useDimensionOverlayVisible } from './dimensionOverlaySession';

const DIMENSION_COLOR = '#00E5FF';
const LABEL_BACKGROUND = 'rgba(3, 20, 27, 0.9)';
const LABEL_FONT = '600 38px Inter, system-ui, sans-serif';
const REFERENCE_LABEL_WIDTH = 256;
const REFERENCE_LABEL_HEIGHT = 96;

export interface ObjectDimensionLayout {
  min: THREE.Vector3;
  max: THREE.Vector3;
  length: number;
  height: number;
  depth: number;
  offset: number;
  labelLift: number;
  labelWidth: number;
  labelHeight: number;
  dashSize: number;
  gapSize: number;
}

interface DimensionEntry {
  value: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  label: THREE.Vector3;
}

function scaledRange(minimum: number, maximum: number, scale: number): [number, number] {
  const first = minimum * scale;
  const second = maximum * scale;
  return first <= second ? [first, second] : [second, first];
}

export function calculateObjectDimensionLayout(
  geometry: THREE.BufferGeometry,
  scale: Vec3
): ObjectDimensionLayout {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone()
    ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const [minX, maxX] = scaledRange(bounds.min.x, bounds.max.x, scale[0]);
  const [minY, maxY] = scaledRange(bounds.min.y, bounds.max.y, scale[1]);
  const [minZ, maxZ] = scaledRange(bounds.min.z, bounds.max.z, scale[2]);
  const length = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  const depth = Math.max(0, maxZ - minZ);
  const maximumDimension = Math.max(length, height, depth, 0.1);

  return {
    min: new THREE.Vector3(minX, minY, minZ),
    max: new THREE.Vector3(maxX, maxY, maxZ),
    length,
    height,
    depth,
    offset: Math.max(0.12, maximumDimension * 0.08),
    labelLift: Math.max(0.055, maximumDimension * 0.025),
    labelWidth: THREE.MathUtils.clamp(maximumDimension * 0.3, 0.34, 1.5),
    labelHeight: THREE.MathUtils.clamp(maximumDimension * 0.1, 0.12, 0.5),
    dashSize: THREE.MathUtils.clamp(maximumDimension * 0.025, 0.035, 0.2),
    gapSize: THREE.MathUtils.clamp(maximumDimension * 0.018, 0.025, 0.14)
  };
}

function formatDimension(value: number): string {
  const rounded = Number(value.toFixed(3));
  return Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded);
}

function drawRoundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function createDimensionLabel(
  text: string,
  position: THREE.Vector3,
  width: number,
  height: number
): { sprite: THREE.Sprite; dispose: () => void } {
  const canvas = document.createElement('canvas');
  const measuringContext = canvas.getContext('2d');
  if (!measuringContext) throw new Error('2D-Kontext für Maßbeschriftung nicht verfügbar.');

  measuringContext.font = LABEL_FONT;
  const textWidth = Math.ceil(measuringContext.measureText(text).width);
  canvas.width = Math.max(72, textWidth + 32);
  canvas.height = 64;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D-Kontext für Maßbeschriftung nicht verfügbar.');

  context.clearRect(0, 0, canvas.width, canvas.height);
  drawRoundedRectangle(context, 1, 1, canvas.width - 2, canvas.height - 2, 10);
  context.fillStyle = LABEL_BACKGROUND;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = DIMENSION_COLOR;
  context.stroke();
  context.fillStyle = '#C9FBFF';
  context.font = LABEL_FONT;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width * 0.5, canvas.height * 0.51);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  material.toneMapped = false;

  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(
    width * (canvas.width / REFERENCE_LABEL_WIDTH),
    height * (canvas.height / REFERENCE_LABEL_HEIGHT),
    1
  );
  sprite.renderOrder = 2001;
  sprite.frustumCulled = false;
  sprite.raycast = () => undefined;

  return {
    sprite,
    dispose: () => {
      material.dispose();
      texture.dispose();
    }
  };
}

function createDashedDimensionLine(
  start: THREE.Vector3,
  end: THREE.Vector3,
  dashSize: number,
  gapSize: number
): { line: THREE.Line; dispose: () => void } {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineDashedMaterial({
    color: DIMENSION_COLOR,
    transparent: true,
    opacity: 0.98,
    dashSize,
    gapSize,
    depthTest: false,
    depthWrite: false
  });
  material.toneMapped = false;

  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  line.renderOrder = 2000;
  line.frustumCulled = false;
  line.raycast = () => undefined;

  return {
    line,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
}

function dimensionEntries(layout: ObjectDimensionLayout): DimensionEntry[] {
  const { min, max, offset, labelLift } = layout;
  const centerX = (min.x + max.x) * 0.5;
  const centerY = (min.y + max.y) * 0.5;
  const centerZ = (min.z + max.z) * 0.5;

  return [
    {
      value: layout.length,
      start: new THREE.Vector3(min.x, max.y + offset, max.z + offset),
      end: new THREE.Vector3(max.x, max.y + offset, max.z + offset),
      label: new THREE.Vector3(centerX, max.y + offset + labelLift, max.z + offset)
    },
    {
      value: layout.height,
      start: new THREE.Vector3(max.x + offset, min.y, max.z + offset),
      end: new THREE.Vector3(max.x + offset, max.y, max.z + offset),
      label: new THREE.Vector3(max.x + offset + labelLift, centerY, max.z + offset)
    },
    {
      value: layout.depth,
      start: new THREE.Vector3(max.x + offset, max.y + offset, min.z),
      end: new THREE.Vector3(max.x + offset, max.y + offset, max.z),
      label: new THREE.Vector3(max.x + offset, max.y + offset + labelLift, centerZ)
    }
  ];
}

export function useObjectDimensionsOverlay(
  object: SceneObjectData,
  geometry: THREE.BufferGeometry
): void {
  const scene = useThree((state) => state.scene);
  const visible = useDimensionOverlayVisible();

  useEffect(() => {
    if (!visible || !object.visible) return;

    const layout = calculateObjectDimensionLayout(geometry, object.scale);
    const group = new THREE.Group();
    const disposers: Array<() => void> = [];
    group.name = `Maße: ${object.name}`;
    group.position.set(object.position[0], object.position[1], object.position[2]);
    group.rotation.set(object.rotation[0], object.rotation[1], object.rotation[2]);
    group.renderOrder = 2000;

    dimensionEntries(layout).forEach((entry) => {
      const line = createDashedDimensionLine(
        entry.start,
        entry.end,
        layout.dashSize,
        layout.gapSize
      );
      const label = createDimensionLabel(
        formatDimension(entry.value),
        entry.label,
        layout.labelWidth,
        layout.labelHeight
      );
      group.add(line.line, label.sprite);
      disposers.push(line.dispose, label.dispose);
    });

    scene.add(group);
    return () => {
      scene.remove(group);
      disposers.forEach((dispose) => dispose());
      group.clear();
    };
  }, [
    geometry,
    object.name,
    object.position[0],
    object.position[1],
    object.position[2],
    object.rotation[0],
    object.rotation[1],
    object.rotation[2],
    object.scale[0],
    object.scale[1],
    object.scale[2],
    object.visible,
    scene,
    visible
  ]);
}
