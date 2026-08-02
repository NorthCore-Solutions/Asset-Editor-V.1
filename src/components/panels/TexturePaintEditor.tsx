import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PaintTextureData } from '../../types/editor';
import {
  DEFAULT_PAINT_SIZE,
  createFilledImageData,
  floodFill,
  hexToRgba,
  paintBrush,
  rgbaToHex,
  samplePixel,
  type PaintTool
} from '../../editor/paint/pixelPaint';
import {
  setSurfacePaintSettings,
  subscribeSurfacePaint
} from '../../editor/paint/surfacePaintSession';

interface TexturePaintEditorProps {
  objectId: string;
  baseColor: string;
  texture?: PaintTextureData;
  palette: string[];
  onCommit: (texture: PaintTextureData | undefined) => void;
}

const TOOLS: Array<{ tool: PaintTool; label: string }> = [
  { tool: 'brush', label: 'Pinsel' },
  { tool: 'eraser', label: 'Radierer' },
  { tool: 'fill', label: 'Füllen' },
  { tool: 'eyedropper', label: 'Pipette' }
];

const cloneImage = (image: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const bounds = canvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(canvas.width - 1, Math.floor((clientX - bounds.left) / bounds.width * canvas.width))),
    Math.max(0, Math.min(canvas.height - 1, Math.floor((clientY - bounds.top) / bounds.height * canvas.height)))
  ];
}

function linePoints(from: [number, number], to: [number, number]): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let [x0, y0] = from;
  const [x1, y1] = to;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x0 += sx; }
    if (doubled <= dx) { error += dx; y0 += sy; }
  }

  return points;
}

