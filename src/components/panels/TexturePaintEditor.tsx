import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CameraView, PaintTextureData } from '../../types/editor';
import {
  atlasIslandAtPixel,
  atlasPixelRegion,
  type SurfaceUvAtlas
} from '../../geometry/uvAtlas';
import {
  cloneSurfaceCanvas,
  composeSurfaceAtlasCanvas,
  copySurfaceCanvas,
  createPaintTextureData,
  loadSurfaceCanvases,
  resizeSurfaceCanvases,
  surfaceDimensionsKey,
  type SurfaceRasterMetric
} from '../../editor/paint/surfacePaintGrid';
import {
  floodFill,
  hexToRgba,
  paintBrush,
  rgbaToHex,
  samplePixel,
  type PaintTool
} from '../../editor/paint/pixelPaint';
import {
  requestSurfaceCameraView,
  setSurfacePaintSettings,
  subscribeSurfacePaint
} from '../../editor/paint/surfacePaintSession';
import './texture-paint-editor.css';

interface TexturePaintEditorProps {
  objectId: string;
  baseColor: string;
  texture?: PaintTextureData;
  atlas: SurfaceUvAtlas;
  metrics: SurfaceRasterMetric[];
  onCommit: (texture: PaintTextureData | undefined) => void;
  onPaintModeChange?: (enabled: boolean) => void;
}

interface PaintPoint {
  islandIndex: number;
  point: [number, number];
}

type LayerSnapshot = ImageData[];

const TOOLS: Array<{ tool: PaintTool; label: string }> = [
  { tool: 'brush', label: 'Pinsel' },
  { tool: 'eraser', label: 'Radierer' },
  { tool: 'fill', label: 'Füllen' },
  { tool: 'eyedropper', label: 'Pipette' }
];

function surfaceDisplayLabel(index: number, label: string): string {
  const numberedLabel = `Fläche ${index + 1}`;
  return /^Fläche\s+\d+$/i.test(label) ? numberedLabel : `${numberedLabel} · ${label}`;
}

function cameraViewForSurface(label: string): CameraView | null {
  const direction = label.replace(/\s+\d+$/u, '');
  if (direction === 'Vorne') return 'front';
  if (direction === 'Hinten') return 'back';
  if (direction === 'Links') return 'left';
  if (direction === 'Rechts') return 'right';
  if (direction === 'Oben') return 'top';
  if (direction === 'Unten') return 'bottom';
  return null;
}

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

function snapshotLayers(layers: HTMLCanvasElement[]): LayerSnapshot {
  return layers.map((layer) => {
    const context = layer.getContext('2d', { willReadFrequently: true });
    if (!context) return new ImageData(layer.width, layer.height);
    return context.getImageData(0, 0, layer.width, layer.height);
  });
}

function canvasesFromSnapshot(snapshot: LayerSnapshot): HTMLCanvasElement[] {
  return snapshot.map((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) {
      context.imageSmoothingEnabled = false;
      context.putImageData(image, 0, 0);
    }
    return canvas;
  });
}

