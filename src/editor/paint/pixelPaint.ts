export type PaintTool = 'brush' | 'eraser' | 'fill' | 'eyedropper';

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const DEFAULT_PAINT_SIZE = 32;

export function hexToRgba(hex: string, alpha = 255): RgbaColor {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : '000000';
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: alpha
  };
}

export function rgbaToHex(color: RgbaColor): string {
  const component = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  return `#${component(color.r)}${component(color.g)}${component(color.b)}`.toUpperCase();
}

function pixelOffset(image: ImageData, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

function readPixel(image: ImageData, x: number, y: number): RgbaColor {
  const offset = pixelOffset(image, x, y);
  return {
    r: image.data[offset],
    g: image.data[offset + 1],
    b: image.data[offset + 2],
    a: image.data[offset + 3]
  };
}

function writePixel(image: ImageData, x: number, y: number, color: RgbaColor): void {
  const offset = pixelOffset(image, x, y);
  image.data[offset] = color.r;
  image.data[offset + 1] = color.g;
  image.data[offset + 2] = color.b;
  image.data[offset + 3] = color.a;
}

function colorsEqual(left: RgbaColor, right: RgbaColor, tolerance = 0): boolean {
  if (left.a === 0 && right.a === 0) return true;
  return Math.abs(left.r - right.r) <= tolerance
    && Math.abs(left.g - right.g) <= tolerance
    && Math.abs(left.b - right.b) <= tolerance
    && Math.abs(left.a - right.a) <= tolerance;
}

export function samplePixel(image: ImageData, x: number, y: number): RgbaColor {
  return readPixel(
    image,
    Math.max(0, Math.min(image.width - 1, x)),
    Math.max(0, Math.min(image.height - 1, y))
  );
}

export function paintBrush(
  image: ImageData,
  centerX: number,
  centerY: number,
  size: number,
  color: RgbaColor
): void {
  const diameter = Math.max(1, Math.round(size));
  const startX = centerX - Math.floor((diameter - 1) / 2);
  const startY = centerY - Math.floor((diameter - 1) / 2);

  for (let y = 0; y < diameter; y += 1) {
    for (let x = 0; x < diameter; x += 1) {
      const targetX = startX + x;
      const targetY = startY + y;
      if (targetX < 0 || targetY < 0 || targetX >= image.width || targetY >= image.height) continue;
      writePixel(image, targetX, targetY, color);
    }
  }
}

// Scanline-Füllung nach dem von LibreSprite verwendeten Segmentprinzip:
// Eine horizontale Strecke wird vollständig gefüllt, anschließend werden nur
// die angrenzenden Strecken ober- und unterhalb weiterverfolgt.
export function floodFill(
  image: ImageData,
  startX: number,
  startY: number,
  replacement: RgbaColor,
  tolerance = 0
): void {
  if (startX < 0 || startY < 0 || startX >= image.width || startY >= image.height) return;

  const source = readPixel(image, startX, startY);
  if (colorsEqual(source, replacement, 0)) return;

  const stack: Array<[number, number]> = [[startX, startY]];
  const visited = new Uint8Array(image.width * image.height);

  while (stack.length > 0) {
    const [seedX, y] = stack.pop() as [number, number];
    if (y < 0 || y >= image.height) continue;

    let left = seedX;
    while (left >= 0 && colorsEqual(readPixel(image, left, y), source, tolerance)) left -= 1;
    left += 1;

    let spanAbove = false;
    let spanBelow = false;

    for (let x = left; x < image.width; x += 1) {
      if (!colorsEqual(readPixel(image, x, y), source, tolerance)) break;

      const index = y * image.width + x;
      if (!visited[index]) {
        visited[index] = 1;
        writePixel(image, x, y, replacement);
      }

      if (y > 0) {
        const matchesAbove = colorsEqual(readPixel(image, x, y - 1), source, tolerance);
        if (matchesAbove && !spanAbove) {
          stack.push([x, y - 1]);
          spanAbove = true;
        } else if (!matchesAbove) {
          spanAbove = false;
        }
      }

      if (y + 1 < image.height) {
        const matchesBelow = colorsEqual(readPixel(image, x, y + 1), source, tolerance);
        if (matchesBelow && !spanBelow) {
          stack.push([x, y + 1]);
          spanBelow = true;
        } else if (!matchesBelow) {
          spanBelow = false;
        }
      }
    }
  }
}

export function createFilledImageData(width: number, height: number, color: RgbaColor): ImageData {
  const image = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) writePixel(image, x, y, color);
  }
  return image;
}
