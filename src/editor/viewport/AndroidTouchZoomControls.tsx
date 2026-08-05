import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { calculatePinchZoomStep } from './androidPinchZoomMath';

interface OrbitControlApi {
  target: THREE.Vector3;
  update: () => void;
}

interface PointerPosition {
  x: number;
  y: number;
}

const pointerDistance = (first: PointerPosition, second: PointerPosition): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

export function AndroidTouchZoomControls({ active }: { active: boolean }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;
  const objects = useEditorStore((state) => state.objects);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const focusRef = useRef<THREE.Vector3 | null>(null);

  const selectedFocus = useMemo(() => {
    const selected = objects.filter((object) => selectedIds.includes(object.id) && object.visible);
    if (selected.length === 0) return null;

    return selected
      .reduce((sum, object) => sum.add(new THREE.Vector3(...object.position)), new THREE.Vector3())
      .divideScalar(selected.length);
  }, [objects, selectedIds]);

  useEffect(() => {
    focusRef.current = selectedFocus;
  }, [selectedFocus]);

  useEffect(() => {
    if (!active || !controls) return;

    const pointers = new Map<number, PointerPosition>();
    let previousDistance: number | null = null;
    let gestureFocus: THREE.Vector3 | null = null;

    const resetGesture = () => {
      previousDistance = null;
      gestureFocus = null;
    };

    const prepareGesture = () => {
      if (pointers.size !== 2) {
        resetGesture();
        return;
      }

      const [first, second] = [...pointers.values()];
      if (!first || !second) return;
      previousDistance = pointerDistance(first, second);
      gestureFocus = focusRef.current?.clone() ?? controls.target.clone();
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
      if (!previousDistance || !gestureFocus || currentDistance < 2) {
        previousDistance = currentDistance;
        gestureFocus = focusRef.current?.clone() ?? controls.target.clone();
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
      const focusDepth = gestureFocus.clone().sub(camera.position).dot(forward);
      const step = calculatePinchZoomStep(
        focusDepth,
        previousDistance,
        currentDistance,
        pointerRay.dot(forward),
        Math.max(0.1, 'near' in camera && typeof camera.near === 'number' ? camera.near * 2 : 0.1),
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
