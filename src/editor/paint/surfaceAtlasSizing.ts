const MIN_ATLAS_INNER_PIXELS = 4;

function normalizePixelSize(value: number, limit: number): number {
  return Math.max(1, Math.min(limit, Math.round(value)));
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return Math.max(1, a);
}

export function chooseAtlasInnerPixelSize(
  dimensions: number[],
  limit: number
): number {
  const safeLimit = Math.max(MIN_ATLAS_INNER_PIXELS, Math.round(limit));
  const normalized = dimensions.length > 0
    ? dimensions.map((dimension) => normalizePixelSize(dimension, safeLimit))
    : [1];

  let commonMultiple = 1;

  for (const dimension of normalized) {
    const divisor = greatestCommonDivisor(commonMultiple, dimension);
    const multiplier = dimension / divisor;

    if (commonMultiple > Math.floor(safeLimit / multiplier)) {
      return safeLimit;
    }

    commonMultiple *= multiplier;
  }

  const minimumScaledMultiple = Math.ceil(MIN_ATLAS_INNER_PIXELS / commonMultiple)
    * commonMultiple;
  return Math.min(safeLimit, Math.max(commonMultiple, minimumScaledMultiple));
}

export function atlasRegionPixelSize(cellPixels: number, padding: number): number {
  const safeCellPixels = Math.max(1, Math.round(cellPixels));
  const safePadding = Math.max(0, Math.min(0.49, padding));
  const start = Math.floor(safePadding * safeCellPixels);
  const end = Math.ceil((1 - safePadding) * safeCellPixels);
  return Math.max(1, end - start);
}

export function chooseAtlasCellPixelSize(
  innerPixels: number,
  padding: number
): number {
  const target = Math.max(1, Math.round(innerPixels));
  const safePadding = Math.max(0, Math.min(0.49, padding));
  if (safePadding === 0) return target;

  const innerRatio = Math.max(0.02, 1 - safePadding * 2);
  const maximumCandidate = Math.max(
    target,
    Math.ceil((target + 2) / innerRatio) + 16
  );
  let bestCandidate = target;
  let bestError = Number.POSITIVE_INFINITY;

  for (let candidate = 1; candidate <= maximumCandidate; candidate += 1) {
    const regionSize = atlasRegionPixelSize(candidate, safePadding);
    const error = Math.abs(regionSize - target);

    if (error < bestError) {
      bestCandidate = candidate;
      bestError = error;
    }

    if (regionSize === target) return candidate;
  }

  return bestCandidate;
}

export function normalizedCoordinateToPixel(
  coordinate: number,
  pixelCount: number
): number {
  const safePixelCount = Math.max(1, Math.round(pixelCount));
  const normalized = Math.max(0, Math.min(1, coordinate));
  return Math.max(0, Math.min(
    safePixelCount - 1,
    Math.floor(normalized * safePixelCount)
  ));
}

export function atlasPixelToSourcePixel(
  atlasPixel: number,
  atlasRegionStart: number,
  atlasRegionPixels: number,
  sourceStart: number,
  sourcePixels: number,
  sourceLimit: number
): number {
  const safeAtlasPixels = Math.max(1, Math.round(atlasRegionPixels));
  const safeSourceLimit = Math.max(1, Math.round(sourceLimit));
  const localAtlasPixel = Math.max(0, Math.min(
    safeAtlasPixels - 1,
    Math.round(atlasPixel) - Math.round(atlasRegionStart)
  ));
  const sourceCoordinate = sourceStart
    + ((localAtlasPixel + 0.5) / safeAtlasPixels) * Math.max(0.000001, sourcePixels);

  return Math.max(0, Math.min(
    safeSourceLimit - 1,
    Math.floor(sourceCoordinate)
  ));
}
