const normalizeHex = (color: string): string | null => {
  const raw = color.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return raw.split('').map((character) => `${character}${character}`).join('');
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? raw : null;
};

export function invertHexColor(color: string): string {
  const hex = normalizeHex(color);
  if (!hex) return '#000000';

  const inverted = [0, 2, 4]
    .map((offset) => 255 - Number.parseInt(hex.slice(offset, offset + 2), 16))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

  return `#${inverted.toUpperCase()}`;
}
