import * as THREE from 'three';

type PatchedRendererPrototype = THREE.WebGLRenderer & {
  __northcoreLinearScaleHandles?: boolean;
};

const approximately = (value: number | undefined, expected: number): boolean =>
  typeof value === 'number' && Math.abs(value - expected) < 0.0001;

const isAxisScaleHandle = (object: THREE.Object3D): object is THREE.Mesh => {
  if (!(object instanceof THREE.Mesh) || object.renderOrder !== 1000) return false;
  const geometry = object.geometry as THREE.BoxGeometry;
  const parameters = geometry.parameters;
  return geometry.type === 'BoxGeometry'
    && approximately(parameters?.width, 0.72)
    && approximately(parameters?.height, 0.72)
    && approximately(parameters?.depth, 0.72);
};

const isCornerScaleHandle = (object: THREE.Object3D): object is THREE.Mesh => {
  if (!(object instanceof THREE.Mesh) || object.renderOrder !== 1001) return false;
  const geometry = object.geometry as THREE.PlaneGeometry;
  const parameters = geometry.parameters;
  return geometry.type === 'PlaneGeometry'
    && approximately(parameters?.width, 1.05)
    && approximately(parameters?.height, 1.05);
};

const octahedronRadius = (object: THREE.Object3D): number | undefined => {
  if (!(object instanceof THREE.Mesh)) return undefined;
  const geometry = object.geometry as THREE.OctahedronGeometry;
  return geometry.type === 'OctahedronGeometry' ? geometry.parameters?.radius : undefined;
};

const centerScaleHandleContainer = (object: THREE.Object3D): THREE.Group | null => {
  const radius = octahedronRadius(object);
  if (!approximately(radius, 0.1) && !approximately(radius, 0.2)) return null;

  const parent = object.parent;
  if (!(parent instanceof THREE.Group)) return null;

  const radii = parent.children
    .map(octahedronRadius)
    .filter((value): value is number => typeof value === 'number')
    .sort((left, right) => left - right);

  return radii.length === 2 && approximately(radii[0], 0.1) && approximately(radii[1], 0.2)
    ? parent
    : null;
};

const selectedObjectScale = (scene: THREE.Object3D): number => {
  let selectedMesh: THREE.Mesh | null = null;

  scene.traverse((object) => {
    if (selectedMesh || !(object instanceof THREE.Mesh)) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const selected = materials.some((material) =>
      material instanceof THREE.MeshStandardMaterial
      && material.emissiveIntensity >= 0.7
      && material.emissive.getHexString().toLowerCase() === '24603d'
    );

    if (selected) selectedMesh = object;
  });

  if (!selectedMesh) return 1;

  const scale = (selectedMesh as THREE.Mesh).scale;
  return Math.max(0.001, (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3);
};

const prototype = THREE.WebGLRenderer.prototype as PatchedRendererPrototype;

if (!prototype.__northcoreLinearScaleHandles) {
  const originalRender = prototype.render;

  prototype.render = function renderWithLinearScaleHandles(
    this: THREE.WebGLRenderer,
    scene: THREE.Object3D,
    camera: THREE.Camera
  ): void {
    const formScale = selectedObjectScale(scene);
    const axisScale = 0.075 * formScale;
    const cornerScale = 0.06 * formScale;
    const centerScale = 0.27 * formScale;
    const processedCenters = new Set<THREE.Group>();

    scene.traverse((object) => {
      if (isAxisScaleHandle(object)) {
        object.scale.setScalar(axisScale);
        return;
      }

      if (isCornerScaleHandle(object)) {
        object.scale.setScalar(cornerScale);
        return;
      }

      const center = centerScaleHandleContainer(object);
      if (!center || processedCenters.has(center)) return;
      processedCenters.add(center);
      center.scale.setScalar(centerScale);
    });

    originalRender.call(this, scene, camera);
  };

  prototype.__northcoreLinearScaleHandles = true;
}
