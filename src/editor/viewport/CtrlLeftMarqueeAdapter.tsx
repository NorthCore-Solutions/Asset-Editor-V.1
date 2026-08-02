import { useEffect } from 'react';

export function CtrlLeftMarqueeAdapter() {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.ctrlKey) return;

      const target = event.target instanceof Element ? event.target : null;
      const viewport = target?.closest<HTMLElement>('.viewport');
      if (!viewport) return;

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

    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);

  return null;
}
