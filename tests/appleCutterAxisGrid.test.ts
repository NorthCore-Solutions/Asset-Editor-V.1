import { describe, expect, it } from 'vitest';
import {
  APPLE_CUTTER_CELL_SIZE,
  buildCenteredAppleCutterAxis,
  maximumAppleCutterCellSize
} from '../src/editor/appleCutter/appleCutterAxisGrid';

function sizesForLength(length: number, scale: number = 1): number[] {
  const grid = buildCenteredAppleCutterAxis('x', -length / 2, length / 2, scale);
  return grid.cells.map((cell) => Number(cell.size.toFixed(6)));
}

describe('Apfelschneider-Achsraster', () => {
  it('teilt die Grundlänge 1,0 symmetrisch in 0,125 / 0,25 / 0,25 / 0,25 / 0,125', () => {
    expect(sizesForLength(1)).toEqual([0.125, 0.25, 0.25, 0.25, 0.125]);
  });

  it('verteilt die Überlänge bei 1,10 gleichmäßig auf beide Randkacheln', () => {
    expect(sizesForLength(1, 1.1)).toEqual([0.175, 0.25, 0.25, 0.25, 0.175]);
  });

  it('erzeugt neue Schnitte beim Skalieren immer paarweise um den Mittelpunkt', () => {
    const grid = buildCenteredAppleCutterAxis('x', -0.5, 0.5, 2);

    expect(grid.cuts.length % 2).toBe(0);
    for (let index = 0; index < grid.cuts.length / 2; index += 1) {
      const left = grid.cuts[index];
      const right = grid.cuts[grid.cuts.length - 1 - index];
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      expect((left ?? 0) + (right ?? 0)).toBeCloseTo(0, 10);
    }
  });

  it('lässt keine Kachel größer als 0,25 Welt-Einheiten werden', () => {
    for (const [length, scale] of [[0.1, 1], [0.25, 1], [1, 1], [1, 1.1], [3, 1], [1, 8]] as const) {
      const grid = buildCenteredAppleCutterAxis('x', -length / 2, length / 2, scale);
      expect(maximumAppleCutterCellSize(grid)).toBeLessThanOrEqual(APPLE_CUTTER_CELL_SIZE + 0.000001);
    }
  });

  it('erlaubt kleinere Kacheln ausschließlich an den äußeren Rändern', () => {
    const grid = buildCenteredAppleCutterAxis('x', -0.55, 0.55, 1);
    const remainderCells = grid.cells.filter((cell) => cell.isRemainderCell);

    expect(remainderCells).toHaveLength(2);
    expect(remainderCells.map((cell) => cell.edge)).toEqual(['negative', 'positive']);
    expect(remainderCells[0]?.size).toBeCloseTo(remainderCells[1]?.size ?? 0, 10);
    expect(grid.cells.filter((cell) => cell.edge === null).every((cell) => (
      Math.abs(cell.size - APPLE_CUTTER_CELL_SIZE) < 0.000001
    ))).toBe(true);
  });

  it('bleibt auch bei nicht mittig liegenden lokalen Bounds um deren Mittelpunkt synchron', () => {
    const grid = buildCenteredAppleCutterAxis('x', 2, 3, 1);

    expect(grid.center).toBe(2.5);
    expect(grid.cuts).toEqual([2.125, 2.375, 2.625, 2.875]);
    expect(grid.cells.map((cell) => cell.size)).toEqual([0.125, 0.25, 0.25, 0.25, 0.125]);
  });

  it('behandelt negative Skalierung spiegelbildlich mit identischen Kachelgrößen', () => {
    const positive = buildCenteredAppleCutterAxis('x', -0.5, 0.5, 1.6);
    const negative = buildCenteredAppleCutterAxis('x', -0.5, 0.5, -1.6);

    expect(negative.cuts).toEqual(positive.cuts);
    expect(negative.cells.map((cell) => cell.size)).toEqual(
      positive.cells.map((cell) => cell.size)
    );
  });
});
