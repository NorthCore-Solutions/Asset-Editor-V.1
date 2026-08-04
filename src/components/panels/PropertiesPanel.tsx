import { useEffect, useMemo, useRef, useState } from 'react';
import { MATERIAL_PRESETS } from '../../materials/presets';
import { createGeometry } from '../../geometry/factory';
import { FULL_SURFACE_UV_ATLAS, getSurfaceUvAtlas } from '../../geometry/uvAtlas';
import { getSurfaceRasterMetrics } from '../../editor/paint/surfacePaintGrid';
import { setSurfacePaintSettings, subscribeSurfacePaint } from '../../editor/paint/surfacePaintSession';
import { useEditorStore } from '../../store/editorStore';
import type { MaterialData, PaintTextureData, Vec3 } from '../../types/editor';
import { StandardColorPicker } from './StandardColorPicker';
import { TexturePaintEditor } from './TexturePaintEditor';

interface PropertiesPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

type ColorTarget = 'base' | 'paint';

const round = (value: number) => Number(value.toFixed(3));

function hexRgb(color: string): [number, number, number] {
  const normalized = color.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

function recolorDataUrl(
  dataUrl: string,
  width: number,
  height: number,
  previousColor: string,
  nextColor: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        reject(new Error('2D-Kontext für Grundfarbenänderung nicht verfügbar.'));
        return;
      }

      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const previous = hexRgb(previousColor);
      const next = hexRgb(nextColor);
      const tolerance = 3;

      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const red = pixels.data[offset] ?? 0;
        const green = pixels.data[offset + 1] ?? 0;
        const blue = pixels.data[offset + 2] ?? 0;
        const alpha = pixels.data[offset + 3] ?? 0;
        const matchesBackground = alpha > 0
          && Math.abs(red - previous[0]) <= tolerance
          && Math.abs(green - previous[1]) <= tolerance
          && Math.abs(blue - previous[2]) <= tolerance;
        if (!matchesBackground) continue;

        pixels.data[offset] = next[0];
        pixels.data[offset + 1] = next[1];
        pixels.data[offset + 2] = next[2];
      }

      context.putImageData(pixels, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };

    image.onerror = () => reject(new Error('Bemalung konnte für die Grundfarbenänderung nicht geladen werden.'));
    image.src = dataUrl;
  });
}

async function recolorTextureBackground(
  texture: PaintTextureData,
  previousColor: string,
  nextColor: string
): Promise<PaintTextureData> {
  const surfaceGrid = texture.surfaceGrid;
  const displayPromise = recolorDataUrl(
    texture.dataUrl,
    texture.width,
    texture.height,
    previousColor,
    nextColor
  );
  const sourcePromise = surfaceGrid?.sourceDataUrl && surfaceGrid.sourceWidth && surfaceGrid.sourceHeight
    ? recolorDataUrl(
        surfaceGrid.sourceDataUrl,
        surfaceGrid.sourceWidth,
        surfaceGrid.sourceHeight,
        previousColor,
        nextColor
      )
    : Promise.resolve(undefined);
  const [dataUrl, sourceDataUrl] = await Promise.all([displayPromise, sourcePromise]);

  return {
    ...texture,
    dataUrl,
    surfaceGrid: surfaceGrid
      ? {
          ...surfaceGrid,
          baseColor: nextColor.toUpperCase(),
          ...(sourceDataUrl ? { sourceDataUrl } : {})
        }
      : undefined
  };
}

function VectorEditor({ label, value, unit, onChange }: { label: string; value: Vec3; unit?: 'deg'; onChange: (value: Vec3) => void }) {
  const shown = value.map((item) => round(unit === 'deg' ? item * 180 / Math.PI : item)) as Vec3;
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="vector-grid">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label key={axis}>{axis}<input type="number" step={0.001} value={shown[index]} onChange={(event) => {
            const next = [...shown] as Vec3;
            next[index] = round(Number(event.target.value));
            onChange(unit === 'deg'
              ? next.map((item) => item * Math.PI / 180) as Vec3
              : next.map(round) as Vec3);
          }} /></label>
        ))}
      </div>
    </div>
  );
}

