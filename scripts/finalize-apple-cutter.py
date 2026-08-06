from pathlib import Path


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


import_path = Path('src/editor/snapping/importComponentAnalysis.ts')
source = import_path.read_text(encoding='utf-8')
if 'interface ComponentDefinition {\n  key: string;' not in source:
    source = source.replace(
        'interface ComponentDefinition {\n  order: number;\n  parts: THREE.BufferGeometry[];\n}',
        'interface ComponentDefinition {\n  key: string;\n  order: number;\n  parts: THREE.BufferGeometry[];\n}'
    )
if 'interface DirectPart {\n  key: string;' not in source:
    source = source.replace(
        'interface DirectPart {\n  order: number;',
        'interface DirectPart {\n  key: string;\n  order: number;'
    )
if 'key: [...new Set(group.map((part) => part.key))]' not in source:
    source = source.replace(
        '  return [...groups.values()].map((group) => ({\n'
        '    order: Math.min(...group.map((part) => part.order)),\n'
        '    parts: group.map((part) => part.geometry)\n'
        '  }));',
        '  return [...groups.values()].map((group) => ({\n'
        "    key: [...new Set(group.map((part) => part.key))].sort().join('+'),\n"
        '    order: Math.min(...group.map((part) => part.order)),\n'
        '    parts: group.map((part) => part.geometry)\n'
        '  }));'
    )
if 'appleCutterComponentKey = definition.key' not in source:
    source = source.replace(
        "  root.name = 'AppleCutterImportComponent';\n",
        "  root.name = 'AppleCutterImportComponent';\n"
        '  root.userData.appleCutterComponentKey = definition.key;\n'
    )
if 'key: `island-${islandIndex}`' not in source:
    source = source.replace(
        '      directParts.push({\n        order: islandIndex,',
        '      directParts.push({\n'
        '        key: `island-${islandIndex}`,\n'
        '        order: islandIndex,'
    )
if 'key: islandIndex === 0 ? String(childIndex)' not in source:
    source = source.replace(
        '          directParts.push({\n            order: childIndex * 100000 + islandIndex,',
        '          directParts.push({\n'
        '            key: islandIndex === 0\n'
        '              ? String(childIndex)\n'
        '              : `${childIndex}-island-${islandIndex}`,\n'
        '            order: childIndex * 100000 + islandIndex,'
    )
if 'definitions.push({\n          key: String(childIndex),' not in source:
    source = source.replace(
        '        definitions.push({\n          order: childIndex * 100000,',
        '        definitions.push({\n'
        '          key: String(childIndex),\n'
        '          order: childIndex * 100000,'
    )
for fragment in (
    'interface ComponentDefinition {\n  key: string;',
    'interface DirectPart {\n  key: string;',
    'appleCutterComponentKey = definition.key',
    'key: `island-${islandIndex}`',
    'key: String(childIndex)'
):
    require(fragment in source, f'Import component migration missing: {fragment}')
import_path.write_text(source, encoding='utf-8')


object_path = Path('src/editor/snapping/objectSurfaceSnap.ts')
source = object_path.read_text(encoding='utf-8')
if "import { buildImportedComponentRoots } from './importComponentAnalysis';" not in source:
    source = source.replace(
        "import { buildGeometrySupportPoints } from './surfaceSupport';\n",
        "import { buildGeometrySupportPoints } from './surfaceSupport';\n"
        "import { buildImportedComponentRoots } from './importComponentAnalysis';\n"
    )
helper_start = source.find('function containsVisibleMesh(root: THREE.Object3D): boolean {')
if helper_start >= 0:
    helper_end = source.find('\n\nexport function analyzeImportedObject3DSnapTargets(', helper_start)
    require(helper_end >= 0, 'Could not remove containsVisibleMesh helper')
    source = source[:helper_start] + source[helper_end + 2:]
block_start = source.find('  const componentRoots = root.children.filter')
if block_start >= 0:
    block_end = source.find('  return {\n    composite,\n    components:', block_start)
    require(block_end >= 0, 'Could not locate import component return block')
    replacement = """  const componentRoots = buildImportedComponentRoots(root);
  if (componentRoots.length === 0) {
    return {
      composite,
      components: [rescopeTarget(composite, `${id}:component:0`, 'component')]
    };
  }

  const components = componentRoots.flatMap((componentRoot, index) => {
    const stableKey = componentRoot.userData.appleCutterComponentKey;
    const componentKey = typeof stableKey === 'string' ? stableKey : String(index);
    const componentId = `${id}:component:${componentKey}`;
    const target = surfaceSnapTargetFromObject3D(componentRoot, componentId);
    return target
      ? [rescopeTarget(target, componentId, 'component')]
      : [];
  });
"""
    source = source[:block_start] + replacement + source[block_end:]
require('buildImportedComponentRoots(root)' in source, 'New import component analysis not connected')
object_path.write_text(source, encoding='utf-8')


