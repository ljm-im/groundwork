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
    assert(trace([9, 11, 9, 11], 2, 10).find(s => s.value === 10)?.label);
    assert.equal(trace([9, 11, 9, 11], 2, 9).find(s => s.value === 10)?.label, false);
});

test("Contour labels follow the drawn interval at three scales on the same slope", () => {
    for (const [scale, drawn, multiple] of [[1024, .1, .2], [25.6, 1, 10], [2.56, 10, 100]]) {
        const size = Math.ceil(500 / scale) + 2;
        const grid = createGrid({ xMin: 0, xMax: size, yMin: 0, yMax: size, step: 1 });
        const values = Float32Array.from({ length: size * size }, (_, k) => 4 * grid.x(k % size));
        const samples = { values, defined: new Uint8Array(values.length).fill(1) };
        const levels = new Map<number, { value: number; tier: number; links: Parameters<typeof connectContourLinks>[2] }>();
        const drawnValues = new Set<number>();
        traceContours(grid, samples, .1, scale, (_rank, value, from, to, label, { level, tier, edges, spacing }) => {
            drawnValues.add(value);
            if (label) assert(Math.abs(value / multiple - Math.round(value / multiple)) < 1e-9);
            let line = levels.get(level);
            if (!line) levels.set(level, line = { value, tier, links: [] });
            line.links.push({ from, to, edges, spacing });
        }, true);
        const ordered = [...drawnValues].sort((a, b) => a - b);
        assert(Math.abs(ordered[1] - ordered[0] - drawn) < 1e-9);
        const lines = [...levels.values()].flatMap(({ value, tier, links }) => connectContourLinks(value, tier, links));
        const xMin = grid.x(0), yMin = grid.y(size - 1);
        const placed = contourLabels(lines, 500, 500, ([x, y]) => [(x - xMin) * scale, (y - yMin) * scale], () => [32, 14])
            .sort((a, b) => a.point[0] - b.point[0]);
        assert(placed.length >= 2, "Expected more than one label for interval " + drawn);
        for (const [i, { value, point }] of placed.entries()) {
            assert(Math.abs(value / multiple - Math.round(value / multiple)) < 1e-9);
            if (i) assert(point[0] - placed[i - 1].point[0] >= contourStyle.labelGap);
        }
    }
});

const labels = (lines: ContourLine[]) => contourLabels(lines, 500, 300, p => p, () => [32, 14]);

test("Grid edges connect one long line and keep adjacent equal values separate", () => {
    const links = [65, 85].flatMap((y, row) => Array.from({ length: 20 }, (_, i) => ({
        edges: [row * 30 + i, row * 30 + i + 1] as [number, number],
        from: [i * 20, y] as [number, number], to: [(i + 1) * 20, y] as [number, number], spacing: i === 10 ? 64 : 48
    })));
    const lines = connectContourLinks(20, 3, links);
    assert.deepEqual(lines.map(line => line.spans.length), [20, 20]);
    assert.deepEqual(labels(lines).map(label => [label.value, label.point]), [[20, [210, 65]], [20, [210, 85]]]);
});

test("A closed contour can be labeled once and distance on screen controls visibility", () => {
    const points: [number, number][] = [[100, 60], [180, 60], [180, 140], [100, 140]];
    const lines = connectContourLinks(10, 2, points.map((from, index) => {
        const next = (index + 1) % points.length;
        return { edges: [index, next], from, to: points[next], spacing: 56 };
    }));
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].spans[0].from, lines[0].spans.at(-1)!.to);
    assert.equal(labels(lines).length, 1);
    assert.equal(labels([{ value: 10, tier: 2, spans: [{ from: [-100, 60], to: [75, 60], spacing: 56 }] }]).length, 0);
    assert.equal(labels([{ value: 10, tier: 2, spans: [{ from: [50, 30], to: [250, 30], spacing: 56 }] }]).length, 0);
});

test("Overlapping contour numbers keep the higher multiple and break ties in placement order", () => {
    const line = (value: number, tier: number, y: number): ContourLine => ({
        value, tier, spans: [{ from: [120, y], to: [380, y], spacing: 56 }]
    });
    const placed = labels([line(30, 2, 100), line(10, 2, 101), line(20, 3, 105)]);
    assert.deepEqual(placed.map(label => label.value), [20]);
    assert.deepEqual(labels([line(30, 2, 100), line(10, 2, 101)]).map(label => label.value), [30]);
});

function sampleContour(width: number, height: number, value: (x: number, y: number) => number,
    inside: (x: number, y: number) => boolean = () => true) {
    const grid = createGrid({ xMin: 0, xMax: width, yMin: 0, yMax: height, step: 1 });
    const values = Float32Array.from({ length: width * height }, (_, i) => value(i % width, Math.floor(i / width)));
    const defined = Uint8Array.from(values, (_, i) => Number(inside(i % width, Math.floor(i / width))));
    const scale = 20, links: Parameters<typeof connectContourLinks>[2] = [];
    traceContours(grid, { values, defined }, 1, scale, (_rank, level, from, to, _label, { edges, spacing }) => {
        if (level === 20) links.push({ edges, from, to, spacing });
    }, true);
    return {
        links, domain: { grid, defined },
        labels: (lines: ContourLine[]) => contourLabels(lines, width * scale, height * scale, ([x, y]) => [x * scale, y * scale], () => [32, 14])
    };
}

test("Three equal contour fragments ending on the defined field boundary receive one number", () => {
    const { links, domain, labels } = sampleContour(27, 18, (_x, y) => 20 + (y - 8.5) * .05, x => x % 10 < 7);
    assert.equal(labels(connectContourLinks(20, 3, links)).length, 3);
    const joined = connectContourLinks(20, 3, links, domain);
    assert.deepEqual(joined.map(line => line.spans.length), [links.length]);
    assert.deepEqual(labels(joined).map(label => label.value), [20]);
});

test("Two equal closed contours inside a defined field each receive a number", () => {
    const { links, domain, labels } = sampleContour(30, 19, (x, y) =>
        20 + .05 * (3.7 - Math.min(Math.hypot(x - 7, y - 9), Math.hypot(x - 22, y - 9))));
    const lines = connectContourLinks(20, 3, links, domain);
    assert.equal(lines.length, 2);
    for (const { spans } of lines) assert.deepEqual(spans[0].from, spans.at(-1)!.to);
    assert.deepEqual(labels(lines).map(label => label.value), [20, 20]);
});