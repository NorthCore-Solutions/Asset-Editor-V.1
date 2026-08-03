export type StrokeCoordinate = [number, number];

interface StrokeSample {
  pixel: StrokeCoordinate;
  client: StrokeCoordinate;
}

const MAX_AXIS_JUMP_RATIO = 0.45;
const PIXELS_PER_SCREEN_PIXEL = 16;

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
  const safeWidth = Math.max(1, surfaceWidth);
  const safeHeight = Math.max(1, surfaceHeight);
  const axisAllowance = Math.max(4, Math.round(brushSize) * 2);

  if (pixelDeltaX > Math.max(axisAllowance, safeWidth * MAX_AXIS_JUMP_RATIO)) return false;
  if (pixelDeltaY > Math.max(axisAllowance, safeHeight * MAX_AXIS_JUMP_RATIO)) return false;

  const pixelDistance = Math.hypot(pixelDeltaX, pixelDeltaY);
  const clientDistance = Math.hypot(
    current.client[0] - previous.client[0],
    current.client[1] - previous.client[1]
  );
  const motionAllowance = Math.max(
    axisAllowance + 4,
    clientDistance * PIXELS_PER_SCREEN_PIXEL + axisAllowance
  );

  return pixelDistance <= motionAllowance;
}
