import type { SnapSettings, Vec3 } from '../../types/editor';

const SNAP_PRECISION = 6;

export function snapCoordinate(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Number((Math.round(value / step) * step).toFixed(SNAP_PRECISION));
}

export function snapPosition(position: Vec3, snap: Pick<SnapSettings, 'enabled' | 'position'>): Vec3 {
  if (!snap.enabled || snap.position <= 0) return [...position] as Vec3;
  return position.map((value) => snapCoordinate(value, snap.position)) as Vec3;
}
