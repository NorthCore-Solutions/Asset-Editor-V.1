import * as THREE from 'three';
import type { PrimitiveType, SceneObjectData } from '../types/editor';

const DEFAULT_MATERIAL = { color: '#AEB8BE', roughness: 0.8, metalness: 0, opacity: 1, flatShading: true } as const;

export const SHAPE_DEFINITIONS: Array<{ type: PrimitiveType; label: string; category: 'Grundformen' | 'Gebäude' }> = [
  { type: 'box', label: 'Würfel', category: 'Grundformen' },
  { type: 'cuboid', label: 'Quader', category: 'Grundformen' },
  { type: 'sphere', label: 'Kugel', category: 'Grundformen' },
  { type: 'hemisphere', label: 'Halbkugel', category: 'Grundformen' },
  { type: 'cylinder', label: 'Zylinder', category: 'Grundformen' },
  { type: 'cone', label: 'Kegel', category: 'Grundformen' },
  { type: 'pyramid', label: 'Pyramide', category: 'Grundformen' },
  { type: 'plane', label: 'Ebene', category: 'Grundformen' },
  { type: 'torus', label: 'Torus', category: 'Grundformen' },
  { type: 'wedge', label: 'Keil', category: 'Grundformen' },
  { type: 'prism', label: 'Prisma', category: 'Grundformen' },
  { type: 'wall', label: 'Wand', category: 'Gebäude' },
  { type: 'floor', label: 'Bodenplatte', category: 'Gebäude' },
  { type: 'flatRoof', label: 'Flachdach', category: 'Gebäude' },
  { type: 'gableRoof', label: 'Satteldach', category: 'Gebäude' },
  { type: 'shedRoof', label: 'Pultdach', category: 'Gebäude' },
  { type: 'door', label: 'Tür', category: 'Gebäude' },
  { type: 'window', label: 'Fenster', category: 'Gebäude' },
  { type: 'column', label: 'Säule', category: 'Gebäude' },
  { type: 'chimney', label: 'Schornstein', category: 'Gebäude' },
  { type: 'stairs', label: 'Treppe', category: 'Gebäude' }
];

const defaultGeometry = (type: PrimitiveType): Record<string, number> => {
  switch (type) {
    case 'sphere': return { radius: 0.65, widthSegments: 24, heightSegments: 16 };
    case 'hemisphere': return { radius: 0.75, widthSegments: 24, heightSegments: 12 };
    case 'cylinder': return { radiusTop: 0.5, radiusBottom: 0.5, height: 1.4, radialSegments: 20 };
    case 'cone': return { radius: 0.65, height: 1.5, radialSegments: 20 };
    case 'pyramid': return { radius: 0.8, height: 1.5, radialSegments: 4 };
    case 'plane': return { width: 2, height: 2 };
    case 'torus': return { radius: 0.65, tube: 0.22, radialSegments: 12, tubularSegments: 32 };
    case 'prism': return { width: 1.6, height: 1.2, depth: 1.8 };
    case 'wall': return { width: 3, height: 2.5, depth: 0.2 };
    case 'floor': return { width: 3, height: 0.2, depth: 3 };
    case 'flatRoof': return { width: 3.4, height: 0.25, depth: 3.4 };
    case 'gableRoof': return { width: 3.4, height: 1.2, depth: 3.4 };
    case 'shedRoof': return { width: 3.4, height: 0.9, depth: 3.4 };
    case 'door': return { width: 0.9, height: 2, depth: 0.15 };
    case 'window': return { width: 1.2, height: 1, depth: 0.12 };
    case 'column': return { radiusTop: 0.3, radiusBottom: 0.36, height: 2.5, radialSegments: 16 };
    case 'chimney': return { width: 0.55, height: 1.7, depth: 0.55 };
    case 'stairs': return { width: 2, height: 1.4, depth: 1.6, steps: 5 };
    case 'cuboid': return { width: 2, height: 1, depth: 1 };
    case 'wedge': return { width: 1.5, height: 1, depth: 1.5 };
    default: return { width: 1, height: 1, depth: 1 };
  }
};

const defaultPosition = (type: PrimitiveType): [number, number, number] => {
  const y: Partial<Record<PrimitiveType, number>> = { sphere: 0.65, hemisphere: 0, cylinder: 0.7, cone: 0.75, pyramid: 0.75, plane: 0.002, torus: 0.9, wedge: 0, prism: 0, wall: 1.25, floor: 0.1, flatRoof: 3, gableRoof: 3.1, shedRoof: 3, door: 1, window: 1.4, column: 1.25, chimney: 0.85, stairs: 0 };
  return [0, y[type] ?? 0.5, 0];
};

