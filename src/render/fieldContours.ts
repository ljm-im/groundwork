import { type FieldSamples } from "../core/design/results.ts";
import { distance, mixPoint, type Box, type Grid, type Point } from "../core/math/geometry.ts";
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
    return Math.min(contourTier(level, intervalIndex), zeroRank - 1);
}

function contourTier(level: number, tier: number) {
    while (level) {
        const factor = factors[tier % factors.length];
        if (level % factor !== 0) break;
        level /= factor;
        tier++;
    }
    return tier;
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

interface Span { from: Point; to: Point; spacing: number }
interface Link extends Span { edges: [number, number] }
export interface ContourLine { value: number; tier: number; spans: Span[] }
type Segment = (rank: number, value: number, from: Point, to: Point, label: boolean,
    crossing: { edges: Link["edges"]; level: number; tier: number; spacing: number }) => void;

export function traceContours(grid: Grid, samples: FieldSamples, base: number, scale: number, segment: Segment, connectCorners = false) {
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
            // Number both grid edges at each sample so neighboring cells share the same crossing identity.
            const points: [number, Point][] = [];
            if (topLeft !== topRight) points.push([2 * k, [x + step * (level - a) / (b - a), y]]);
            if (topRight !== bottomRight) points.push([2 * (k + 1) + 1, [right, y - step * (level - b) / (c - b)]]);
            if (bottomLeft !== bottomRight) points.push([2 * (k + width), [x + step * (level - d) / (c - d), bottom]]);
            if (topLeft !== bottomLeft) points.push([2 * k + 1, [x, y - step * (level - a) / (d - a)]]);
            if (points.length === 4 && (a - level) * (c - level) < (b - level) * (d - level))
                points.push(points.shift()!);
            const tier = n === 0 ? -1 : contourTier(n, index), rank = n === 0 ? zeroRank : Math.min(tier, zeroRank - 1);
            const label = rank !== zeroRank && rank >= contourStyle.labelRank && interval >= change * labelChange;
            const spacing = interval / change * (step * scale), levelIndex = n === 0 ? 0 : Math.round(level / base);
            for (let p = 0; p < points.length; p += 2) {
                const [fromEdge, from] = points[p], [toEdge, to] = points[p + 1];
                if (connectCorners || from[0] !== to[0] || from[1] !== to[1])
                    segment(rank, level, from, to, label, { edges: [fromEdge, toEdge], level: levelIndex, tier, spacing });
            }
        }
    }
}

type FieldDomain = { grid: Grid; defined: Uint8Array };

function isBoundaryEdge(edge: number, { grid: { width, height }, defined }: FieldDomain) {
    const k = Math.floor(edge / 2), x = k % width, y = Math.floor(k / width), vertical = edge % 2 === 1;
    const cellDefined = (i: number, j: number) => {
        if (i < 0 || i >= width - 1 || j < 0 || j >= height - 1) return false;
        const a = j * width + i;
        return defined[a] && defined[a + 1] && defined[a + width] && defined[a + width + 1];
    };
    return !cellDefined(x, y) || !cellDefined(vertical ? x - 1 : x, vertical ? y : y - 1);
}

export function connectContourLinks(value: number, tier: number, links: Link[], domain?: FieldDomain): ContourLine[] {
    const junctions = new Map<number, Link[]>(), unvisited = new Set(links), lines: ContourLine[] = [];
    let boundaryLine: ContourLine | undefined;
    for (const link of links) for (const edge of link.edges) {
        const adjacent = junctions.get(edge);
        if (adjacent) adjacent.push(link);
        else junctions.set(edge, [link]);
    }
    function trace(first: Link, start: number) {
        const spans: Span[] = [];
        let link: Link | undefined = first, edge = start;
        while (link && unvisited.delete(link)) {
            const reversed = link.edges[1] === edge;
            const { from, to, spacing } = link;
            spans.push({ from: reversed ? to : from, to: reversed ? from : to, spacing });
            edge = link.edges[reversed ? 0 : 1];
            link = junctions.get(edge)?.find(next => unvisited.has(next));
        }
        if (!spans.length) return;
        const onBoundary = domain && edge !== start && (isBoundaryEdge(start, domain) || isBoundaryEdge(edge, domain));
        if (onBoundary && boundaryLine) {
            for (const span of spans) boundaryLine.spans.push(span);
        }
        else {
            const line = { value, tier, spans };
            lines.push(line);
            if (onBoundary) boundaryLine = line;
        }
    }
    for (const [edge, adjacent] of junctions) if (adjacent.length === 1) trace(adjacent[0], edge);
    for (const link of unvisited) trace(link, link.edges[0]);
    return lines;
}

