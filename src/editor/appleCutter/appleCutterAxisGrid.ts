import type { AppleCutterAxis, AppleCutterAxisGrid, AppleCutterCell } from './appleCutterTypes';

const EPSILON = 0.000001;

/**
 * Feste maximale Kachellänge des Apfelschneider-Modells.
 * Innere Kacheln behalten exakt diese Länge. Nur die beiden äußeren
 * Randkacheln dürfen symmetrisch kleiner sein.
 */
export const APPLE_CUTTER_CELL_SIZE = 0.25;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value.toFixed(12))))]
    .sort((left, right) => left - right);
}

export function buildCenteredAppleCutterAxis(
  axis: AppleCutterAxis,
  minimumInput: number,
  maximumInput: number,
  scaleInput: number
): AppleCutterAxisGrid {
  const minimum = Math.min(finite(minimumInput, 0), finite(maximumInput, 0));
  const maximum = Math.max(finite(minimumInput, 0), finite(maximumInput, 0));
  const center = (minimum + maximum) * 0.5;
  const scale = Math.max(0.0001, Math.abs(finite(scaleInput, 1)));
  const localLength = Math.max(0, maximum - minimum);
  const worldLength = localLength * scale;
  const halfWorldLength = worldLength * 0.5;
  const cuts: number[] = [];

  // Die Schnitte liegen bei ±0,5, ±1,5, ±2,5 ... Kachellängen.
  // Dadurch teilen sich beide Randkacheln jeden Rest immer exakt hälftig.
  for (
    let worldOffset = APPLE_CUTTER_CELL_SIZE * 0.5;
    worldOffset < halfWorldLength - EPSILON;
    worldOffset += APPLE_CUTTER_CELL_SIZE
  ) {
    const localOffset = worldOffset / scale;
    cuts.push(center - localOffset, center + localOffset);
  }

  const sortedCuts = uniqueSorted(cuts)
    .filter((value) => value > minimum + EPSILON && value < maximum - EPSILON);
  const coordinates = uniqueSorted([minimum, ...sortedCuts, maximum]);
  const cells: AppleCutterCell[] = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const cellMinimum = coordinates[index];
    const cellMaximum = coordinates[index + 1];
    if (cellMinimum === undefined || cellMaximum === undefined) continue;
    const size = Math.max(0, (cellMaximum - cellMinimum) * scale);
    const first = index === 0;
    const last = index === coordinates.length - 2;
    cells.push({
      index,
      minimum: cellMinimum,
      maximum: cellMaximum,
      size,
      edge: first && last ? 'both' : first ? 'negative' : last ? 'positive' : null,
      isRemainderCell: size < APPLE_CUTTER_CELL_SIZE - EPSILON
    });
  }

  return {
    axis,
    minimum,
    maximum,
    center,
    standardStep: APPLE_CUTTER_CELL_SIZE,
    cuts: sortedCuts,
    coordinates,
    cells
  };
}

export function maximumAppleCutterCellSize(grid: AppleCutterAxisGrid): number {
  return grid.cells.reduce((maximum, cell) => Math.max(maximum, cell.size), 0);
}
