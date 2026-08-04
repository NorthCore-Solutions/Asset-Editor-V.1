import { describe, expect, it } from 'vitest';
import { floodFill, hexToRgba, paintBrush, samplePixel } from './pixelPaint';

function image(width: number, height: number, color = hexToRgba('#FFFFFF')): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = color.r;
    data[index * 4 + 1] = color.g;
    data[index * 4 + 2] = color.b;
    data[index * 4 + 3] = color.a;
  }
  return { data, width, height, colorSpace: 'srgb' };
}

describe('Pixelbemalung', () => {
  it('malt einen quadratischen Pinsel ohne den Rand zu überschreiten', () => {
    const target = image(4, 4);
    paintBrush(target, 0, 0, 2, hexToRgba('#FF0000'));

    expect(samplePixel(target, 0, 0)).toEqual(hexToRgba('#FF0000'));
    expect(samplePixel(target, 1, 0)).toEqual(hexToRgba('#FF0000'));
    expect(samplePixel(target, 0, 1)).toEqual(hexToRgba('#FF0000'));
    expect(samplePixel(target, 2, 2)).toEqual(hexToRgba('#FFFFFF'));
  });

  it('füllt nur die zusammenhängende Fläche', () => {
    const target = image(5, 5);
    const border = hexToRgba('#000000');
    for (let coordinate = 0; coordinate < 5; coordinate += 1) {
      paintBrush(target, coordinate, 0, 1, border);
      paintBrush(target, coordinate, 4, 1, border);
      paintBrush(target, 0, coordinate, 1, border);
      paintBrush(target, 4, coordinate, 1, border);
    }

    floodFill(target, 2, 2, hexToRgba('#00FF00'));

    expect(samplePixel(target, 2, 2)).toEqual(hexToRgba('#00FF00'));
    expect(samplePixel(target, 1, 1)).toEqual(hexToRgba('#00FF00'));
    expect(samplePixel(target, 0, 0)).toEqual(border);
    expect(samplePixel(target, 4, 4)).toEqual(border);
  });

  it('begrenzt die Füllung auf die ausgewählte UV-Insel', () => {
    const target = image(8, 4);
    floodFill(target, 1, 1, hexToRgba('#FF0000'), 0, {
      minX: 0,
      minY: 0,
      maxX: 3,
      maxY: 3
    });

    expect(samplePixel(target, 1, 1)).toEqual(hexToRgba('#FF0000'));
    expect(samplePixel(target, 3, 3)).toEqual(hexToRgba('#FF0000'));
    expect(samplePixel(target, 4, 1)).toEqual(hexToRgba('#FFFFFF'));
    expect(samplePixel(target, 7, 3)).toEqual(hexToRgba('#FFFFFF'));
  });

  it('kann Pixel vollständig transparent radieren', () => {
    const target = image(2, 2, hexToRgba('#336699'));
    paintBrush(target, 1, 1, 1, hexToRgba('#000000', 0));
    expect(samplePixel(target, 1, 1).a).toBe(0);
  });
});
