import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PaintTextureData } from '../../types/editor';
import { atlasPixelRegion, type SurfaceUvAtlas } from '../../geometry/uvAtlas';
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
import './texture-paint-editor.css';

interface TexturePaintEditorProps {
  objectId: string;
  baseColor: string;
  texture?: PaintTextureData;
  atlas: SurfaceUvAtlas;
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

export function TexturePaintEditor({ objectId, baseColor, texture, atlas, onCommit }: TexturePaintEditorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const atlasCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<[number, number] | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const futureRef = useRef<ImageData[]>([]);
  const loadedKeyRef = useRef('');
  const [tool, setTool] = useState<PaintTool>('brush');
  const [paintColor, setPaintColor] = useState(baseColor);
  const [brushSize, setBrushSize] = useState(1);
  const [surfaceEnabled, setSurfaceEnabled] = useState(false);
  const [selectedIsland, setSelectedIsland] = useState(0);
  const [, refreshControls] = useState(0);

  const ensureAtlasCanvas = (): HTMLCanvasElement => {
    if (!atlasCanvasRef.current) atlasCanvasRef.current = document.createElement('canvas');
    return atlasCanvasRef.current;
  };

  const atlasContext = (): CanvasRenderingContext2D | null =>
    ensureAtlasCanvas().getContext('2d', { willReadFrequently: true });

  const renderSelectedSurface = (islandIndex = selectedIsland): void => {
    const atlasCanvas = atlasCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const previewContext = previewCanvas?.getContext('2d', { willReadFrequently: true });
    if (!atlasCanvas || !previewCanvas || !previewContext || atlasCanvas.width <= 0 || atlasCanvas.height <= 0) return;

    const region = atlasPixelRegion(atlas, islandIndex, atlasCanvas.width, atlasCanvas.height);
    const width = Math.max(1, region.maxX - region.minX + 1);
    const height = Math.max(1, region.maxY - region.minY + 1);
    previewCanvas.width = width;
    previewCanvas.height = height;
    previewContext.imageSmoothingEnabled = false;
    previewContext.clearRect(0, 0, width, height);
    previewContext.drawImage(atlasCanvas, region.minX, region.minY, width, height, 0, 0, width, height);
  };

  const syncPreviewToAtlas = (islandIndex = selectedIsland): void => {
    const atlasCanvas = atlasCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const context = atlasContext();
    if (!atlasCanvas || !previewCanvas || !context || previewCanvas.width <= 0 || previewCanvas.height <= 0) return;

    const region = atlasPixelRegion(atlas, islandIndex, atlasCanvas.width, atlasCanvas.height);
    const width = Math.max(1, region.maxX - region.minX + 1);
    const height = Math.max(1, region.maxY - region.minY + 1);
    context.imageSmoothingEnabled = false;
    context.clearRect(region.minX, region.minY, width, height);
    context.drawImage(previewCanvas, 0, 0, previewCanvas.width, previewCanvas.height, region.minX, region.minY, width, height);
  };

  const readAtlas = (): ImageData | null => {
    const canvas = atlasCanvasRef.current;
    const context = atlasContext();
    return canvas && context && canvas.width > 0 && canvas.height > 0
      ? context.getImageData(0, 0, canvas.width, canvas.height)
      : null;
  };

  const writeAtlas = (image: ImageData): void => {
    const canvas = ensureAtlasCanvas();
    const context = atlasContext();
    if (!context) return;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    context.putImageData(image, 0, 0);
    renderSelectedSurface();
  };

  const commitAtlas = (): void => {
    const canvas = atlasCanvasRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    const dataUrl = canvas.toDataURL('image/png');
    loadedKeyRef.current = `${objectId}:${dataUrl}`;
    onCommit({ dataUrl, width: canvas.width, height: canvas.height, pixelated: true });
  };

  const pushHistory = (): void => {
    const current = readAtlas();
    if (!current) return;
    historyRef.current = [...historyRef.current.slice(-29), cloneImage(current)];
    futureRef.current = [];
    refreshControls((value) => value + 1);
  };

  useEffect(() => subscribeSurfacePaint((settings) => {
    setSurfaceEnabled(settings.enabled);
    setTool(settings.tool);
    setPaintColor(settings.color);
    setBrushSize(settings.brushSize);
    setSelectedIsland(Math.min(settings.islandIndex, Math.max(0, atlas.islands.length - 1)));
  }), [atlas.islands.length]);

  useEffect(() => () => setSurfacePaintSettings({ enabled: false }), []);

  useEffect(() => {
    const clamped = Math.min(selectedIsland, Math.max(0, atlas.islands.length - 1));
    if (clamped !== selectedIsland) {
      setSelectedIsland(clamped);
      setSurfacePaintSettings({ islandIndex: clamped });
      return;
    }
    renderSelectedSurface(clamped);
  }, [atlas.signature, selectedIsland]);

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

  const changeIsland = (nextIsland: number): void => {
    const clamped = Math.max(0, Math.min(atlas.islands.length - 1, nextIsland));
    setSelectedIsland(clamped);
    setSurfacePaintSettings({ islandIndex: clamped });
  };

  useEffect(() => {
    const canvas = ensureAtlasCanvas();
    const context = atlasContext();
    if (!context) return;

    const key = `${objectId}:${texture?.dataUrl ?? baseColor}:${atlas.signature}`;
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
      renderSelectedSurface();
      return;
    }

    const image = new Image();
    image.onload = () => {
      canvas.width = texture.width;
      canvas.height = texture.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      renderSelectedSurface();
    };
    image.src = texture.dataUrl;
  }, [atlas.signature, baseColor, objectId, texture?.dataUrl, texture?.height, texture?.width]);

