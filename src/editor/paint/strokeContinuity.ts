export type StrokeCoordinate = [number, number];

interface StrokeSample {
  pixel: StrokeCoordinate;
  client: StrokeCoordinate;
}

const MAX_AXIS_JUMP_RATIO = 0.45;
const PIXELS_PER_SCREEN_PIXEL = 16;
const MIN_AXIS_ALLOWANCE = 4;
const EXTRA_MOTION_ALLOWANCE = 4;

function coordinateDistance(left: StrokeCoordinate, right: StrokeCoordinate): number {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function axisJumpLimit(surfaceSize: number, brushSize: number): number {
  const brushAllowance = Math.max(MIN_AXIS_ALLOWANCE, Math.round(brushSize) * 2);
  return Math.max(brushAllowance, Math.max(1, surfaceSize) * MAX_AXIS_JUMP_RATIO);
}

export function shouldConnectStroke(
  previous: StrokeSample | null,
  current: StrokeSample,
  surfaceWidth: number,
  surfaceHeight: number,
  brushSize: number
): boolean {
  if (!previous) return false;

  const pixelDeltaX = Math.abs(current.pixel[0] - previous.pixel[0]);
  const pixelDeltaY = Math.abs(current.pixel[1] - previous.pixel[1]);
  if (pixelDeltaX > axisJumpLimit(surfaceWidth, brushSize)) return false;
  if (pixelDeltaY > axisJumpLimit(surfaceHeight, brushSize)) return false;

  const brushAllowance = Math.max(MIN_AXIS_ALLOWANCE, Math.round(brushSize) * 2);
  const clientDistance = coordinateDistance(previous.client, current.client);
  const motionAllowance = Math.max(
    brushAllowance + EXTRA_MOTION_ALLOWANCE,
    clientDistance * PIXELS_PER_SCREEN_PIXEL + brushAllowance
  );

  return coordinateDistance(previous.pixel, current.pixel) <= motionAllowance;
}