export function TexturePaintEditor({ objectId, baseColor, texture, palette, onCommit }: TexturePaintEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<[number, number] | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const futureRef = useRef<ImageData[]>([]);
  const loadedKeyRef = useRef('');
  const [tool, setTool] = useState<PaintTool>('brush');
  const [paintColor, setPaintColor] = useState(baseColor);
  const [brushSize, setBrushSize] = useState(1);
  const [surfaceEnabled, setSurfaceEnabled] = useState(false);
  const [, refreshControls] = useState(0);

  useEffect(() => subscribeSurfacePaint((settings) => {
    setSurfaceEnabled(settings.enabled);
    setTool(settings.tool);
    setPaintColor(settings.color);
    setBrushSize(settings.brushSize);
  }), []);

  useEffect(() => () => setSurfacePaintSettings({ enabled: false }), []);

  const changeTool = (nextTool: PaintTool): void => {
    setTool(nextTool);
    setSurfacePaintSettings({ tool: nextTool });
  };

  const changeColor = (nextColor: string): void => {
    const normalized = nextColor.toUpperCase();
    setPaintColor(normalized);
    setSurfacePaintSettings({ color: normalized });
  };

  const changeBrushSize = (nextSize: number): void => {
    setBrushSize(nextSize);
    setSurfacePaintSettings({ brushSize: nextSize });
  };

  const readCanvas = (): ImageData | null => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    return canvas && context ? context.getImageData(0, 0, canvas.width, canvas.height) : null;
  };

  const writeCanvas = (image: ImageData): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    context.putImageData(image, 0, 0);
  };

  const commitCanvas = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    loadedKeyRef.current = `${objectId}:${dataUrl}`;
    onCommit({ dataUrl, width: canvas.width, height: canvas.height, pixelated: true });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;

    const key = `${objectId}:${texture?.dataUrl ?? baseColor}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    historyRef.current = [];
    futureRef.current = [];
    refreshControls((value) => value + 1);

    if (!texture) {
      canvas.width = DEFAULT_PAINT_SIZE;
      canvas.height = DEFAULT_PAINT_SIZE;
      context.putImageData(createFilledImageData(canvas.width, canvas.height, hexToRgba(baseColor)), 0, 0);
      changeColor(baseColor);
      return;
    }

    const image = new Image();
    image.onload = () => {
      canvas.width = texture.width;
      canvas.height = texture.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = texture.dataUrl;
  }, [baseColor, objectId, texture?.dataUrl, texture?.height, texture?.width]);

  const pushHistory = (): void => {
    const current = readCanvas();
    if (!current) return;
    historyRef.current = [...historyRef.current.slice(-29), cloneImage(current)];
    futureRef.current = [];
    refreshControls((value) => value + 1);
  };

  const applyAt = (point: [number, number], previous?: [number, number]): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);

    if (tool === 'eyedropper') {
      const sampled = samplePixel(image, point[0], point[1]);
      if (sampled.a > 0) changeColor(rgbaToHex(sampled));
      return;
    }

    if (tool === 'fill') {
      floodFill(image, point[0], point[1], hexToRgba(paintColor));
    } else {
      const color = tool === 'eraser' ? hexToRgba('#000000', 0) : hexToRgba(paintColor);
      linePoints(previous ?? point, point).forEach(([x, y]) => paintBrush(image, x, y, brushSize, color));
    }

    context.putImageData(image, 0, 0);
  };

  const startPaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);

    if (tool === 'eyedropper') {
      applyAt(point);
      return;
    }

    pushHistory();
    applyAt(point);

    if (tool === 'fill') {
      commitCanvas();
      return;
    }

    drawingRef.current = true;
    lastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continuePaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current || (tool !== 'brush' && tool !== 'eraser')) return;
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);
    applyAt(point, lastPointRef.current ?? point);
    lastPointRef.current = point;
  };

  const finishPaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commitCanvas();
  };

  const undo = (): void => {
    const previous = historyRef.current.at(-1);
    const current = readCanvas();
    if (!previous || !current) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [cloneImage(current), ...futureRef.current].slice(0, 30);
    writeCanvas(previous);
    commitCanvas();
    refreshControls((value) => value + 1);
  };

  const redo = (): void => {
    const next = futureRef.current[0];
    const current = readCanvas();
    if (!next || !current) return;
    historyRef.current = [...historyRef.current.slice(-29), cloneImage(current)];
    futureRef.current = futureRef.current.slice(1);
    writeCanvas(next);
    commitCanvas();
    refreshControls((value) => value + 1);
  };

  const clearTexture = (): void => {
    historyRef.current = [];
    futureRef.current = [];
    loadedKeyRef.current = '';
    onCommit(undefined);
    refreshControls((value) => value + 1);
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button
        type="button"
        aria-pressed={surfaceEnabled}
        onClick={() => setSurfacePaintSettings({ enabled: !surfaceEnabled })}
        style={surfaceEnabled ? { outline: '1px solid #7ed99a', background: '#24513a' } : undefined}
      >
        {surfaceEnabled ? 'Auf Form malen: aktiv' : 'Auf Form malen'}
      </button>
      {surfaceEnabled && <small>Kamera gesperrt · direkt auf die sichtbare Fläche im Hauptfenster malen</small>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            aria-pressed={tool === entry.tool}
            onClick={() => changeTool(entry.tool)}
            style={tool === entry.tool ? { outline: '1px solid #68a47d', background: '#22382d' } : undefined}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="field-row">
        <label>Mal-Farbe</label>
        <div className="color-row">
          <input type="color" value={paintColor} onChange={(event) => changeColor(event.target.value)} />
          <input value={paintColor} onChange={(event) => /^#[0-9a-fA-F]{6}$/.test(event.target.value) && changeColor(event.target.value)} />
        </div>
      </div>

      {(tool === 'brush' || tool === 'eraser') && (
        <div className="range-row">
          <label>Pinselgröße</label>
          <input type="range" min={1} max={8} step={1} value={brushSize} onChange={(event) => changeBrushSize(Number(event.target.value))} />
          <span>{brushSize}px</span>
        </div>
      )}

      <div className="palette">
        {[...new Set(palette)].slice(0, 24).map((color) => (
          <button
            key={color}
            type="button"
            className="swatch"
            title={color}
            aria-label={color}
            style={{ background: color }}
            onClick={() => changeColor(color)}
          />
        ))}
      </div>

      <div style={{
        width: '100%', maxWidth: 280, justifySelf: 'center', padding: 6,
        border: '1px solid #425159', borderRadius: 4,
        backgroundImage: 'conic-gradient(#c7c7c7 25%, #eeeeee 0 50%, #c7c7c7 0 75%, #eeeeee 0)',
        backgroundSize: '16px 16px'
      }}>
        <canvas
          ref={canvasRef}
          onPointerDown={startPaint}
          onPointerMove={continuePaint}
          onPointerUp={finishPaint}
          onPointerCancel={finishPaint}
          style={{ width: '100%', aspectRatio: '1', display: 'block', imageRendering: 'pixelated', touchAction: 'none', cursor: 'crosshair' }}
        />
      </div>

      <div className="inline-actions">
        <button type="button" disabled={historyRef.current.length === 0} onClick={undo}>Rückgängig</button>
        <button type="button" disabled={futureRef.current.length === 0} onClick={redo}>Wiederholen</button>
        <button type="button" className="danger" disabled={!texture} onClick={clearTexture}>Bemalung entfernen</button>
      </div>
      <small>32×32-Pixeltextur · 2D-Ansicht für Feinkorrekturen</small>
    </div>
  );
}
