import assert from "node:assert/strict";
import { test } from "node:test";
import { createGrid } from "../src/core/math/geometry.ts";
import { contourIntervalIndex, contourIntervals, contourRank, traceContours } from "../src/render/fieldContours.ts";
import { contourStyle } from "../src/render/palette.ts";

test("Contour multiples keep the smallest allowed interval at flat, gentle and steep slopes", () => {
    const intervals = contourIntervals(1, 400);
    assert.deepEqual(intervals, [1, 2, 10, 20, 100, 200, 1000]);
    for (const [spacing, multiple] of [[Infinity, 1], [5, 1], [4, 2], [2.5, 2], [1, 10], [.05, 100], [.0125, 1000]]) {
        const minimum = contourStyle.minSpacing / spacing;
        assert.equal(intervals[contourIntervalIndex(intervals, minimum)], multiple);
    }
    assert.deepEqual(contourIntervals(.7, 4), [.7, 1.4, 7]);
    assert(contourIntervals(5e-323, 10).at(-1)! >= 10);
});

test("Contour ranks use signed base multiples and reserve a distinct rank for zero", () => {
    assert.deepEqual([-1000, -20, -10, -2, -1, 0, 1, 2, 10, 20, 100].map(n => contourRank(n)), [4, 3, 2, 1, 0, 5, 0, 1, 2, 3, 4]);
    assert.deepEqual([0, 1, 2, 4, 5, 10].map(n => contourRank(n, 2)), [5, 2, 3, 3, 2, 4]);
});

function trace(values: number[], width: number, scale: number, base = 1, mask = values.map(() => 1)) {
    const grid = createGrid({ xMin: 0, xMax: width, yMin: 0, yMax: values.length / width, step: 1 });
    const samples = { values: Float32Array.from(values), defined: Uint8Array.from(mask) };
    const segments: { rank: number; value: number; from: number[]; to: number[]; label: boolean }[] = [];
    traceContours(grid, samples, base, scale, (rank, value, from, to, label) => segments.push({ rank, value, from, to, label }));
    return segments;
}

test("Steepness in a one-cell step suppresses contours in its immediate neighbors", () => {
    const row = [0, 2, 42, 44, 46, 48], values = [...row, ...row];
    assert.deepEqual(trace(values, 6, 10).map(s => s.value), [20, 40, 45, 46, 47, 48]);
    assert.deepEqual(trace(values, 6, 400).map(s => s.value), Array.from({ length: 48 }, (_, i) => i + 1));
    assert.deepEqual(trace([3, 3, 3, 3], 2, 10), []);
});

test("Zero crosses signed cells and other lines only gain labels at the specified spacing", () => {
    const row = [-1.5, 1.5, -1.5, 1.5];
    const segments = trace(row, 2, 20);
    assert.deepEqual(segments.map(s => s.value), [-1, 0, 1]);
    const zero = { rank: 5, value: 0, from: [1, 1.5], to: [1, .5], label: false };
    assert.deepEqual(segments[1], zero);
    assert.deepEqual(trace(row, 2, .01), [zero]);
    assert.deepEqual(trace(row, 2, 20, Infinity), [zero]);
    assert.deepEqual(trace(row, 2, 20, 1, [1, 1, 1, 0]), []);
    assert(trace([9, 11, 9, 11], 2, 36).find(s => s.value === 10)?.label);
    assert.equal(trace([9, 11, 9, 11], 2, 35).find(s => s.value === 10)?.label, false);
});