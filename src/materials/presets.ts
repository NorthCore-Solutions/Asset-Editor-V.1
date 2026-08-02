import type { MaterialData } from '../types/editor';

export const NORTHCORE_COLORS = ['#11161A', '#1A2126', '#232C32', '#4F8F68', '#72B98A', '#AEB8BE', '#EDF2F4', '#D8A657', '#C96A6A'];
export const LOW_POLY_COLORS = ['#E8C07D', '#A66A3F', '#6D8B74', '#5C7AEA', '#C06C84', '#F2A65A', '#7B6D8D', '#91C7B1', '#D6D1B1', '#8A9A5B'];

export const MATERIAL_PRESETS: Record<string, MaterialData> = {
  'Holz hell': { color: '#B98555', roughness: 0.82, metalness: 0, opacity: 1, flatShading: true },
  'Holz dunkel': { color: '#5B3825', roughness: 0.88, metalness: 0, opacity: 1, flatShading: true },
  Metall: { color: '#8E9AA1', roughness: 0.28, metalness: 0.82, opacity: 1, flatShading: false },
  Kunststoff: { color: '#4F8F68', roughness: 0.45, metalness: 0.05, opacity: 1, flatShading: false },
  Glas: { color: '#A9D8E6', roughness: 0.08, metalness: 0, opacity: 0.32, flatShading: false },
  Stein: { color: '#7E807C', roughness: 0.94, metalness: 0, opacity: 1, flatShading: true },
  Beton: { color: '#A5A5A0', roughness: 0.96, metalness: 0, opacity: 1, flatShading: true },
  Ziegel: { color: '#9A4E3D', roughness: 0.92, metalness: 0, opacity: 1, flatShading: true },
  Gras: { color: '#5F8D4E', roughness: 1, metalness: 0, opacity: 1, flatShading: true },
  Erde: { color: '#6F4E37', roughness: 1, metalness: 0, opacity: 1, flatShading: true }
};
