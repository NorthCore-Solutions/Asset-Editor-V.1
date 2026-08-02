import { useEffect, useRef } from 'react';

export function CtrlLeftMarqueeAdapter() {
  const activePointerId = useRef<number | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.ctrlKey) return;

      const target = event.target instanceof Element ? event.target : null;
      const viewport = target?.closest<HTMLElement>('.viewport');
      if (!viewport) return;

      activePointerId.current = event.pointerId;

      const syntheticEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        ctrlKey: true,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        button: 2,
        buttons: 2,
        width: event.width,
        height: event.height,
        pressure: event.pressure
      });

      viewport.dispatchEvent(syntheticEvent);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const protectActiveMarquee = (event: PointerEvent) => {
      if (activePointerId.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const finishActiveMarquee = (event: PointerEvent) => {
      if (activePointerId.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      activePointerId.current = null;
    };

    const cancelActiveMarquee = () => {
      activePointerId.current = null;
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', protectActiveMarquee, true);
    window.addEventListener('pointerup', finishActiveMarquee, true);
    window.addEventListener('pointercancel', finishActiveMarquee, true);
    window.addEventListener('blur', cancelActiveMarquee);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', protectActiveMarquee, true);
      window.removeEventListener('pointerup', finishActiveMarquee, true);
      window.removeEventListener('pointercancel', finishActiveMarquee, true);
      window.removeEventListener('blur', cancelActiveMarquee);
    };
  }, []);

  return null;
}
