import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const source = await readFile(path, 'utf8');
  const result = transform(source);
  if (result !== source) await writeFile(path, result, 'utf8');
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Muster fehlt: ${label}`);
  return source.replace(before, after);
}

await update('src/types/editor.ts', (input) => replaceOnce(
  input,
  '  version: 1;\n  atlasSignature: string;',
  '  version: 1 | 2;\n  atlasSignature: string;',
  'PaintSurfaceGridData Version'
));

await update('src/editor/paint/surfacePaintGrid.ts', (input) => {
  let source = input;

  source = replaceOnce(
    source,
    'export const PAINT_PIXELS_PER_WORLD_UNIT = 32;\nconst MAX_SURFACE_PIXELS = 384;',
    'export const PAINT_PIXELS_PER_WORLD_UNIT = 32;\nexport const PAINT_BASE_ALPHA = 254;\nconst MAX_SURFACE_PIXELS = 384;',
    'Grundfarben-Alpha-Konstante'
  );

  source = replaceOnce(
    source,
    `function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {\n  const context = canvas.getContext('2d', { willReadFrequently: true });\n  if (!context) throw new Error('2D-Kontext für Flächenraster nicht verfügbar.');\n  context.imageSmoothingEnabled = false;\n  return context;\n}\n`,
    `function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {\n  const context = canvas.getContext('2d', { willReadFrequently: true });\n  if (!context) throw new Error('2D-Kontext für Flächenraster nicht verfügbar.');\n  context.imageSmoothingEnabled = false;\n  return context;\n}\n\nexport function recolorSurfaceBasePixels(\n  image: ImageData,\n  previousColor: string,\n  nextColor: string,\n  version: 1 | 2\n): void {\n  const previous = hexToRgba(previousColor);\n  const next = hexToRgba(nextColor);\n  const tolerance = 3;\n\n  for (let offset = 0; offset < image.data.length; offset += 4) {\n    const red = image.data[offset] ?? 0;\n    const green = image.data[offset + 1] ?? 0;\n    const blue = image.data[offset + 2] ?? 0;\n    const alpha = image.data[offset + 3] ?? 0;\n    const isBasePixel = version === 2\n      ? alpha === PAINT_BASE_ALPHA\n      : alpha > 0\n        && Math.abs(red - previous.r) <= tolerance\n        && Math.abs(green - previous.g) <= tolerance\n        && Math.abs(blue - previous.b) <= tolerance;\n    if (!isBasePixel) continue;\n\n    image.data[offset] = next.r;\n    image.data[offset + 1] = next.g;\n    image.data[offset + 2] = next.b;\n    image.data[offset + 3] = PAINT_BASE_ALPHA;\n  }\n}\n\nfunction recolorSurfaceBaseCanvas(\n  canvas: HTMLCanvasElement,\n  previousColor: string,\n  nextColor: string,\n  version: 1 | 2\n): void {\n  const context = canvasContext(canvas);\n  const image = context.getImageData(0, 0, canvas.width, canvas.height);\n  recolorSurfaceBasePixels(image, previousColor, nextColor, version);\n  context.putImageData(image, 0, 0);\n}\n\nfunction makeSurfaceBaseOpaque(canvas: HTMLCanvasElement): void {\n  const context = canvasContext(canvas);\n  const image = context.getImageData(0, 0, canvas.width, canvas.height);\n  let changed = false;\n\n  for (let offset = 3; offset < image.data.length; offset += 4) {\n    if (image.data[offset] !== PAINT_BASE_ALPHA) continue;\n    image.data[offset] = 255;\n    changed = true;\n  }\n\n  if (changed) context.putImageData(image, 0, 0);\n}\n`,
    'Grundfarben-Pixel-Helfer'
  );

  source = replaceOnce(
    source,
    '    createFilledImageData(canvas.width, canvas.height, hexToRgba(color)),',
    '    createFilledImageData(canvas.width, canvas.height, hexToRgba(color, PAINT_BASE_ALPHA)),',
    'Grundflächen-Markierung'
  );

  source = replaceOnce(
    source,
    `    canvas.width,\n    canvas.height\n  );\n  return canvas;\n}\n\nexport function resizeSurfaceCanvas(`,
    `    canvas.width,\n    canvas.height\n  );\n  makeSurfaceBaseOpaque(canvas);\n  return canvas;\n}\n\nexport function resizeSurfaceCanvas(`,
    'Sichtbare Fläche opak darstellen'
  );

  source = replaceOnce(
    source,
    `  const compatibleGrid = storedGrid?.version === 1\n    && storedGrid.atlasSignature === atlas.signature\n    && storedGrid.surfaces.length === atlas.islands.length;\n  const compatibleSource = compatibleGrid\n    && storedGrid.baseColor?.toUpperCase() === baseColor.toUpperCase()\n    && Boolean(storedGrid.sourceDataUrl)\n    && Boolean(storedGrid.sourceWidth)\n    && Boolean(storedGrid.sourceHeight);`,
    `  const compatibleGrid = (storedGrid?.version === 1 || storedGrid?.version === 2)\n    && storedGrid.atlasSignature === atlas.signature\n    && storedGrid.surfaces.length === atlas.islands.length;\n  const compatibleSource = compatibleGrid\n    && Boolean(storedGrid.sourceDataUrl)\n    && Boolean(storedGrid.sourceWidth)\n    && Boolean(storedGrid.sourceHeight);`,
    'Quelltextur-Kompatibilität'
  );

  source = replaceOnce(
    source,
    `    extractedContext.drawImage(\n      image,\n      region.minX,\n      region.minY,\n      regionWidth,\n      regionHeight,\n      0,\n      0,\n      storedWidth,\n      storedHeight\n    );\n    return resizeSurfaceCanvas(extracted, metric, baseColor);`,
    `    extractedContext.drawImage(\n      image,\n      region.minX,\n      region.minY,\n      regionWidth,\n      regionHeight,\n      0,\n      0,\n      storedWidth,\n      storedHeight\n    );\n    recolorSurfaceBaseCanvas(\n      extracted,\n      storedGrid?.baseColor ?? baseColor,\n      baseColor,\n      storedGrid?.version ?? 1\n    );\n    return resizeSurfaceCanvas(extracted, metric, baseColor);`,
    'Grundfarbe beim Laden migrieren'
  );

  source = replaceOnce(
    source,
    `export function composeSurfaceAtlasCanvas(\n  surfaces: HTMLCanvasElement[],\n  atlas: SurfaceUvAtlas,\n  metrics: SurfaceRasterMetric[],\n  baseColor: string\n): HTMLCanvasElement {`,
    `export function composeSurfaceAtlasCanvas(\n  surfaces: HTMLCanvasElement[],\n  atlas: SurfaceUvAtlas,\n  metrics: SurfaceRasterMetric[],\n  baseColor: string,\n  preserveBaseMarker = false\n): HTMLCanvasElement {`,
    'Atlas-Komposition Signatur'
  );

  source = replaceOnce(
    source,
    `  });\n\n  return canvas;\n}\n\nexport function createPaintTextureData(`,
    `  });\n\n  if (!preserveBaseMarker) makeSurfaceBaseOpaque(canvas);\n  return canvas;\n}\n\nexport function createPaintTextureData(`,
    'Atlas-Grundfarbe opak darstellen'
  );

  source = replaceOnce(
    source,
    '  const sourceCanvas = composeSurfaceAtlasCanvas(surfaces, atlas, sourceMetrics, baseColor);',
    '  const sourceCanvas = composeSurfaceAtlasCanvas(surfaces, atlas, sourceMetrics, baseColor, true);',
    'Quellatlas Marker erhalten'
  );

  source = replaceOnce(
    source,
    '    version: 1,\n    atlasSignature: atlas.signature,',
    '    version: 2,\n    atlasSignature: atlas.signature,',
    'Paint-Raster Version 2'
  );

  return source;
});

await update('src/components/panels/PropertiesPanel.tsx', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "import { getSurfaceRasterMetrics } from '../../editor/paint/surfacePaintGrid';",
    `import {\n  createPaintTextureData,\n  getSurfaceRasterMetrics,\n  loadSurfaceCanvases\n} from '../../editor/paint/surfacePaintGrid';`,
    'PropertiesPanel Paint-Importe'
  );

  const helperStart = source.indexOf('function hexRgb(');
  const helperEnd = source.indexOf('function VectorEditor(');
  if (helperStart >= 0 && helperEnd > helperStart) {
    source = `${source.slice(0, helperStart)}${source.slice(helperEnd)}`;
  }

  source = replaceOnce(
    source,
    `  const changeBaseColor = (normalized: string): void => {\n    const previousColor = object.material.color;\n    const paintTexture = object.material.paintTexture;\n    const sourceDataUrl = paintTexture?.dataUrl;\n    const requestId = ++recolorRequestRef.current;\n\n    if (!paintTexture || previousColor.toUpperCase() === normalized) {\n      setMaterial({ color: normalized });\n      return;\n    }\n\n    void recolorTextureBackground(paintTexture, previousColor, normalized)\n      .then((updatedTexture) => {\n        const currentObject = useEditorStore.getState().objects.find((item) => item.id === object.id);\n        const currentDataUrl = currentObject?.material.paintTexture?.dataUrl;\n        if (recolorRequestRef.current !== requestId || currentDataUrl !== sourceDataUrl) return;\n        updateMaterial(object.id, {\n          color: normalized,\n          paintTexture: updatedTexture\n        });\n      })\n      .catch(() => undefined);\n  };`,
    `  const changeBaseColor = (normalized: string): void => {\n    const previousColor = object.material.color;\n    const paintTexture = object.material.paintTexture;\n    const sourceDataUrl = paintTexture?.dataUrl;\n    const requestId = ++recolorRequestRef.current;\n\n    if (!paintTexture || previousColor.toUpperCase() === normalized) {\n      setMaterial({ color: normalized });\n      return;\n    }\n\n    const { atlas, metrics } = paintSurface;\n    void loadSurfaceCanvases(paintTexture, atlas, metrics, normalized)\n      .then((layers) => createPaintTextureData(layers, atlas, metrics, normalized))\n      .then((updatedTexture) => {\n        const currentObject = useEditorStore.getState().objects.find((item) => item.id === object.id);\n        const currentDataUrl = currentObject?.material.paintTexture?.dataUrl;\n        if (recolorRequestRef.current !== requestId || currentDataUrl !== sourceDataUrl) return;\n        updateMaterial(object.id, {\n          color: normalized,\n          paintTexture: updatedTexture\n        });\n      })\n      .catch(() => undefined);\n  };`,
    'Grundfarbe aus Paint-Layern neu aufbauen'
  );

  return source;
});

await update('src/editor/paint/useSurfacePaintGrid.ts', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  loadSurfaceCanvases,\n  resizeSurfaceCanvases,`,
    `  loadSurfaceCanvases,\n  PAINT_BASE_ALPHA,\n  resizeSurfaceCanvases,`,
    'Viewport Grundfarben-Marker Import'
  );

  source = replaceOnce(
    source,
    `  const loadedDataUrlRef = useRef<string | null | undefined>(undefined);\n  const requestedDataUrlRef`,
    `  const loadedDataUrlRef = useRef<string | null | undefined>(undefined);\n  const loadedBaseColorRef = useRef<string | undefined>(undefined);\n  const requestedDataUrlRef`,
    'Geladene Grundfarbe merken'
  );

  source = replaceOnce(
    source,
    `    loadedDataUrlRef.current = data.dataUrl;\n    requestedDataUrlRef.current = undefined;`,
    `    loadedDataUrlRef.current = data.dataUrl;\n    loadedBaseColorRef.current = object.material.color.toUpperCase();\n    requestedDataUrlRef.current = undefined;`,
    'Persistierte Grundfarbe merken'
  );

  source = replaceOnce(
    source,
    `  useEffect(() => {\n    const dataUrl = paintTexture?.dataUrl ?? null;\n    const externalTextureUpdate`,
    `  useEffect(() => {\n    const dataUrl = paintTexture?.dataUrl ?? null;\n    const baseColor = object.material.color.toUpperCase();\n    const externalTextureUpdate`,
    'Load-Effekt Grundfarbe'
  );

  source = replaceOnce(
    source,
    `    if (surface.layers.length > 0 && loadedDataUrlRef.current === dataUrl) return;`,
    `    if (\n      surface.layers.length > 0\n      && loadedDataUrlRef.current === dataUrl\n      && loadedBaseColorRef.current === baseColor\n    ) return;`,
    'Load-Effekt Grundfarbenvergleich'
  );

  source = replaceOnce(
    source,
    `        loadedDataUrlRef.current = dataUrl;\n\n        if (paintTexture) {`,
    `        loadedDataUrlRef.current = dataUrl;\n        loadedBaseColorRef.current = baseColor;\n\n        if (paintTexture) {`,
    'Geladene Grundfarbe setzen'
  );

  source = replaceOnce(
    source,
    `          const needsMigration = !currentGrid\n            || currentGrid.atlasSignature !== atlas.signature`,
    `          const needsMigration = !currentGrid\n            || currentGrid.version !== 2\n            || currentGrid.atlasSignature !== atlas.signature`,
    'Viewport Version-2-Migration'
  );

  source = replaceOnce(
    source,
    `          : hexToRgba(object.material.color)\n        : hexToRgba(settings.color);`,
    `          : hexToRgba(object.material.color, PAINT_BASE_ALPHA)\n        : hexToRgba(settings.color);`,
    'Viewport Radierer Grundfarben-Marker'
  );

  return source;
});

