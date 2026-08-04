import { useState } from 'react';
import {
  STANDARD_COLOR_COLUMNS,
  STANDARD_COLOR_PREVIEW,
  STANDARD_FULL_COLORS,
  type StandardColor
} from '../../materials/standardColors';
import './standard-color-picker.css';

interface StandardColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

type PickerView = 'grid' | 'list';

function normalizedColor(color: string): string {
  return color.toUpperCase();
}

function ColorSwatch({
  entry,
  selected,
  className,
  onSelect
}: {
  entry: StandardColor;
  selected: boolean;
  className: string;
  onSelect: (color: string) => void;
}) {
  return (
    <button
      type="button"
      className={`${className}${selected ? ' selected' : ''}`}
      style={{ backgroundColor: entry.hex }}
      title={`${entry.name} · ${entry.hex}`}
      aria-label={`${entry.name}, ${entry.hex}`}
      aria-pressed={selected}
      onClick={() => onSelect(entry.hex)}
    />
  );
}

export function StandardColorPicker({ value, onChange }: StandardColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PickerView>('grid');
  const current = normalizedColor(value);

  return (
    <div className="standard-color-picker">
      <div className="standard-color-row-heading">
        <span>Grundfarben</span>
        <button
          type="button"
          className="standard-color-all-button"
          onClick={() => setOpen(true)}
        >
          Alle ansehen
        </button>
      </div>

      <div className="standard-color-preview" aria-label="Grundfarben">
        {STANDARD_COLOR_PREVIEW.map((entry) => (
          <ColorSwatch
            key={entry.hex}
            entry={entry}
            selected={current === entry.hex}
            className="standard-color-preview-swatch"
            onSelect={onChange}
          />
        ))}
      </div>

      {open && (
        <div className="standard-color-overlay" role="dialog" aria-modal="true" aria-label="Standard-Vollfarben">
          <div className="standard-color-overlay-header">
            <button
              type="button"
              className="standard-color-header-button standard-color-back-button"
              aria-label="Zurück"
              title="Zurück"
              onClick={() => setOpen(false)}
            >
              ←
            </button>
            <strong>Standard-Vollfarben</strong>
            <div className="standard-color-header-actions">
              <button
                type="button"
                className="standard-color-header-button standard-color-view-button"
                aria-label={view === 'grid' ? 'Listenansicht' : 'Rasteransicht'}
                title={view === 'grid' ? 'Listenansicht' : 'Rasteransicht'}
                onClick={() => setView((currentView) => currentView === 'grid' ? 'list' : 'grid')}
              >
                {view === 'grid' ? '☷' : '▦'}
              </button>
              <button
                type="button"
                className="standard-color-header-button standard-color-close-button"
                aria-label="Schließen"
                title="Schließen"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </div>

          <div className="standard-color-overlay-scroll">
            {view === 'grid' ? (
              <div
                className="standard-color-grid"
                style={{ gridTemplateColumns: `repeat(${STANDARD_COLOR_COLUMNS}, minmax(0, 1fr))` }}
              >
                {STANDARD_FULL_COLORS.map((entry) => (
                  <ColorSwatch
                    key={entry.hex}
                    entry={entry}
                    selected={current === entry.hex}
                    className="standard-color-grid-swatch"
                    onSelect={onChange}
                  />
                ))}
              </div>
            ) : (
              <div className="standard-color-list">
                {STANDARD_FULL_COLORS.map((entry) => (
                  <button
                    key={`${entry.name}:${entry.hex}`}
                    type="button"
                    className={current === entry.hex ? 'standard-color-list-entry selected' : 'standard-color-list-entry'}
                    aria-pressed={current === entry.hex}
                    onClick={() => onChange(entry.hex)}
                  >
                    <span className="standard-color-list-swatch" style={{ backgroundColor: entry.hex }} />
                    <span className="standard-color-list-name">{entry.name}</span>
                    <span className="standard-color-list-hex">{entry.hex}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
