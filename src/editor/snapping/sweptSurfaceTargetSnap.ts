import type {
  ObjectSurfaceSnapResult,
  SurfaceSnapTarget
} from './objectSurfaceSnap';
import { findSweptInternalCutterTargetSnap } from './internalCutterSnap';

export interface SweptSurfaceTargetSnapOptions {
  ignoredTargetAnchorId?: string | null;
  ignoredSourceAnchorId?: string | null;
}

/** Gemeinsamer Sweep für Gruppen/Importe auf den inneren Cutter-Ebenen. */
export function findSweptSurfaceTargetSnap(
  previousSource: SurfaceSnapTarget,
  currentSource: SurfaceSnapTarget,
  targets: readonly SurfaceSnapTarget[],
  positionStep: number,
  options: SweptSurfaceTargetSnapOptions = {}
): ObjectSurfaceSnapResult | null {
  return findSweptInternalCutterTargetSnap(
    previousSource,
    currentSource,
    targets,
    positionStep,
    options
  );
}