await update('src/components/panels/TexturePaintEditor.tsx', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  loadSurfaceCanvases,\n  resizeSurfaceCanvases,`,
    `  loadSurfaceCanvases,\n  PAINT_BASE_ALPHA,\n  resizeSurfaceCanvases,`,
    'Editor Grundfarben-Marker Import'
  );

  source = replaceOnce(
    source,
    `          !storedGrid\n          || storedGrid.atlasSignature !== atlas.signature`,
    `          !storedGrid\n          || storedGrid.version !== 2\n          || storedGrid.atlasSignature !== atlas.signature`,
    'Editor Version-2-Migration'
  );

  source = replaceOnce(
    source,
    `          : hexToRgba(baseColor)\n        : hexToRgba(paintColor);`,
    `          : hexToRgba(baseColor, PAINT_BASE_ALPHA)\n        : hexToRgba(paintColor);`,
    'Editor Radierer Grundfarben-Marker'
  );

  return source;
});

await update('tests/surfacePaintGrid.test.ts', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  getSurfaceRasterMetrics,\n  surfaceUvWindow`,
    `  getSurfaceRasterMetrics,\n  PAINT_BASE_ALPHA,\n  recolorSurfaceBasePixels,\n  surfaceUvWindow`,
    'SurfacePaintGrid Testimporte'
  );

  const addition = `\n\n  it('ändert in Version 2 nur markierte Grundfarbenpixel', () => {\n    const image: ImageData = {\n      data: new Uint8ClampedArray([\n        0x11, 0x22, 0x33, PAINT_BASE_ALPHA,\n        0x11, 0x22, 0x33, 255\n      ]),\n      width: 2,\n      height: 1,\n      colorSpace: 'srgb'\n    };\n\n    recolorSurfaceBasePixels(image, '#112233', '#445566', 2);\n\n    expect([...image.data.slice(0, 4)]).toEqual([0x44, 0x55, 0x66, PAINT_BASE_ALPHA]);\n    expect([...image.data.slice(4, 8)]).toEqual([0x11, 0x22, 0x33, 255]);\n  });\n\n  it('migriert alte Grundfarbenpixel auf den eindeutigen Marker', () => {\n    const image: ImageData = {\n      data: new Uint8ClampedArray([\n        0x11, 0x22, 0x33, 255,\n        0xAA, 0xBB, 0xCC, 255\n      ]),\n      width: 2,\n      height: 1,\n      colorSpace: 'srgb'\n    };\n\n    recolorSurfaceBasePixels(image, '#112233', '#445566', 1);\n\n    expect([...image.data.slice(0, 4)]).toEqual([0x44, 0x55, 0x66, PAINT_BASE_ALPHA]);\n    expect([...image.data.slice(4, 8)]).toEqual([0xAA, 0xBB, 0xCC, 255]);\n  });`;

  if (!source.includes("ändert in Version 2 nur markierte Grundfarbenpixel")) {
    const closing = source.lastIndexOf('\n});');
    if (closing < 0) throw new Error('Testabschluss fehlt');
    source = `${source.slice(0, closing)}${addition}${source.slice(closing)}`;
  }

  return source;
});

console.log('Grundfarben-/Bemalungs-Fix angewendet.');
