import { MATERIAL_PRESETS, NORTHCORE_COLORS, LOW_POLY_COLORS } from '../../materials/presets';
import { useEditorStore } from '../../store/editorStore';
import type { MaterialData, Vec3 } from '../../types/editor';
import { TexturePaintEditor } from './TexturePaintEditor';

interface PropertiesPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

const round = (value: number) => Number(value.toFixed(3));

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
  const recentColors = useEditorStore((state) => state.recentColors);

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
  const palettes = [{ title: 'Zuletzt', colors: recentColors }, { title: 'NorthCore', colors: NORTHCORE_COLORS }, { title: 'Low-Poly', colors: LOW_POLY_COLORS }];
  const paintPalette = [...recentColors, ...NORTHCORE_COLORS, ...LOW_POLY_COLORS];

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
          <h3>Material</h3>
          <div className="field-row"><label>Vorlage</label><select defaultValue="" onChange={(event) => { const preset = MATERIAL_PRESETS[event.target.value]; if (preset) setMaterial(preset); }}><option value="">– auswählen –</option>{Object.keys(MATERIAL_PRESETS).map((name) => <option key={name}>{name}</option>)}</select></div>
          <div className="field-row"><label>Grundfarbe</label><div className="color-row"><input type="color" value={object.material.color} onChange={(event) => setMaterial({ color: event.target.value })} /><input value={object.material.color} onChange={(event) => /^#[0-9a-fA-F]{6}$/.test(event.target.value) && setMaterial({ color: event.target.value })} /></div></div>
          {palettes.map((palette) => palette.colors.length > 0 && <div key={palette.title}><h3>{palette.title}</h3><div className="palette">{palette.colors.map((color) => <button key={color} className="swatch" title={color} aria-label={color} style={{ background: color }} onClick={() => setMaterial({ color })} />)}</div></div>)}
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
            palette={paintPalette}
            onCommit={(paintTexture) => setMaterial({ paintTexture })}
          />
        </section>
      </div>
      <div className="panel-end-space" aria-hidden="true" />
    </aside>
  );
}
