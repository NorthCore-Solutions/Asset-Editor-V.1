export interface PinchZoomStep {
  movement: number;
  nextDepth: number;
}

export function calculatePinchZoomStep(
  focusDepth: number,
  previousDistance: number,
  currentDistance: number,
  rayForwardDot: number,
  minimumDepth = 0.1,
  maximumDepth = 500
): PinchZoomStep {
  if (
    !Number.isFinite(focusDepth)
    || !Number.isFinite(previousDistance)
    || !Number.isFinite(currentDistance)
    || !Number.isFinite(rayForwardDot)
    || focusDepth <= 0
    || previousDistance <= 0
    || currentDistance <= 0
  ) {
    return { movement: 0, nextDepth: focusDepth };
  }

  const ratio = Math.min(1.35, Math.max(0.65, previousDistance / currentDistance));
  const nextDepth = Math.min(maximumDepth, Math.max(minimumDepth, focusDepth * ratio));
  const safeRayForwardDot = Math.max(0.2, rayForwardDot);

  return {
    movement: (focusDepth - nextDepth) / safeRayForwardDot,
    nextDepth
  };
}