viewport_path = Path('src/editor/viewport/EditorViewport.tsx')
viewport = viewport_path.read_text(encoding='utf-8')
viewport = viewport.replace(
    "import { findFormSurfaceSnap, isFormType } from '../snapping/primitiveSurfaceSnap';",
    "import { findAppleCutterSurfaceSnap } from '../appleCutter/appleCutterSnap';"
)
viewport = viewport.replace('findFormSurfaceSnap(', 'findAppleCutterSurfaceSnap(')
viewport = viewport.replace('if (snap.surface && isFormType(object.type)) {', 'if (snap.surface) {')
viewport = viewport.replace("    && isFormType(object.type)\n", '')
require('primitiveSurfaceSnap' not in viewport, 'Legacy primitiveSurfaceSnap import remains in viewport')
require('isFormType' not in viewport, 'Legacy isFormType remains in viewport')
require('findFormSurfaceSnap' not in viewport, 'Legacy findFormSurfaceSnap remains in viewport')
viewport_path.write_text(viewport, encoding='utf-8')


swept_path = Path('tests/sweptObjectSurfaceSnap.test.ts')
swept = swept_path.read_text(encoding='utf-8')
swept = swept.replace(
    "import { findFormSurfaceSnap } from '../src/editor/snapping/primitiveSurfaceSnap';",
    "import { findAppleCutterSurfaceSnap } from '../src/editor/appleCutter/appleCutterSnap';"
)
swept = swept.replace('findFormSurfaceSnap', 'findAppleCutterSurfaceSnap')
require('primitiveSurfaceSnap' not in swept, 'Legacy snap import remains in swept tests')
swept_path.write_text(swept, encoding='utf-8')


composite_path = Path('tests/appleCutterComposite.test.ts')
test = composite_path.read_text(encoding='utf-8')
old_start = test.find("  it('behandelt direkte Mesh-Nodes")
if old_start >= 0:
    old_end = test.find("\n\n  it('behält Komponenten-IDs", old_start)
    require(old_end >= 0, 'Could not locate end of direct-mesh test')
    new_tests = """  it('fasst berührende direkte Mesh-Nodes als eine logische Komponente zusammen', () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2));
    wall.position.x = -0.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.7, 4));
    roof.position.set(0.4, 0.8, 0);
    root.add(wall, roof);

    const analysis = analyzeImportedObject3DSnapTargets(root, 'imported-house');

    expect(analysis.composite?.scope).toBe('composite');
    expect(analysis.components).toHaveLength(1);
    expect(analysis.components[0]?.scope).toBe('component');
    expect(analysis.components[0]?.anchors.length).toBeGreaterThan(0);
    wall.geometry.dispose();
    roof.geometry.dispose();
  });

  it('erzeugt bei berührenden Materialaufteilungen keine Scheinkomponenten', () => {
    const root = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 1));
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 1));
    left.position.x = -0.25;
    right.position.x = 0.25;
    root.add(left, right);

    const analysis = analyzeImportedObject3DSnapTargets(root, 'material-split');

    expect(analysis.components).toHaveLength(1);
    left.geometry.dispose();
    right.geometry.dispose();
  });

  it('erkennt getrennte Dreiecksinseln eines einzelnen Meshes als Komponenten', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      3, 0, 0, 4, 0, 0, 3, 1, 0
    ], 3));
    geometry.computeVertexNormals();
    const root = new THREE.Mesh(geometry);

    const analysis = analyzeImportedObject3DSnapTargets(root, 'island-import');

    expect(analysis.composite).not.toBeNull();
    expect(analysis.components).toHaveLength(2);
    expect(new Set(analysis.components.map((target) => target.id)).size).toBe(2);
    geometry.dispose();
  });"""
    test = test[:old_start] + new_tests + test[old_end:]
old_mesh_setup = """    const meshes = Array.from({ length: 3 }, () => (
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    ));"""
new_mesh_setup = """    const meshes = Array.from({ length: 3 }, (_, index) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.position.x = index * 2;
      return mesh;
    });"""
test = test.replace(old_mesh_setup, new_mesh_setup)
require("fasst berührende direkte Mesh-Nodes" in test, 'Updated direct-mesh test missing')
require('mesh.position.x = index * 2' in test, 'Stable-ID test was not spatially separated')
composite_path.write_text(test, encoding='utf-8')


for legacy in (
    Path('src/editor/snapping/primitiveSurfaceSnap.ts'),
    Path('.github/workflows/apply-apple-cutter-finalization.yml'),
    Path('.github/workflows/apply-apple-cutter-finalization-v2.yml'),
    Path('.github/workflows/apply-apple-cutter-finalization-v3.yml'),
    Path('scripts/finalize-apple-cutter.py')
):
    if legacy.exists():
        legacy.unlink()