export function TexturePaintEditor({
  objectId,
  baseColor,
  texture,
  atlas,
  metrics,
  onCommit,
  onPaintModeChange
}: TexturePaintEditorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const layersRef = useRef<HTMLCanvasElement[]>([]);
  const drawingRef = useRef(false);
  const activeIslandRef = useRef<number | null>(null);
  const lastPointRef = useRef<[number, number] | null>(null);
  const historyRef = useRef<LayerSnapshot[]>([]);
  const futureRef = useRef<LayerSnapshot[]>([]);
  const loadedKeyRef = useRef('');
  const loadRequestRef = useRef(0);
  const [tool, setTool] = useState<PaintTool>('brush');
  const [paintColor, setPaintColor] = useState(baseColor);
  const [brushSize, setBrushSize] = useState(1);
  const [surfaceEnabled, setSurfaceEnabled] = useState(false);
  const [selectedIsland, setSelectedIsland] = useState(-1);
  const [copyTargetIsland, setCopyTargetIsland] = useState(-1);
  const [, refreshControls] = useState(0);
  const dimensionsKey = surfaceDimensionsKey(metrics);

  const renderSelectedSurface = (islandIndex = selectedIsland): void => {
    const previewCanvas = previewCanvasRef.current;
    const previewContext = previewCanvas?.getContext('2d', { willReadFrequently: true });
    if (!previewCanvas || !previewContext || layersRef.current.length === 0) return;
    previewContext.imageSmoothingEnabled = false;

    if (islandIndex < 0) {
      const overview = composeSurfaceAtlasCanvas(layersRef.current, atlas, metrics, baseColor);
      previewCanvas.width = overview.width;
      previewCanvas.height = overview.height;
      previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewContext.drawImage(overview, 0, 0);
      return;
    }

    const layer = layersRef.current[islandIndex];
    if (!layer) return;
    previewCanvas.width = layer.width;
    previewCanvas.height = layer.height;
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(layer, 0, 0);
  };

  const commitLayers = (): void => {
    if (layersRef.current.length === 0) return;
    const data = createPaintTextureData(layersRef.current, atlas, metrics, baseColor);
    loadedKeyRef.current = `${objectId}:${data.dataUrl}:${atlas.signature}:${dimensionsKey}`;
    onCommit(data);
  };

  const pushHistory = (): void => {
    if (layersRef.current.length === 0) return;
    historyRef.current = [...historyRef.current.slice(-29), snapshotLayers(layersRef.current)];
    futureRef.current = [];
    refreshControls((value) => value + 1);
  };

  useEffect(() => subscribeSurfacePaint((settings) => {
    setSurfaceEnabled(settings.enabled);
    setTool(settings.tool);
    setPaintColor(settings.color);
    setBrushSize(settings.brushSize);
    setSelectedIsland(Math.min(Math.max(-1, settings.islandIndex), Math.max(0, atlas.islands.length - 1)));
  }), [atlas.islands.length]);

  useEffect(() => () => {
    loadRequestRef.current += 1;
    setSurfacePaintSettings({ enabled: false });
  }, []);

  useEffect(() => {
    const clamped = Math.min(Math.max(-1, selectedIsland), Math.max(0, atlas.islands.length - 1));
    if (clamped !== selectedIsland) {
      setSelectedIsland(clamped);
      setSurfacePaintSettings({ islandIndex: clamped });
      return;
    }
    renderSelectedSurface(clamped);
  }, [atlas.signature, selectedIsland, dimensionsKey]);

  useEffect(() => {
    setCopyTargetIsland((current) => current >= atlas.islands.length ? -1 : current);
  }, [atlas.islands.length]);

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
    const clamped = Math.max(-1, Math.min(atlas.islands.length - 1, nextIsland));
    setSelectedIsland(clamped);
    setSurfacePaintSettings({ islandIndex: clamped });

    if (clamped >= 0) {
      const view = cameraViewForSurface(atlas.islands[clamped]?.label ?? '');
      if (view) requestSurfaceCameraView(view);
    }
  };

  const toggleSurfacePaint = (): void => {
    const nextEnabled = !surfaceEnabled;
    onPaintModeChange?.(nextEnabled);
    setSurfacePaintSettings({ enabled: nextEnabled });
  };

  useEffect(() => {
    const key = `${objectId}:${texture?.dataUrl ?? baseColor}:${atlas.signature}:${dimensionsKey}`;
    if (loadedKeyRef.current === key) return;
    const requestId = ++loadRequestRef.current;

    void loadSurfaceCanvases(texture, atlas, metrics, baseColor)
      .then((layers) => {
        if (loadRequestRef.current !== requestId) return;
        layersRef.current = layers;
        loadedKeyRef.current = key;
        historyRef.current = [];
        futureRef.current = [];
        renderSelectedSurface();
        refreshControls((value) => value + 1);

        const storedGrid = texture?.surfaceGrid;
        const needsMigration = Boolean(texture) && (
          !storedGrid
          || storedGrid.atlasSignature !== atlas.signature
          || storedGrid.surfaces.length !== metrics.length
          || storedGrid.surfaces.some((stored, index) => {
            const metric = metrics[index];
            return !metric || stored.width !== metric.width || stored.height !== metric.height;
          })
        );
        if (needsMigration) commitLayers();
      })
      .catch(() => undefined);
  }, [atlas.signature, baseColor, dimensionsKey, objectId, texture?.dataUrl, texture?.height, texture?.width]);

  useEffect(() => {
    if (layersRef.current.length === 0) return;
    const resized = resizeSurfaceCanvases(layersRef.current, metrics, baseColor);
    const changed = resized.some((layer, index) => {
      const previous = layersRef.current[index];
      return !previous || previous.width !== layer.width || previous.height !== layer.height;
    });
    layersRef.current = resized;
    renderSelectedSurface();
    if (texture && changed) commitLayers();
  }, [dimensionsKey]);

  const resolvePaintPoint = (event: ReactPointerEvent<HTMLCanvasElement>): PaintPoint | null => {
    const preview = event.currentTarget;
    const [previewX, previewY] = canvasPoint(preview, event.clientX, event.clientY);

    if (selectedIsland >= 0) {
      const layer = layersRef.current[selectedIsland];
      if (!layer) return null;
      return {
        islandIndex: selectedIsland,
        point: [
          Math.max(0, Math.min(layer.width - 1, previewX)),
          Math.max(0, Math.min(layer.height - 1, previewY))
        ]
      };
    }

    const islandIndex = atlasIslandAtPixel(atlas, preview.width, preview.height, previewX, previewY);
    const layer = layersRef.current[islandIndex];
    if (!layer) return null;
    const region = atlasPixelRegion(atlas, islandIndex, preview.width, preview.height);
    const regionWidth = Math.max(1, region.maxX - region.minX + 1);
    const regionHeight = Math.max(1, region.maxY - region.minY + 1);
    const localX = (previewX - region.minX) / regionWidth;
    const localY = (previewY - region.minY) / regionHeight;

    return {
      islandIndex,
      point: [
        Math.max(0, Math.min(layer.width - 1, Math.floor(localX * layer.width))),
        Math.max(0, Math.min(layer.height - 1, Math.floor(localY * layer.height)))
      ]
    };
  };

  const applyAt = (islandIndex: number, point: [number, number], previous?: [number, number]): void => {
    const layer = layersRef.current[islandIndex];
    const context = layer?.getContext('2d', { willReadFrequently: true });
    if (!layer || !context) return;
    const image = context.getImageData(0, 0, layer.width, layer.height);

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
    renderSelectedSurface();
  };

  const startPaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const hit = resolvePaintPoint(event);
    if (!hit) return;

    if (tool === 'eyedropper') {
      applyAt(hit.islandIndex, hit.point);
      return;
    }

    pushHistory();
    applyAt(hit.islandIndex, hit.point);

    if (tool === 'fill') {
      commitLayers();
      return;
    }

    drawingRef.current = true;
    activeIslandRef.current = hit.islandIndex;
    lastPointRef.current = hit.point;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continuePaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current || (tool !== 'brush' && tool !== 'eraser')) return;
    const hit = resolvePaintPoint(event);
    if (!hit) {
      activeIslandRef.current = null;
      lastPointRef.current = null;
      return;
    }
    const sameIsland = activeIslandRef.current === hit.islandIndex;
    applyAt(hit.islandIndex, hit.point, sameIsland ? lastPointRef.current ?? hit.point : hit.point);
    activeIslandRef.current = hit.islandIndex;
    lastPointRef.current = hit.point;
  };

  const finishPaint = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    activeIslandRef.current = null;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commitLayers();
  };

  const copySelectedSurface = (): void => {
    const source = layersRef.current[selectedIsland];
    if (!source || selectedIsland < 0) return;
    const targetIndices = copyTargetIsland < 0
      ? atlas.islands.map((_, index) => index).filter((index) => index !== selectedIsland)
      : [copyTargetIsland];
    if (targetIndices.length === 0 || targetIndices.includes(selectedIsland)) return;

    pushHistory();
    const next = layersRef.current.map(cloneSurfaceCanvas);
    targetIndices.forEach((targetIndex) => {
      const metric = metrics[targetIndex];
      if (metric) next[targetIndex] = copySurfaceCanvas(source, metric);
    });
    layersRef.current = next;
    renderSelectedSurface();
    commitLayers();
  };

  const undo = (): void => {
    const previous = historyRef.current.at(-1);
    if (!previous || layersRef.current.length === 0) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [snapshotLayers(layersRef.current), ...futureRef.current].slice(0, 30);
    layersRef.current = canvasesFromSnapshot(previous);
    renderSelectedSurface();
    commitLayers();
    refreshControls((value) => value + 1);
  };

  const redo = (): void => {
    const next = futureRef.current[0];
    if (!next || layersRef.current.length === 0) return;
    historyRef.current = [...historyRef.current.slice(-29), snapshotLayers(layersRef.current)];
    futureRef.current = futureRef.current.slice(1);
    layersRef.current = canvasesFromSnapshot(next);
    renderSelectedSurface();
    commitLayers();
    refreshControls((value) => value + 1);
  };

  const clearTexture = (): void => {
    historyRef.current = [];
    futureRef.current = [];
    loadedKeyRef.current = '';
    layersRef.current = [];
    onCommit(undefined);
    refreshControls((value) => value + 1);
  };

  const selectedSurface = selectedIsland >= 0 ? atlas.islands[selectedIsland] : undefined;
  const selectedSurfaceLabel = selectedIsland < 0
    ? 'Fläche X · Gesamtübersicht'
    : surfaceDisplayLabel(selectedIsland, selectedSurface?.label ?? 'Oberfläche');
  const copyDisabled = atlas.islands.length < 2
    || selectedIsland < 0
    || copyTargetIsland === selectedIsland;

  return (
    <div className="paint-editor">
      <button
        type="button"
        className={surfaceEnabled ? 'paint-mode-button active' : 'paint-mode-button'}
        aria-pressed={surfaceEnabled}
        onClick={toggleSurfacePaint}
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
            <option value={-1}>Fläche X · Gesamtübersicht</option>
            {atlas.islands.map((island, islandIndex) => (
              <option key={`${island.label}:${islandIndex}`} value={islandIndex}>
                {surfaceDisplayLabel(islandIndex, island.label)}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <label>Kopieren nach</label>
          <select value={copyTargetIsland} onChange={(event) => setCopyTargetIsland(Number(event.target.value))}>
            <option value={-1}>Alle Flächen</option>
            {atlas.islands.map((island, islandIndex) => (
              <option key={`copy:${island.label}:${islandIndex}`} value={islandIndex}>
                {surfaceDisplayLabel(islandIndex, island.label)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="paint-copy-button"
          disabled={copyDisabled}
          onClick={copySelectedSurface}
        >
          Kopieren
        </button>
      </div>

      <div className="paint-surface-preview-title">{selectedSurfaceLabel}</div>
      <div key={selectedIsland} className="paint-canvas-shell paint-canvas-switch">
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