  const applyAt = (point: [number, number], previous?: [number, number]): void => {
    const canvas = previewCanvasRef.current;
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
      syncPreviewToAtlas();
      commitAtlas();
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
    syncPreviewToAtlas();
    commitAtlas();
  };

  const copySelectedSurfaceToAll = (): void => {
    const atlasCanvas = atlasCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const context = atlasContext();
    if (!atlasCanvas || !previewCanvas || !context || atlas.islands.length < 2) return;

    syncPreviewToAtlas();
    pushHistory();

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = previewCanvas.width;
    sourceCanvas.height = previewCanvas.height;
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) return;
    sourceContext.imageSmoothingEnabled = false;
    sourceContext.drawImage(previewCanvas, 0, 0);

    context.imageSmoothingEnabled = false;
    atlas.islands.forEach((_, islandIndex) => {
      if (islandIndex === selectedIsland) return;
      const target = atlasPixelRegion(atlas, islandIndex, atlasCanvas.width, atlasCanvas.height);
      const width = Math.max(1, target.maxX - target.minX + 1);
      const height = Math.max(1, target.maxY - target.minY + 1);
      context.clearRect(target.minX, target.minY, width, height);
      context.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, target.minX, target.minY, width, height);
    });

    renderSelectedSurface();
    commitAtlas();
  };

  const fillAllSurfaces = (): void => {
    const canvas = atlasCanvasRef.current;
    const context = atlasContext();
    if (!canvas || !context) return;

    syncPreviewToAtlas();
    pushHistory();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const color = hexToRgba(paintColor);

    atlas.islands.forEach((_, islandIndex) => {
      const region = atlasPixelRegion(atlas, islandIndex, image.width, image.height);
      for (let y = region.minY; y <= region.maxY; y += 1) {
        for (let x = region.minX; x <= region.maxX; x += 1) {
          const offset = (y * image.width + x) * 4;
          image.data[offset] = color.r;
          image.data[offset + 1] = color.g;
          image.data[offset + 2] = color.b;
          image.data[offset + 3] = color.a;
        }
      }
    });

    context.putImageData(image, 0, 0);
    renderSelectedSurface();
    commitAtlas();
  };

  const undo = (): void => {
    const previous = historyRef.current.at(-1);
    const current = readAtlas();
    if (!previous || !current) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [cloneImage(current), ...futureRef.current].slice(0, 30);
    writeAtlas(previous);
    commitAtlas();
    refreshControls((value) => value + 1);
  };

  const redo = (): void => {
    const next = futureRef.current[0];
    const current = readAtlas();
    if (!next || !current) return;
    historyRef.current = [...historyRef.current.slice(-29), cloneImage(current)];
    futureRef.current = futureRef.current.slice(1);
    writeAtlas(next);
    commitAtlas();
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
    <div className="paint-editor">
      <button
        type="button"
        className={surfaceEnabled ? 'paint-mode-button active' : 'paint-mode-button'}
        aria-pressed={surfaceEnabled}
        onClick={() => setSurfacePaintSettings({ enabled: !surfaceEnabled })}
      >
        Auf Form malen
      </button>

      <div className="paint-tool-grid">
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            className={tool === entry.tool ? 'paint-tool-button active' : 'paint-tool-button'}
            aria-pressed={tool === entry.tool}
            onClick={() => changeTool(entry.tool)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {(tool === 'brush' || tool === 'eraser') && (
        <div className="range-row paint-brush-size">
          <label>Pinselgröße</label>
          <input type="range" min={1} max={8} step={1} value={brushSize} onChange={(event) => changeBrushSize(Number(event.target.value))} />
          <span>{brushSize}px</span>
        </div>
      )}

      <div className="paint-surface-block">
        <div className="field-row">
          <label>Fläche</label>
          <select value={selectedIsland} onChange={(event) => changeIsland(Number(event.target.value))}>
            {atlas.islands.map((island, islandIndex) => (
              <option key={`${island.label}:${islandIndex}`} value={islandIndex}>{island.label}</option>
            ))}
          </select>
        </div>
        <div className="paint-bulk-actions">
          <button type="button" disabled={atlas.islands.length < 2} onClick={copySelectedSurfaceToAll}>Auf alle kopieren</button>
          <button type="button" onClick={fillAllSurfaces}>Alle Flächen füllen</button>
        </div>
      </div>

      <div className="paint-canvas-shell">
        <canvas
          ref={previewCanvasRef}
          onPointerDown={startPaint}
          onPointerMove={continuePaint}
          onPointerUp={finishPaint}
          onPointerCancel={finishPaint}
        />
      </div>

      <div className="paint-history-actions">
        <button type="button" disabled={historyRef.current.length === 0} onClick={undo}>Rückgängig</button>
        <button type="button" disabled={futureRef.current.length === 0} onClick={redo}>Wiederholen</button>
        <button type="button" className="danger" disabled={!texture} onClick={clearTexture}>Entfernen</button>
      </div>
    </div>
  );
}