function RangeField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number, history?: boolean) => void }) {
  const begin = useEditorStore((state) => state.beginTransaction);
  const end = useEditorStore((state) => state.endTransaction);
  return <div className="range-row"><label>{label}</label><input type="range" min={min} max={max} step={step} value={value} onPointerDown={begin} onPointerUp={end} onChange={(event) => onChange(Number(event.target.value), false)} /><span>{value.toFixed(2)}</span></div>;
}

function PropertiesHeader({ collapsed, onToggle }: PropertiesPanelProps) {
  return (
    <div className="panel-header">
      {!collapsed && <span className="panel-title">Eigenschaften</span>}
      <button
        type="button"
        className="panel-collapse-button"
        onClick={onToggle}
        aria-label={collapsed ? 'Eigenschaften einblenden' : 'Eigenschaften ausblenden'}
        title={collapsed ? 'Eigenschaften einblenden' : 'Eigenschaften ausblenden'}
      >
        {collapsed ? '‹' : '›'}
      </button>
    </div>
  );
}

export function PropertiesPanel({ collapsed, onToggle }: PropertiesPanelProps) {
  const selectedId = useEditorStore((state) => state.selectedId);
  const object = useEditorStore((state) => state.objects.find((item) => item.id === selectedId));
  const updateObject = useEditorStore((state) => state.updateObject);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const updateMaterial = useEditorStore((state) => state.updateMaterial);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const [colorTarget, setColorTarget] = useState<ColorTarget>('base');
  const [paintColor, setPaintColor] = useState('#AEB8BE');
  const recolorRequestRef = useRef(0);

  useEffect(() => subscribeSurfacePaint((settings) => {
    setPaintColor(settings.color);
  }), []);

  const paintSurface = useMemo(() => {
    if (!object) {
      return {
        atlas: FULL_SURFACE_UV_ATLAS,
        metrics: [{
          label: 'Oberfläche',
          width: 32,
          height: 32,
          coverageU: 1,
          coverageV: 1,
          worldWidth: 1,
          worldHeight: 1
        }]
      };
    }

    const geometry = createGeometry({ type: object.type, geometry: object.geometry });
    const atlas = getSurfaceUvAtlas(geometry);
    const metrics = getSurfaceRasterMetrics(geometry, object.scale, atlas);
    geometry.dispose();
    return { atlas, metrics };
  }, [
    object?.geometry,
    object?.type,
    object?.scale[0],
    object?.scale[1],
    object?.scale[2]
  ]);

  if (collapsed) {
    return <aside className="panel right-panel panel-collapsed"><PropertiesHeader collapsed onToggle={onToggle} /></aside>;
  }

  if (!object) {
    return (
      <aside className="panel right-panel">
        <PropertiesHeader collapsed={false} onToggle={onToggle} />
        <div className="properties-scroll-content">
          <div className="empty-state">Kein Objekt ausgewählt</div>
        </div>
        <div className="panel-end-space" aria-hidden="true" />
      </aside>
    );
  }

  const setMaterial = (patch: Partial<MaterialData>, history = true) => updateMaterial(object.id, patch, history);
  const shownColor = colorTarget === 'base' ? object.material.color : paintColor;

  const changeBaseColor = (normalized: string): void => {
    const previousColor = object.material.color;
    const paintTexture = object.material.paintTexture;
    const sourceDataUrl = paintTexture?.dataUrl;
    const requestId = ++recolorRequestRef.current;

    if (!paintTexture || previousColor.toUpperCase() === normalized) {
      setMaterial({ color: normalized });
      return;
    }

    void recolorTextureBackground(paintTexture, previousColor, normalized)
      .then((updatedTexture) => {
        const currentObject = useEditorStore.getState().objects.find((item) => item.id === object.id);
        const currentDataUrl = currentObject?.material.paintTexture?.dataUrl;
        if (recolorRequestRef.current !== requestId || currentDataUrl !== sourceDataUrl) return;
        updateMaterial(object.id, {
          color: normalized,
          paintTexture: updatedTexture
        });
      })
      .catch(() => undefined);
  };

  const changeSelectedColor = (color: string): void => {
    const normalized = color.toUpperCase();
    if (colorTarget === 'base') changeBaseColor(normalized);
    else setSurfacePaintSettings({ color: normalized });
  };

  const commitPaintTexture = (paintTexture: PaintTextureData | undefined): void => {
    recolorRequestRef.current += 1;
    const normalizedTexture = paintTexture?.surfaceGrid
      ? {
          ...paintTexture,
          surfaceGrid: {
            ...paintTexture.surfaceGrid,
            baseColor: object.material.color.toUpperCase()
          }
        }
      : paintTexture;
    setMaterial({ paintTexture: normalizedTexture });
  };

  return (
    <aside className="panel right-panel">
      <PropertiesHeader collapsed={false} onToggle={onToggle} />
      <div className="properties-scroll-content">
        <section className="panel-section">
          <h3>Objekt</h3>
          <div className="field-row"><label>Name</label><input value={object.name} onChange={(event) => updateObject(object.id, { name: event.target.value })} /></div>
          <div className="field-row"><label>Typ</label><input value={object.type} readOnly /></div>
          <div className="field-row"><label>Sichtbar</label><input type="checkbox" checked={object.visible} onChange={(event) => updateObject(object.id, { visible: event.target.checked })} /></div>
          <div className="field-row"><label>Gesperrt</label><input type="checkbox" checked={object.locked} onChange={(event) => updateObject(object.id, { locked: event.target.checked })} /></div>
          <div className="inline-actions"><button onClick={() => duplicateObject(object.id)}>Duplizieren</button><button className="danger" onClick={() => deleteObject(object.id)}>Löschen</button></div>
        </section>

        <section className="panel-section">
          <h3>Transformation</h3>
          <VectorEditor label="Position" value={object.position} onChange={(value) => updateTransform(object.id, 'position', value)} />
          <VectorEditor label="Rotation" value={object.rotation} unit="deg" onChange={(value) => updateTransform(object.id, 'rotation', value)} />
          <VectorEditor label="Skalierung" value={object.scale} onChange={(value) => updateTransform(object.id, 'scale', value)} />
        </section>

        <section className="panel-section">
          <h3>Material & Farben</h3>
          <div className="field-row"><label>Vorlage</label><select defaultValue="" onChange={(event) => { const preset = MATERIAL_PRESETS[event.target.value]; if (preset) setMaterial(preset); }}><option value="">– auswählen –</option>{Object.keys(MATERIAL_PRESETS).map((name) => <option key={name}>{name}</option>)}</select></div>

          <div className="merged-color-block">
            <div className="color-target-toggle">
              <button type="button" className={colorTarget === 'base' ? 'color-target-button active' : 'color-target-button'} onClick={() => setColorTarget('base')}>Grundfarbe</button>
              <button type="button" className={colorTarget === 'paint' ? 'color-target-button active' : 'color-target-button'} onClick={() => setColorTarget('paint')}>Malfarbe</button>
            </div>
            <StandardColorPicker value={shownColor} onChange={changeSelectedColor} />
          </div>

          <RangeField label="Rauheit" value={object.material.roughness} min={0} max={1} step={0.01} onChange={(value, history) => setMaterial({ roughness: value }, history)} />
          <RangeField label="Metallisch" value={object.material.metalness} min={0} max={1} step={0.01} onChange={(value, history) => setMaterial({ metalness: value }, history)} />
          <RangeField label="Transparenz" value={object.material.opacity} min={0} max={1} step={0.01} onChange={(value, history) => setMaterial({ opacity: value }, history)} />
          <div className="field-row"><label>Flat Shading</label><input type="checkbox" checked={object.material.flatShading} onChange={(event) => setMaterial({ flatShading: event.target.checked })} /></div>
        </section>

        <section className="panel-section">
          <h3>Bemalung</h3>
          <TexturePaintEditor
            objectId={object.id}
            baseColor={object.material.color}
            texture={object.material.paintTexture}
            atlas={paintSurface.atlas}
            metrics={paintSurface.metrics}
            onCommit={commitPaintTexture}
            onPaintModeChange={(enabled) => {
              if (enabled) setColorTarget('paint');
            }}
          />
        </section>
      </div>
      <div className="panel-end-space" aria-hidden="true" />
    </aside>
  );
}
