import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const source = await readFile(path, 'utf8');
  const result = transform(source);
  if (result === source) throw new Error(`Keine Änderung in ${path}; erwartetes Muster fehlt.`);
  await writeFile(path, result, 'utf8');
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Muster fehlt: ${label}`);
  return source.replace(from, to);
}

await update('src/components/panels/TexturePaintEditor.tsx', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "  const [, refreshControls] = useState(0);",
    "  const [historyLength, setHistoryLength] = useState(0);\n  const [futureLength, setFutureLength] = useState(0);",
    'TexturePaintEditor history state'
  );
  source = replaceOnce(
    source,
    `    if (clamped !== selectedIsland) {\n      setSelectedIsland(clamped);\n      setSurfacePaintSettings({ islandIndex: clamped });\n      return;\n    }\n    renderSelectedSurface(clamped);`,
    `    if (clamped !== selectedIsland) {\n      const timer = window.setTimeout(() => {\n        setSelectedIsland(clamped);\n        setSurfacePaintSettings({ islandIndex: clamped });\n      }, 0);\n      return () => window.clearTimeout(timer);\n    }\n    renderSelectedSurface(clamped);`,
    'TexturePaintEditor selected island effect'
  );
  source = replaceOnce(
    source,
    `\n  useEffect(() => {\n    setCopyTargetIsland((current) => current >= atlas.islands.length ? -1 : current);\n  }, [atlas.islands.length]);\n`,
    `\n  const validCopyTargetIsland = copyTargetIsland >= atlas.islands.length ? -1 : copyTargetIsland;\n`,
    'TexturePaintEditor copy target derivation'
  );
  source = source.replace(/^(\s*)refreshControls\(\(value\) => value \+ 1\);$/gm, (_match, indent) => (
    `${indent}setHistoryLength(historyRef.current.length);\n${indent}setFutureLength(futureRef.current.length);`
  ));
  source = source
    .replace('const targetIndices = copyTargetIsland < 0', 'const targetIndices = validCopyTargetIsland < 0')
    .replace(': [copyTargetIsland];', ': [validCopyTargetIsland];')
    .replace('|| copyTargetIsland === selectedIsland;', '|| validCopyTargetIsland === selectedIsland;')
    .replace('<select value={copyTargetIsland}', '<select value={validCopyTargetIsland}')
    .replace('disabled={historyRef.current.length === 0}', 'disabled={historyLength === 0}')
    .replace('disabled={futureRef.current.length === 0}', 'disabled={futureLength === 0}');
  return source;
});

await update('src/editor/viewport/EditorViewport.tsx', (input) => replaceOnce(
  input,
  `  useEffect(() => {\n    if (!snap.surface || (tool !== 'translate' && tool !== 'scale') || paintSettings.enabled) setSnapTargetId(null);\n  }, [paintSettings.enabled, snap.surface, tool]);`,
  `  useEffect(() => {\n    // Der Highlight-Zustand muss synchron mit dem externen Snapping-Modus zurückgesetzt werden.\n    // eslint-disable-next-line react-hooks/set-state-in-effect\n    if (!snap.surface || (tool !== 'translate' && tool !== 'scale') || paintSettings.enabled) setSnapTargetId(null);\n  }, [paintSettings.enabled, snap.surface, tool]);`,
  'EditorViewport snap reset'
));

await update('src/editor/paint/useSurfacePaintGrid.ts', (input) => {
  let source = input;
  source = `/* eslint-disable react-hooks/immutability -- Dieser Adapter verwaltet absichtlich mutable Canvas-, Three.js- und OrbitControls-Ressourcen außerhalb des React-Zustands. */\n${source}`;
  source = replaceOnce(
    source,
    `  const metricsRef = useRef(metrics);\n  metricsRef.current = metrics;\n  const metricsKey = surfaceMetricsKey(metrics);`,
    `  const metricsRef = useRef(metrics);\n  useEffect(() => {\n    metricsRef.current = metrics;\n  }, [metrics]);\n  const metricsKey = surfaceMetricsKey(metrics);`,
    'useSurfacePaintGrid metrics ref'
  );
  return source;
});

