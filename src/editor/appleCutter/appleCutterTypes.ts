import type { Vec3 } from '../../types/editor';

export type AppleCutterAxis = 'x' | 'y' | 'z';
export type AppleCutterScope = 'component' | 'composite';

export interface AppleCutterCell {
  index: number;
  minimum: number;
  maximum: number;
  size: number;
  edge: 'negative' | 'positive' | 'both' | null;
  isRemainderCell: boolean;
}

export interface AppleCutterAxisGrid {
  axis: AppleCutterAxis;
  minimum: number;
  maximum: number;
  center: number;
  standardStep: number;
  cuts: number[];
  coordinates: number[];
  cells: AppleCutterCell[];
}

export interface AppleCutterDefinition {
  baseBounds: {
    min: Vec3;
    max: Vec3;
  };
  center: Vec3;
  standardStep: Vec3;
  baseCutCount: readonly [4, 4, 4];
  scope: AppleCutterScope;
}
