import { type FieldSamples } from "../core/design/results.ts";
import { type Grid, type Point } from "../core/math/geometry.ts";
import { shiftDecimal } from "../core/math/interval.ts";
import { contourStyle } from "./palette.ts";

const zeroRank = contourStyle.lines.length;
const factors = [2, 5] as const;

export function contourIntervals(base: number, largest: number) {
    const intervals = [base];
    for (let power = 0; intervals.at(-1)! < largest; power++) {
        intervals.push(2 * intervals.at(-1)!);
        if (intervals.at(-1)! < largest) intervals.push(shiftDecimal(base, power + 1));
    }
    return intervals;
}

export function contourIntervalIndex(intervals: readonly number[], minimum: number) {
    let low = 0, high = intervals.length - 1;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (intervals[middle] < minimum) low = middle + 1;
        else high = middle;
    }
    return low;
}

export function contourRank(level: number, intervalIndex = 0) {
    if (level === 0) return zeroRank;
    let rank = Math.min(intervalIndex, zeroRank - 1);
    while (rank < zeroRank - 1) {
        const factor = factors[rank % factors.length];
        if (level % factor !== 0) break;
        level /= factor;
        rank++;
    }
    return rank;
}

interface Slopes { grid: Grid; defined: Uint8Array; steepest: Float64Array; maximum: number }
const slopes = new WeakMap<Float32Array, Slopes>();

function cellSlopes(grid: Grid, { values: v, defined: d }: FieldSamples) {
    const cached = slopes.get(v);
    if (cached?.grid === grid && cached.defined === d) return cached;
    const { width, height } = grid, cols = width - 1, rows = height - 1;
    const changes = new Float64Array(cols * rows), steepest = new Float64Array(changes.length);
    let maximum = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * width + i, b = a + 1, c = b + width, e = a + width;
        if (!(d[a] && d[b] && d[c] && d[e])) continue;
        // Bound the bilinear gradient by the steepest corner, including saddle cells.
        const dx = Math.max(Math.abs(v[b] - v[a]), Math.abs(v[c] - v[e]));
        const dy = Math.max(Math.abs(v[e] - v[a]), Math.abs(v[c] - v[b]));
        const change = Math.sqrt(dx * dx + dy * dy);
        if (!Number.isFinite(change)) continue;
        changes[j * cols + i] = change;
        maximum = Math.max(maximum, change);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cell = j * cols + i;
        if (!changes[cell]) continue;
        let nearby = changes[cell];
        const left = Math.max(0, i - 1), right = Math.min(cols - 1, i + 1);
        for (let y = Math.max(0, j - 1); y <= Math.min(rows - 1, j + 1); y++)
            for (let x = left; x <= right; x++) nearby = Math.max(nearby, changes[y * cols + x]);
        steepest[cell] = nearby;
    }
    const cachedSlopes = { grid, defined: d, steepest, maximum };
    slopes.set(v, cachedSlopes);
    return cachedSlopes;
}

type Segment = (rank: number, value: number, from: Point, to: Point, label: boolean) => void;

export function traceContours(grid: Grid, samples: FieldSamples, base: number, scale: number, segment: Segment) {
    const { width, height, step } = grid, cols = width - 1, rows = height - 1, v = samples.values;
    if (cols < 1 || rows < 1) return;
    const { steepest, maximum } = cellSlopes(grid, samples);
    if (!maximum) return;
    const minChange = contourStyle.minSpacing / (step * scale), labelChange = contourStyle.labelSpacing / (step * scale);
    const intervals = contourIntervals(base, maximum * minChange);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const change = steepest[j * cols + i];
        if (!change) continue;
        const k = j * width + i, a = v[k], b = v[k + 1], c = v[k + 1 + width], d = v[k + width];
        const low = Math.min(a, b, c, d), high = Math.max(a, b, c, d);
        const index = contourIntervalIndex(intervals, change * minChange), interval = intervals[index];
        const first = Math.ceil(low / interval), last = Math.floor(high / interval);
        const x = grid.x(i), y = grid.y(j), right = grid.x(i + 1), bottom = grid.y(j + 1);
        for (let n = first; n <= last; n++) {
            const level = n === 0 ? 0 : n * interval;
            const topLeft = a >= level, topRight = b >= level, bottomRight = c >= level, bottomLeft = d >= level;
            if (topLeft === topRight && topLeft === bottomRight && topLeft === bottomLeft) continue;
            const points: Point[] = [];
            if (topLeft !== topRight) points.push([x + step * (level - a) / (b - a), y]);
            if (topRight !== bottomRight) points.push([right, y - step * (level - b) / (c - b)]);
            if (bottomLeft !== bottomRight) points.push([x + step * (level - d) / (c - d), bottom]);
            if (topLeft !== bottomLeft) points.push([x, y - step * (level - a) / (d - a)]);
            if (points.length === 4 && (a - level) * (c - level) < (b - level) * (d - level))
                points.push(points.shift()!);
            const rank = contourRank(n, index);
            const label = rank !== zeroRank && rank >= contourStyle.labelRank && interval >= change * labelChange;
            for (let p = 0; p < points.length; p += 2) {
                const from = points[p], to = points[p + 1];
                if (from[0] !== to[0] || from[1] !== to[1]) segment(rank, level, from, to, label);
            }
        }
    }
}

interface ContourLabel { value: number; point: Point }
interface Contours {
    grid: Grid; defined: Uint8Array; precision: number; scale: number; base: number;
    paths: (Path2D | undefined)[]; labels: ContourLabel[];
}
const contours = new WeakMap<Float32Array, Contours>();

export function fieldContours(grid: Grid, samples: FieldSamples, precision: number, scale: number) {
    const cached = contours.get(samples.values);
    const { defined } = samples;
    if (cached?.grid === grid && cached.defined === defined && cached.precision === precision && cached.scale === scale) return cached;
    const base = shiftDecimal(precision, 1), paths = new Array<Path2D | undefined>(zeroRank + 1);
    const labels = Array.from({ length: zeroRank }, (): ContourLabel[] => []);
    traceContours(grid, samples, base, scale, (rank, value, from, to, label) => {
        const path = paths[rank] ??= new Path2D();
        path.moveTo(...from); path.lineTo(...to);
        if (label) labels[rank].push({ value, point: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] });
    });
    const rendered = { grid, defined, precision, scale, base, paths, labels: labels.reverse().flat() };
    contours.set(samples.values, rendered);
    return rendered;
}