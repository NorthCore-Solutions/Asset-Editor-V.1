import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { calculatePinchZoomStep } from './androidPinchZoomMath';
import {
  combineWorldBounds,
  worldBoundsFromSceneObject,
  zoomTargetFromWorldBounds
} from './zoomTargetBounds';

interface OrbitControlApi {
  target: THREE.Vector3;
  update: () => void;
}

interface PointerPosition {
  x: number;
  y: number;
}

export type AdditionalZoomBoundsResolver = (
  selectedIds: readonly string[]
) => Iterable<THREE.Box3 | null | undefined>;

interface AndroidTouchZoomControlsProps {
  active: boolean;
  resolveAdditionalBounds?: AdditionalZoomBoundsResolver;
}

const pointerDistance = (first: PointerPosition, second: PointerPosition): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

export function AndroidTouchZoomControls({
  active,
  resolveAdditionalBounds
}: AndroidTouchZoomControlsProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const objects = useEditorStore((state) => state.objects);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const boundsRef = useRef<THREE.Box3 | null>(null);

  const selectedBounds = useMemo(() => {
    const entries: Array<THREE.Box3 | null | undefined> = objects
      .filter((object) => selectedIds.includes(object.id) && object.visible)
      .map((object) => worldBoundsFromSceneObject(object));

    const additionalBounds = resolveAdditionalBounds?.(selectedIds);
    if (additionalBounds) entries.push(...additionalBounds);

    return combineWorldBounds(entries);
  }, [objects, resolveAdditionalBounds, selectedIds]);

  useEffect(() => {
    boundsRef.current = selectedBounds?.clone() ?? null;
  }, [selectedBounds]);

  useEffect(() => {
    if (!active || !controls) return;

    const pointers = new Map<number, PointerPosition>();
    let previousDistance: number | null = null;
    let gestureBounds: THREE.Box3 | null = null;

    const resetGesture = () => {
      previousDistance = null;
      gestureBounds = null;
    };

    const prepareGesture = () => {
      if (pointers.size !== 2) {
        resetGesture();
        return;
      }

      const [first, second] = [...pointers.values()];
      if (!first || !second) return;
      previousDistance = pointerDistance(first, second);
      gestureBounds = boundsRef.current?.clone() ?? null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      prepareGesture();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size !== 2) return;

      const [first, second] = [...pointers.values()];
      if (!first || !second) return;
      const currentDistance = pointerDistance(first, second);
      if (!previousDistance || currentDistance < 2) {
        previousDistance = currentDistance;
        gestureBounds = boundsRef.current?.clone() ?? null;
        return;
      }

      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const midpointX = (first.x + second.x) * 0.5;
      const midpointY = (first.y + second.y) * 0.5;
      const pointerRay = new THREE.Vector3(
        ((midpointX - rect.left) / rect.width) * 2 - 1,
        -((midpointY - rect.top) / rect.height) * 2 + 1,
        0.5
      ).unproject(camera).sub(camera.position).normalize();
      const forward = camera.getWorldDirection(new THREE.Vector3()).normalize();
      const cameraNear = 'near' in camera && typeof camera.near === 'number' ? camera.near : 0.05;
      const zoomTarget = gestureBounds
        ? zoomTargetFromWorldBounds(gestureBounds, forward, cameraNear)
        : {
            focus: controls.target.clone(),
            minimumDepth: Math.max(0.1, cameraNear * 2)
          };
      const focusDepth = zoomTarget.focus.clone().sub(camera.position).dot(forward);
      const step = calculatePinchZoomStep(
        focusDepth,
        previousDistance,
        currentDistance,
        pointerRay.dot(forward),
        zoomTarget.minimumDepth,
        500
      );

      previousDistance = currentDistance;
      if (Math.abs(step.movement) < 0.000001) return;

      event.preventDefault();
      camera.position.addScaledVector(pointerRay, step.movement);
      controls.target.copy(camera.position).addScaledVector(forward, step.nextDepth);
      camera.updateMatrixWorld(true);
      controls.update();
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      pointers.delete(event.pointerId);
      prepareGesture();
    };

    const element = gl.domElement;
    const ownerDocument = element.ownerDocument;
    element.addEventListener('pointerdown', handlePointerDown, { passive: true });
    ownerDocument.addEventListener('pointermove', handlePointerMove, { passive: false, capture: true });
    ownerDocument.addEventListener('pointerup', handlePointerEnd, { passive: true, capture: true });
    ownerDocument.addEventListener('pointercancel', handlePointerEnd, { passive: true, capture: true });

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      ownerDocument.removeEventListener('pointermove', handlePointerMove, true);
      ownerDocument.removeEventListener('pointerup', handlePointerEnd, true);
      ownerDocument.removeEventListener('pointercancel', handlePointerEnd, true);
      pointers.clear();
    };
  }, [active, camera, controls, gl]);

  return null;
}
