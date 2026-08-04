import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ViewportHelp() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHost(document.querySelector<HTMLElement>('.viewport'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !rootRef.current?.contains(target)) setOpen(false);
    };

    window.addEventListener('pointerdown', closeOutside, true);
    return () => window.removeEventListener('pointerdown', closeOutside, true);
  }, [open]);

  if (!host) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="viewport-help"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {open && (
        <div className="viewport-help-popover" role="status">
          Strg + Linksklick-Ziehen: Auswahlrahmen · Shift + Linksklick: Mehrfachauswahl · Strg + G: gruppieren
        </div>
      )}
      <button
        type="button"
        className="viewport-help-button"
        aria-label="Bedienungshinweise"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
    </div>,
    host
  );
}
