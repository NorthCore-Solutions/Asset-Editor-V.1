import * as THREE from 'three';

type PatchedRendererPrototype = THREE.WebGLRenderer & {
  __northcoreSoftScaleHandleZoom?: boolean;
};

const approximately = (value: number | undefined, expected: number): boolean =>
  typeof value === 'number' && Math.abs(value - expected) < 0.0001;

const projectionFactor = (camera: THREE.Camera, worldPosition: THREE.Vector3): number => {
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const orthographic = camera as THREE.OrthographicCamera;
    return Math.max(0.001, (orthographic.top - orthographic.bottom) / orthographic.zoom);
  }

  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera;
    const cameraPosition = perspective.getWorldPosition(new THREE.Vector3());
    return Math.max(
      0.001,
      worldPosition.distanceTo(cameraPosition)
        * Math.min(1.9 * Math.tan(Math.PI * perspective.fov / 360) / perspective.zoom, 7)
    );
  }

  return Math.max(0.001, worldPosition.distanceTo(camera.getWorldPosition(new THREE.Vector3())));
};

const softenedZoom = (camera: THREE.Camera, object: THREE.Object3D): number => {
  const worldPosition = object.getWorldPosition(new THREE.Vector3());
  return Math.pow(projectionFactor(camera, worldPosition), 0.6);
};

const axisHandleScale = (zoom: number): number =>
  THREE.MathUtils.clamp(zoom * 0.026, 0.045, 0.18);

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
  if (!(parent instanceof THREE.Group) || parent.children.length !== 2) return null;

  const radii = parent.children
    .map(octahedronRadius)
    .sort((left, right) => (left ?? 0) - (right ?? 0));

  return radii.length === 2 && approximately(radii[0], 0.1) && approximately(radii[1], 0.2)
    ? parent
    : null;
};

const prototype = THREE.WebGLRenderer.prototype as PatchedRendererPrototype;

if (!prototype.__northcoreSoftScaleHandleZoom) {
  const originalRender = prototype.render;

  prototype.render = function renderWithSoftScaleHandles(
    this: THREE.WebGLRenderer,
    scene: THREE.Object3D,
    camera: THREE.Camera
  ): void {
    const processedCenters = new Set<THREE.Group>();

    scene.traverse((object) => {
      if (isAxisScaleHandle(object)) {
        object.scale.setScalar(axisHandleScale(softenedZoom(camera, object)));
        return;
      }

      if (isCornerScaleHandle(object)) {
        const zoom = softenedZoom(camera, object);
        object.scale.setScalar(THREE.MathUtils.clamp(zoom * 0.034, 0.07, 0.24));
        return;
      }

      const center = centerScaleHandleContainer(object);
      if (!center || processedCenters.has(center)) return;
      processedCenters.add(center);

      const zoom = softenedZoom(camera, center);
      const axisScale = axisHandleScale(zoom);

      // Achsenpunkt: Boxbreite 0.72. Mittelpunkt: Oktaederdurchmesser 0.20.
      // Faktor 3.6 erzeugt dadurch dieselbe sichtbare Breite.
      center.scale.setScalar(axisScale * 3.6);
    });

    originalRender.call(this, scene, camera);
  };

  prototype.__northcoreSoftScaleHandleZoom = true;
}
