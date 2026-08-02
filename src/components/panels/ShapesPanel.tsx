import { SHAPE_DEFINITIONS } from '../../geometry/factory';
import { useEditorStore } from '../../store/editorStore';

export function ShapesPanel() {
  const addObject = useEditorStore((state) => state.addObject);
  return (
    <aside className="panel left-panel">
      <div className="panel-header">Formen</div>
      {(['Grundformen', 'Gebäude'] as const).map((category) => (
        <section className="panel-section" key={category}>
          <h3>{category}</h3>
          <div className="shape-grid">
            {SHAPE_DEFINITIONS.filter((shape) => shape.category === category).map((shape) => (
              <button className="shape-button" key={shape.type} onClick={() => addObject(shape.type)}>{shape.label}</button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}
