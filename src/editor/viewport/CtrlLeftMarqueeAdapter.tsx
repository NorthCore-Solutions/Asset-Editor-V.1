import { useEffect, useRef } from 'react';

export function CtrlLeftMarqueeAdapter() {
  const activePointerId = useRef<number | null>(null);
  const activeViewport = useRef<HTMLElement | null>(null);
  const suppressNextClick = useRef(false);

  useEffect(() => {
    const dispatchPointerEvent = (
      viewport: HTMLElement,
      type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
      event: PointerEvent
    ) => {
      viewport.dispatchEvent(new PointerEvent(type, {
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
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 2,
        width: event.width,
        height: event.height,
        pressure: event.pressure
      }));
    };

    const stopOriginalEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const viewport = target?.closest<HTMLElement>('.viewport');
      if (!viewport) return;

      if (event.button === 2 && event.ctrlKey && event.isTrusted) {
        stopOriginalEvent(event);
        return;
      }

      if (event.button !== 0 || !event.ctrlKey) return;

      activePointerId.current = event.pointerId;
      activeViewport.current = viewport;
      suppressNextClick.current = false;
      dispatchPointerEvent(viewport, 'pointerdown', event);
      stopOriginalEvent(event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId.current !== event.pointerId || !activeViewport.current) return;
      dispatchPointerEvent(activeViewport.current, 'pointermove', event);
      stopOriginalEvent(event);
    };

    const finishPointer = (event: PointerEvent) => {
      if (activePointerId.current !== event.pointerId || !activeViewport.current) return;
      const viewport = activeViewport.current;
      dispatchPointerEvent(viewport, event.type === 'pointercancel' ? 'pointercancel' : 'pointerup', event);
      suppressNextClick.current = true;
      activePointerId.current = null;
      activeViewport.current = viewport;
      stopOriginalEvent(event);
    };

    const suppressClick = (event: MouseEvent) => {
      if (!suppressNextClick.current || !activeViewport.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !activeViewport.current.contains(target)) return;
      suppressNextClick.current = false;
      activeViewport.current = null;
      stopOriginalEvent(event);
    };

    const cancelActiveMarquee = () => {
      activePointerId.current = null;
      activeViewport.current = null;
      suppressNextClick.current = false;
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finishPointer, true);
    window.addEventListener('pointercancel', finishPointer, true);
    window.addEventListener('click', suppressClick, true);
    window.addEventListener('blur', cancelActiveMarquee);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finishPointer, true);
      window.removeEventListener('pointercancel', finishPointer, true);
      window.removeEventListener('click', suppressClick, true);
      window.removeEventListener('blur', cancelActiveMarquee);
    };
  }, []);

  return null;
}
