import { useState } from 'react';
import {
  STANDARD_COLOR_COLUMNS,
  STANDARD_COLOR_PREVIEW,
  STANDARD_FULL_COLORS
} from '../../materials/standardColors';
import './standard-color-picker.css';

interface StandardColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function normalizedColor(color: string): string {
  return color.toUpperCase();
}

function ColorSwatch({
  color,
  selected,
  className,
  onSelect
}: {
  color: string;
  selected: boolean;
  className: string;
  onSelect: (color: string) => void;
}) {
  return (
    <button
      type="button"
      className={`${className}${selected ? ' selected' : ''}`}
      style={{ backgroundColor: color }}
      title={color}
      aria-label={`Farbe ${color}`}
      aria-pressed={selected}
      onClick={() => onSelect(color)}
    />
  );
}

export function StandardColorPicker({ value, onChange }: StandardColorPickerProps) {
  const [open, setOpen] = useState(false);
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
        {STANDARD_COLOR_PREVIEW.map((color) => (
          <ColorSwatch
            key={color}
            color={color}
            selected={current === color}
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
              className="standard-color-header-button"
              aria-label="Zurück"
              title="Zurück"
              onClick={() => setOpen(false)}
            >
              ←
            </button>
            <strong>Standard-Vollfarben</strong>
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

          <div className="standard-color-overlay-scroll">
            <div
              className="standard-color-grid"
              style={{ gridTemplateColumns: `repeat(${STANDARD_COLOR_COLUMNS}, minmax(0, 1fr))` }}
            >
              {STANDARD_FULL_COLORS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  selected={current === color}
                  className="standard-color-grid-swatch"
                  onSelect={onChange}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
