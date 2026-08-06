import type { SurfaceSnapAnchor } from './surfaceSnapTopology';

const POSITION_PRECISION = 0.00001;
const OPPOSING_NORMAL_DOT = -0.9;

function positionKey(anchor: SurfaceSnapAnchor): string {
  return [anchor.position.x, anchor.position.y, anchor.position.z]
    .map((value) => Math.round(value / POSITION_PRECISION))
    .join(':');
}

/**
 * Eine gemeinsame Kontaktfläche zweier geschlossener Bauteile erzeugt am
 * selben Ort zwei Snap-Punkte mit entgegengesetzten Normalen. Beide gehören
 * zur inneren Trennfläche und dürfen im äußeren Composite-Raster nicht bleiben.
 */
export function removeOpposingCoincidentAnchors(
  anchors: readonly SurfaceSnapAnchor[]
): SurfaceSnapAnchor[] {
  const groups = new Map<string, SurfaceSnapAnchor[]>();
  for (const anchor of anchors) {
    const key = positionKey(anchor);
    const group = groups.get(key);
    if (group) group.push(anchor);
    else groups.set(key, [anchor]);
  }

  const internal = new Set<SurfaceSnapAnchor>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const anchor of group) {
      if (group.some((other) => (
        other !== anchor
        && anchor.normal.dot(other.normal) <= OPPOSING_NORMAL_DOT
      ))) {
        internal.add(anchor);
      }
    }
  }

  return anchors.filter((anchor) => !internal.has(anchor));
}
