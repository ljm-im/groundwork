import assert from "node:assert/strict";
import { test } from "node:test";
import { createGrid } from "../src/core/math/geometry.ts";
import { connectContourLinks, contourIntervalIndex, contourIntervals, contourLabels, contourRank, traceContours, type ContourLine } from "../src/render/fieldContours.ts";
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

const labels = (lines: ContourLine[]) => contourLabels(lines, 500, 300, p => p, () => [32, 14]);

test("Grid edges connect one long line and keep adjacent equal values separate", () => {
    const links = [65, 85].flatMap((y, row) => Array.from({ length: 20 }, (_, i) => ({
        edges: [row * 30 + i, row * 30 + i + 1] as [number, number],
        from: [i * 20, y] as [number, number], to: [(i + 1) * 20, y] as [number, number], spacing: i === 10 ? 40 : 18
    })));
    const lines = connectContourLinks(20, 3, links);
    assert.deepEqual(lines.map(line => line.spans.length), [20, 20]);
    assert.deepEqual(labels(lines).map(label => [label.value, label.point]), [[20, [210, 65]], [20, [210, 85]]]);
});

test("A closed contour can be labeled once and distance on screen controls visibility", () => {
    const points: [number, number][] = [[100, 60], [180, 60], [180, 140], [100, 140]];
    const lines = connectContourLinks(10, 2, points.map((from, index) => {
        const next = (index + 1) % points.length;
        return { edges: [index, next], from, to: points[next], spacing: 24 };
    }));
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].spans[0].from, lines[0].spans.at(-1)!.to);
    assert.equal(labels(lines).length, 1);
    assert.equal(labels([{ value: 10, tier: 2, spans: [{ from: [-100, 60], to: [75, 60], spacing: 24 }] }]).length, 0);
    assert.equal(labels([{ value: 10, tier: 2, spans: [{ from: [50, 30], to: [250, 30], spacing: 24 }] }]).length, 0);
});

test("Overlapping contour numbers keep the higher multiple and break ties in placement order", () => {
    const line = (value: number, tier: number, y: number): ContourLine => ({
        value, tier, spans: [{ from: [120, y], to: [380, y], spacing: 30 }]
    });
    const placed = labels([line(30, 2, 100), line(10, 2, 101), line(20, 3, 105)]);
    assert.deepEqual(placed.map(label => label.value), [20]);
    assert.deepEqual(labels([line(30, 2, 100), line(10, 2, 101)]).map(label => label.value), [30]);
});