function clip(a: Point, b: Point, box: Box): [number, number] | undefined {
    let start = 0, end = 1;
    for (const axis of [0, 1] as const) {
        const delta = b[axis] - a[axis], lower = box[axis], upper = box[axis + 2];
        if (!delta) {
            if (a[axis] < lower || a[axis] > upper) return;
            continue;
        }
        const near = (lower - a[axis]) / delta, far = (upper - a[axis]) / delta;
        start = Math.max(start, Math.min(near, far));
        end = Math.min(end, Math.max(near, far));
        if (start > end) return;
    }
    return [start, end];
}

export function contourLabels(lines: readonly ContourLine[], width: number, height: number, screen: (p: Point) => Point,
    measure: (value: number) => Point) {
    const { labelInset, labelRank, labelSpacing, labelLength } = contourStyle;
    const viewport: Box = [0, 0, width, height], interior: Box = [labelInset, labelInset, width - labelInset, height - labelInset];
    const center: Point = [width / 2, height / 2];
    const accepted: { value: number; point: Point; box: Box }[] = [];
    if (interior[0] >= interior[2] || interior[1] >= interior[3]) return accepted;
    for (const { value, spans } of lines.filter(line => line.tier >= labelRank).sort((a, b) => b.tier - a.tier)) {
        let length = 0, bestSpacing = 0, bestDistance = Infinity, point: Point | undefined;
        for (const { from, to, spacing } of spans) {
            const a = screen(from), b = screen(to), visible = clip(a, b, viewport);
            if (!visible) continue;
            const pixels = distance(a, b);
            length += pixels * (visible[1] - visible[0]);
            if (!pixels || spacing < labelSpacing || spacing < bestSpacing) continue;
            const inset = clip(a, b, interior);
            if (!inset || inset[0] === inset[1]) continue;
            const candidate = mixPoint(a, b, (inset[0] + inset[1]) / 2), gap = distance(center, candidate);
            if (spacing === bestSpacing && gap >= bestDistance) continue;
            point = candidate; bestSpacing = spacing; bestDistance = gap;
        }
        if (length < labelLength || !point) continue;
        const [x, y] = point, [w, h] = measure(value), box: Box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        if (accepted.some(({ box: other }) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) continue;
        accepted.push({ value, point, box });
    }
    return accepted;
}

interface Contours {
    grid: Grid; defined: Uint8Array; precision: number; scale: number; base: number;
    paths: (Path2D | undefined)[]; lines: ContourLine[];
}
const contours = new WeakMap<Float32Array, Contours>();

export function fieldContours(grid: Grid, samples: FieldSamples, precision: number, scale: number) {
    const cached = contours.get(samples.values);
    const { defined } = samples;
    if (cached?.grid === grid && cached.defined === defined && cached.precision === precision && cached.scale === scale) return cached;
    const base = shiftDecimal(precision, 1), paths = new Array<Path2D | undefined>(zeroRank + 1);
    const levels = new Map<number, { value: number; tier: number; links: Link[] }>();
    traceContours(grid, samples, base, scale, (rank, value, from, to, _label, { edges, level, tier, spacing }) => {
        if (from[0] !== to[0] || from[1] !== to[1]) {
            const path = paths[rank] ??= new Path2D();
            path.moveTo(...from); path.lineTo(...to);
        }
        let line = levels.get(level);
        if (!line) levels.set(level, line = { value, tier, links: [] });
        line.links.push({ edges, from, to, spacing });
    }, true);
    const domain = { grid, defined };
    const lines = [...levels.values()].flatMap(({ value, tier, links }) => connectContourLinks(value, tier, links, domain));
    const rendered = { grid, defined, precision, scale, base, paths, lines };
    contours.set(samples.values, rendered);
    return rendered;
}