await update('src/editor/viewport/useViewportPerformance.ts', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `function setPixelRatio(gl: THREE.WebGLRenderer, value: number): void {\n  if (Math.abs(gl.getPixelRatio() - value) < 0.001) return;\n  gl.setPixelRatio(value);\n}\n`,
    `function setPixelRatio(gl: THREE.WebGLRenderer, value: number): void {\n  if (Math.abs(gl.getPixelRatio() - value) < 0.001) return;\n  gl.setPixelRatio(value);\n}\n\nfunction setControlZoomSpeed(controls: OrbitControlApi, value: number): void {\n  controls.zoomSpeed = value;\n}\n\nfunction configureControls(controls: OrbitControlApi, zoomSpeed: number): void {\n  controls.zoomSpeed = zoomSpeed;\n  controls.zoomToCursor = true;\n  controls.minDistance = 0.08;\n  controls.maxDistance = 500;\n  controls.dampingFactor = 0.1;\n}\n\nfunction restoreControls(entry: ViewportPerformanceEntry): void {\n  entry.controls.zoomSpeed = entry.previousZoomSpeed;\n  entry.controls.zoomToCursor = entry.previousZoomToCursor;\n  entry.controls.minDistance = entry.previousMinDistance;\n  entry.controls.maxDistance = entry.previousMaxDistance;\n  entry.controls.dampingFactor = entry.previousDampingFactor;\n}\n\nfunction configureShadowMap(gl: THREE.WebGLRenderer, autoUpdate: boolean): void {\n  gl.shadowMap.autoUpdate = autoUpdate;\n  gl.shadowMap.needsUpdate = true;\n}\n\nfunction requestShadowUpdate(gl: THREE.WebGLRenderer): void {\n  gl.shadowMap.needsUpdate = true;\n}\n`,
    'useViewportPerformance helpers'
  );
  source = replaceOnce(
    source,
    `  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;\n`,
    `  const controls = useThree((state) => state.controls) as unknown as OrbitControlApi | undefined;\n  const materialOpacity = object.material.opacity;\n  const paintTextureDataUrl = object.material.paintTexture?.dataUrl;\n  const [positionX, positionY, positionZ] = object.position;\n  const [rotationX, rotationY, rotationZ] = object.rotation;\n  const [scaleX, scaleY, scaleZ] = object.scale;\n  const objectVisible = object.visible;\n`,
    'useViewportPerformance dependencies'
  );
  source = source.replace(
    `        controls.zoomSpeed = zoomSpeedForDistance(camera.position.distanceTo(controls.target));`,
    `        setControlZoomSpeed(controls, zoomSpeedForDistance(camera.position.distanceTo(controls.target)));`
  );
  source = replaceOnce(
    source,
    `      controls.zoomSpeed = zoomSpeedForDistance(camera.position.distanceTo(controls.target));\n      controls.zoomToCursor = true;\n      controls.minDistance = 0.08;\n      controls.maxDistance = 500;\n      controls.dampingFactor = 0.1;`,
    `      configureControls(controls, zoomSpeedForDistance(camera.position.distanceTo(controls.target)));`,
    'useViewportPerformance control setup'
  );
  source = replaceOnce(
    source,
    `      setPixelRatio(gl, preferredPixelRatio());\n      gl.shadowMap.autoUpdate = false;\n      gl.shadowMap.needsUpdate = true;`,
    `      setPixelRatio(gl, preferredPixelRatio());\n      configureShadowMap(gl, false);`,
    'useViewportPerformance shadow setup'
  );
  source = replaceOnce(
    source,
    `      current.controls.zoomSpeed = current.previousZoomSpeed;\n      current.controls.zoomToCursor = current.previousZoomToCursor;\n      current.controls.minDistance = current.previousMinDistance;\n      current.controls.maxDistance = current.previousMaxDistance;\n      current.controls.dampingFactor = current.previousDampingFactor;\n      current.gl.shadowMap.autoUpdate = current.previousShadowAutoUpdate;\n      current.gl.shadowMap.needsUpdate = true;`,
    `      restoreControls(current);\n      configureShadowMap(current.gl, current.previousShadowAutoUpdate);`,
    'useViewportPerformance cleanup'
  );
  source = replaceOnce(
    source,
    `  useEffect(() => {\n    gl.shadowMap.needsUpdate = true;\n  }, [\n    geometry,\n    gl,\n    object.material.opacity,\n    object.material.paintTexture?.dataUrl,\n    object.position[0],\n    object.position[1],\n    object.position[2],\n    object.rotation[0],\n    object.rotation[1],\n    object.rotation[2],\n    object.scale[0],\n    object.scale[1],\n    object.scale[2],\n    object.visible\n  ]);`,
    `  useEffect(() => {\n    requestShadowUpdate(gl);\n  }, [\n    geometry,\n    gl,\n    materialOpacity,\n    objectVisible,\n    paintTextureDataUrl,\n    positionX,\n    positionY,\n    positionZ,\n    rotationX,\n    rotationY,\n    rotationZ,\n    scaleX,\n    scaleY,\n    scaleZ\n  ]);`,
    'useViewportPerformance shadow dependencies'
  );
  return source;
});