export function createSceneObject(type: PrimitiveType, existingIds: string[] = []): SceneObjectData {
  let id = crypto.randomUUID();
  while (existingIds.includes(id)) id = crypto.randomUUID();
  const label = SHAPE_DEFINITIONS.find((item) => item.type === type)?.label ?? type;
  return {
    id, name: label, type, visible: true, locked: false,
    position: defaultPosition(type), rotation: [0, 0, 0], scale: [1, 1, 1],
    geometry: defaultGeometry(type), material: { ...DEFAULT_MATERIAL }
  };
}

function wedgeGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const w = width / 2; const d = depth / 2;
  const vertices = new Float32Array([
    -w,0,-d,  w,0,-d,  w,0,d, -w,0,d,
    -w,height,d, w,height,d
  ]);
  const indices = [0,1,2, 0,2,3, 3,2,5, 3,5,4, 0,3,4, 0,4,1, 1,4,5, 1,5,2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}


function prismGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const w = width / 2; const d = depth / 2;
  const vertices = new Float32Array([
    -w,0,-d, w,0,-d, 0,height,-d,
    -w,0,d, w,0,d, 0,height,d
  ]);
  const indices = [0,1,2, 3,5,4, 0,3,4, 0,4,1, 2,1,4, 2,4,5, 0,2,5, 0,5,3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function stairsGeometry(width: number, height: number, depth: number, steps: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const stepWidth = width / steps; const stepHeight = height / steps;
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  for (let index = steps - 1; index >= 0; index -= 1) {
    shape.lineTo(-width / 2 + index * stepWidth, (index + 1) * stepHeight);
    shape.lineTo(-width / 2 + index * stepWidth, index * stepHeight);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function roofGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const w = width / 2; const d = depth / 2;
  const vertices = new Float32Array([
    -w,0,-d, w,0,-d, w,0,d, -w,0,d,
    0,height,-d, 0,height,d
  ]);
  const indices = [0,1,4, 3,5,2, 0,4,5, 0,5,3, 1,2,5, 1,5,4, 0,3,2, 0,2,1];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createGeometry(object: Pick<SceneObjectData, 'type' | 'geometry'>): THREE.BufferGeometry {
  const g = object.geometry;
  switch (object.type) {
    case 'sphere': return new THREE.SphereGeometry(g.radius ?? 0.65, g.widthSegments ?? 24, g.heightSegments ?? 16);
    case 'hemisphere': return new THREE.SphereGeometry(g.radius ?? 0.75, g.widthSegments ?? 24, g.heightSegments ?? 12, 0, Math.PI * 2, 0, Math.PI / 2);
    case 'cylinder': return new THREE.CylinderGeometry(g.radiusTop ?? 0.5, g.radiusBottom ?? 0.5, g.height ?? 1.4, g.radialSegments ?? 20);
    case 'cone': return new THREE.ConeGeometry(g.radius ?? 0.65, g.height ?? 1.5, g.radialSegments ?? 20);
    case 'pyramid': { const geometry = new THREE.ConeGeometry(g.radius ?? 0.8, g.height ?? 1.5, 4); geometry.rotateY(Math.PI / 4); return geometry; }
    case 'plane': { const geometry = new THREE.PlaneGeometry(g.width ?? 2, g.height ?? 2); geometry.rotateX(-Math.PI / 2); return geometry; }
    case 'torus': return new THREE.TorusGeometry(g.radius ?? 0.65, g.tube ?? 0.22, g.radialSegments ?? 12, g.tubularSegments ?? 32);
    case 'wedge': return wedgeGeometry(g.width ?? 1.5, g.height ?? 1, g.depth ?? 1.5);
    case 'prism': return prismGeometry(g.width ?? 1.6, g.height ?? 1.2, g.depth ?? 1.8);
    case 'gableRoof': return roofGeometry(g.width ?? 3.4, g.height ?? 1.2, g.depth ?? 3.4);
    case 'shedRoof': return wedgeGeometry(g.width ?? 3.4, g.height ?? 0.9, g.depth ?? 3.4);
    case 'column': return new THREE.CylinderGeometry(g.radiusTop ?? 0.3, g.radiusBottom ?? 0.36, g.height ?? 2.5, g.radialSegments ?? 16);
    case 'stairs': return stairsGeometry(g.width ?? 2, g.height ?? 1.4, g.depth ?? 1.6, Math.max(2, Math.round(g.steps ?? 5)));
    case 'cuboid': case 'wall': case 'floor': case 'flatRoof': case 'door': case 'window': case 'chimney':
      return new THREE.BoxGeometry(g.width ?? 1, g.height ?? 1, g.depth ?? 1);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function triangleCount(object: Pick<SceneObjectData, 'type' | 'geometry'>): number {
  const geometry = createGeometry(object);
  const count = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
  geometry.dispose();
  return Math.round(count);
}
