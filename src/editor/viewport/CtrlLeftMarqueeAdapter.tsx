import { useEffect, useRef } from 'react';

interface ActiveMarquee {
  pointerId: number;
  viewport: HTMLElement;
}

const dispatchMarqueePointerEvent = (
  viewport: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  source: PointerEvent
) => {
  viewport.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: source.pointerId,
    pointerType: source.pointerType,
    isPrimary: source.isPrimary,
    clientX: source.clientX,
    clientY: source.clientY,
    screenX: source.screenX,
    screenY: source.screenY,
    ctrlKey: true,
    shiftKey: source.shiftKey,
    altKey: source.altKey,
    metaKey: source.metaKey,
    button: 2,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 2,
    width: source.width,
    height: source.height,
    pressure: source.pressure
  }));
};

export function CtrlLeftMarqueeAdapter() {
  const activeMarquee = useRef<ActiveMarquee | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isTrusted) return;

      const target = event.target instanceof Element ? event.target : null;
      const viewport = target?.closest<HTMLElement>('.viewport');
      if (!viewport) return;

      // Ein echter Strg-Rechtsklick darf nie den Auswahlrahmen starten.
      if (event.button === 2 && event.ctrlKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.button !== 0 || !event.ctrlKey) return;

      activeMarquee.current = { pointerId: event.pointerId, viewport };
      dispatchMarqueePointerEvent(viewport, 'pointerdown', event);

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      const active = activeMarquee.current;
      if (!active || active.pointerId !== event.pointerId) return;

      dispatchMarqueePointerEvent(active.viewport, 'pointermove', event);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const finishActiveMarquee = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      const active = activeMarquee.current;
      if (!active || active.pointerId !== event.pointerId) return;

      dispatchMarqueePointerEvent(
        active.viewport,
        event.type === 'pointercancel' ? 'pointercancel' : 'pointerup',
        event
      );
      activeMarquee.current = null;

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const cancelActiveMarquee = () => {
      activeMarquee.current = null;
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finishActiveMarquee, true);
    window.addEventListener('pointercancel', finishActiveMarquee, true);
    window.addEventListener('blur', cancelActiveMarquee);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finishActiveMarquee, true);
      window.removeEventListener('pointercancel', finishActiveMarquee, true);
      window.removeEventListener('blur', cancelActiveMarquee);
    };
  }, []);

  return null;
}