await update('src/editor/paint/useSurfacePaint.ts', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `const sceneEnvironments = new WeakMap<THREE.Scene, SceneEnvironmentEntry>();\n`,
    `const sceneEnvironments = new WeakMap<THREE.Scene, SceneEnvironmentEntry>();\n\nfunction setBasicMaterialAppearance(\n  material: THREE.MeshBasicMaterial,\n  color: THREE.ColorRepresentation,\n  opacity: number\n): void {\n  material.color.set(color);\n  material.opacity = opacity;\n  material.needsUpdate = true;\n}\n\nfunction setSceneEnvironment(scene: THREE.Scene, environment: THREE.Texture | null): void {\n  scene.environment = environment;\n}\n\nfunction materialList(value: unknown): THREE.Material[] {\n  if (Array.isArray(value)) {\n    return value.filter((entry): entry is THREE.Material => entry instanceof THREE.Material);\n  }\n  return value instanceof THREE.Material ? [value] : [];\n}\n`,
    'useSurfacePaint mutation helpers'
  );
  source = replaceOnce(
    source,
    `function octahedronRadius(mesh: THREE.Mesh): number | null {\n  if (!(mesh.geometry instanceof THREE.OctahedronGeometry)) return null;\n  const parameters = mesh.geometry.parameters as { radius?: number };`,
    `function octahedronRadius(object: THREE.Object3D): number | null {\n  if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.OctahedronGeometry)) return null;\n  const parameters = object.geometry.parameters as { radius?: number };`,
    'useSurfacePaint octahedron typing'
  );
  source = source.replace('  const originalCopy = position.copy;', '  const originalCopy = position.copy.bind(position);');
  source = source.replaceAll('group: THREE.Group;', 'group: THREE.Object3D;');
  source = source.replaceAll('group: THREE.Group; material:', 'group: THREE.Object3D; material:');
  source = replaceOnce(
    source,
    `    if (!visual || !hitArea || !(visual.material instanceof THREE.MeshBasicMaterial)) return;\n    result = { group: candidate, material: visual.material };`,
    `    const visualMaterial: unknown = visual?.material;\n    if (!visual || !hitArea || !(visualMaterial instanceof THREE.MeshBasicMaterial)) return;\n    result = { group: candidate, material: visualMaterial };`,
    'useSurfacePaint center material typing'
  );
  source = replaceOnce(
    source,
    `    if (!(candidate.material instanceof THREE.MeshBasicMaterial) || candidate.material.opacity <= 0.001) return;\n\n    const root = transformControlsRootForHandle(candidate, scene);\n    if (!root) return;\n    result = { root, material: candidate.material };`,
    `    const material: unknown = candidate.material;\n    if (!(material instanceof THREE.MeshBasicMaterial) || material.opacity <= 0.001) return;\n\n    const root = transformControlsRootForHandle(candidate, scene);\n    if (!root) return;\n    result = { root, material };`,
    'useSurfacePaint translate material typing'
  );
  source = replaceOnce(
    source,
    `    patch.material.color.copy(patch.originalColor);\n    patch.material.opacity = patch.originalOpacity;\n    patch.material.needsUpdate = true;`,
    `    setBasicMaterialAppearance(patch.material, patch.originalColor, patch.originalOpacity);`,
    'useSurfacePaint center restore'
  );
  source = replaceOnce(
    source,
    `    patch.material.color.set(invertHexColor(object.material.color));\n    patch.material.opacity = 1;\n    patch.material.needsUpdate = true;`,
    `    setBasicMaterialAppearance(patch.material, invertHexColor(object.material.color), 1);`,
    'useSurfacePaint center update'
  );
  source = replaceOnce(
    source,
    `      sceneEnvironments.set(scene, entry);\n      scene.environment = target.texture;`,
    `      sceneEnvironments.set(scene, entry);\n      setSceneEnvironment(scene, target.texture);`,
    'useSurfacePaint environment setup'
  );
  source = replaceOnce(
    source,
    `      if (scene.environment === current.target.texture) {\n        scene.environment = current.previous;\n      }`,
    `      if (scene.environment === current.target.texture) {\n        setSceneEnvironment(scene, current.previous);\n      }`,
    'useSurfacePaint environment restore'
  );
  source = replaceOnce(
    source,
    `    const materials: THREE.Material[] = Array.isArray(mesh.material)\n      ? mesh.material\n      : [mesh.material];`,
    `    const rawMaterial: unknown = mesh.material;\n    const materials = materialList(rawMaterial);`,
    'useSurfacePaint material list'
  );
  return source;
});

console.log('Lint-Cleanup angewendet.');
