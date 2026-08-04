import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/editor/paint/useSurfacePaint.ts';
const source = await readFile(path, 'utf8');
const before = `function materialList(value: unknown): THREE.Material[] {\n  if (Array.isArray(value)) {\n    return value.filter((entry): entry is THREE.Material => entry instanceof THREE.Material);\n  }\n  return value instanceof THREE.Material ? [value] : [];\n}`;
const after = `function isMaterial(value: unknown): value is THREE.Material {\n  return value instanceof THREE.Material;\n}\n\nfunction materialList(value: unknown): THREE.Material[] {\n  if (Array.isArray(value)) {\n    const entries: unknown[] = value;\n    return entries.filter(isMaterial);\n  }\n  return isMaterial(value) ? [value] : [];\n}`;

if (source.includes(before)) {
  await writeFile(path, source.replace(before, after), 'utf8');
  console.log('Material-Typisierung korrigiert.');
} else if (source.includes(after)) {
  console.log('Material-Typisierung bereits korrigiert.');
} else {
  throw new Error('Erwartete Material-Hilfsfunktion nicht gefunden.');
}
