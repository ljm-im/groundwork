import { type ResolvedDesign as Design, type Construction, type GeoNode, type ClosedCurve, type Point, type Strip } from "./v5.ts";
import { bounds, clamp, createGrid, distance, mixPoint, projection, type Box, type Grid } from "../math/geometry.ts";
import { functionTable } from "./functionTable.ts";
import { insidePolygon, polygonArea } from "../math/polygon.ts";
import { indexSegments, segmentProjection, type IndexedSegment } from "../math/segmentIndex.ts";
import { flattenPath, type Segment } from "./path.ts";

export { type Segment } from "./path.ts";

export interface CrossSection { s: number; first: boolean; at: Point; normal: Point }
export interface RegionShape {
    box: Box;
    contains: (p: Point) => boolean;
    boundary: () => Segment[][];
    containingOutlines?: (p: Point) => number[];
    spine?: Segment[];
    reach?: number;
    spineIndex?: Pick<ReturnType<typeof indexSegments>, "forRow">;
    cross?: (p: Point) => CrossSection | undefined;
}
export interface Region {
    shape: RegionShape;
    cells: Int32Array;
    mask: Uint8Array;
    left: number;
    top: number;
    width: number;
    height: number;
    canvasWidth: number;
}

export const intersects = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const expand = (b: Box, w: number): Box => [b[0] - w, b[1] - w, b[2] + w, b[3] + w];

function rangeOf(paths: Segment[][], range: Strip["range"]) {
    if (!range) return paths.flat();
    const path = paths.find(parts => [range.from, range.to].every(id => parts.some(s => s.from === id)));
    if (!path) return [];
    const i = path.findIndex(s => s.from === range.from);
    const rotated = path.slice(i).concat(path.slice(0, i));
    const stop = rotated.findIndex((s, j) => j > 0 && s.from !== rotated[j - 1].from && s.from === range.to);
    return stop < 0 ? rotated : rotated.slice(0, stop);
}

function commonEdge(segment: Segment, lower: RegionShape, lowerEdges: Segment[], tolerance: number): Segment[] {
    const { a, b } = segment, dx = b[0] - a[0], dy = b[1] - a[1], length = distance(a, b);
    if (!length) return [];
    const cuts = [0, 1], coincident: Point[] = [];
    for (const { a: p, b: q } of lowerEdges) {
        const ex = q[0] - p[0], ey = q[1] - p[1], det = dx * ey - dy * ex;
        const px = p[0] - a[0], py = p[1] - a[1];
        if (Math.abs(det) > 1e-12) {
            const t = (px * ey - py * ex) / det, u = (px * dy - py * dx) / det;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
        }
        // A shared run projects onto the segment, unlike two ends merely touching.
        if (Math.abs(dx * py - dy * px) / length <= tolerance &&
            Math.abs(dx * (q[1] - a[1]) - dy * (q[0] - a[0])) / length <= tolerance) {
            const u = projection(p[0], p[1], a, b), v = projection(q[0], q[1], a, b);
            if (u !== v) {
                cuts.push(u, v);
                coincident.push([Math.min(u, v), Math.max(u, v)]);
            }
        }
    }
    cuts.sort((u, v) => u - v);
    const edges: Segment[] = [];
    for (let i = 1; i < cuts.length; i++) {
        const lo = cuts[i - 1], hi = cuts[i], t = (lo + hi) / 2;
        if (hi > lo && (lower.contains(mixPoint(a, b, t)) || coincident.some(([l, h]) => l <= t && t <= h)))
            edges.push({ a: mixPoint(a, b, lo), b: mixPoint(a, b, hi) });
    }
    return edges;
}

type ColumnRange = { start: number; end: number };

// Intersect the capsule around a segment with the current scanline.
function traceColumns(entry: IndexedSegment<Segment>, reach: number, y: number, xMin: number, step: number, nx: number, ranges: ColumnRange[]) {
    const { segment: { a, b }, dx, dy, length, padding } = entry, radius = reach + step + padding;
    if (y < Math.min(a[1], b[1]) - radius || y > Math.max(a[1], b[1]) + radius) return;
    const previous = ranges[ranges.length - 1];
    if (previous && xMin + previous.start * step <= Math.min(a[0], b[0]) - radius &&
        xMin + previous.end * step >= Math.max(a[0], b[0]) + radius) return;
    let left = Infinity, right = -Infinity;
    const ra = radius ** 2 - (y - a[1]) ** 2, rb = radius ** 2 - (y - b[1]) ** 2;
    if (ra >= 0) {
        const span = Math.sqrt(ra);
        left = a[0] - span; right = a[0] + span;
    }
    if (rb >= 0) {
        const span = Math.sqrt(rb);
        left = Math.min(left, b[0] - span); right = Math.max(right, b[0] + span);
    }
    if (dy) {
        const offsetX = -dy / length * radius, offsetY = dx / length * radius;
        for (let sign = -1; sign <= 1; sign += 2) {
            const ay = a[1] + sign * offsetY, by = b[1] + sign * offsetY;
            if (y < Math.min(ay, by) || y > Math.max(ay, by)) continue;
            const x = a[0] + sign * offsetX + dx * ((y - ay) / dy);
            left = Math.min(left, x); right = Math.max(right, x);
        }
    }
    const start = Math.max(0, Math.floor((left - xMin) / step)), end = Math.min(nx, Math.ceil((right - xMin) / step));
    if (!(start <= end)) return;
    if (previous && start <= previous.end + 1 && end >= previous.start - 1) {
        previous.start = Math.min(previous.start, start);
        previous.end = Math.max(previous.end, end);
    }
    else ranges.push({ start, end });
}

function mergeColumns(ranges: ColumnRange[]) {
    ranges.sort((a, b) => a.start - b.start);
    let length = 0;
    for (const range of ranges) {
        const previous = ranges[length - 1];
        if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
        else ranges[length++] = range;
    }
    ranges.length = length;
}

// Trace implicit strip boundaries only when another construction needs their contour.
// Every traced segment fits inside one square of diagonal at most the flattening tolerance.
export function trace(shape: RegionShape, tolerance: number, clip?: Box) {
    if (!shape.box.every(Number.isFinite)) return [];
    const step = tolerance / Math.SQRT2, box = expand(shape.box, step), segments: Segment[] = [];
    if (clip) {
        if (!intersects(box, clip)) return [];
        box[0] = Math.max(box[0], clip[0]); box[1] = Math.max(box[1], clip[1]);
        box[2] = Math.min(box[2], clip[2]); box[3] = Math.min(box[3], clip[3]);
    }
    const nx = Math.ceil((box[2] - box[0]) / step), ny = Math.ceil((box[3] - box[1]) / step);
    const { spine, reach } = shape, index = spine && reach !== undefined ? shape.spineIndex ?? indexSegments(spine, reach) : undefined;
    const full = [{ start: 0, end: nx }], point: Point = [0, 0], hits: Point[] = [];
    let previous = new Uint8Array(nx + 1), row = new Uint8Array(nx + 1);
    let previousRanges: ColumnRange[] = [], ranges: ColumnRange[] = [];
    for (let j = 0; j <= ny; j++) {
        const y = box[1] + j * step;
        if (index) {
            ranges.length = 0;
            index.forRow(y, step, edge => traceColumns(edge, reach!, y, box[0], step, nx, ranges));
            mergeColumns(ranges);
        }
        else ranges = full;
        row.fill(0);
        point[1] = y;
        for (const { start, end } of ranges) {
            for (let i = start; i <= end; i++) {
                point[0] = box[0] + i * step;
                row[i] = +shape.contains(point);
            }
        }

        // A square can cross the contour if either row visits one of its two columns.
        if (j) {
            let current = 0, last = 0, visited = 0;
            while (current < ranges.length || last < previousRanges.length) {
                const a = ranges[current], b = previousRanges[last];
                const range = !b || a && a.start <= b.start ? ranges[current++] : previousRanges[last++];
                const end = Math.min(nx, range.end + 1);
                for (let i = Math.max(1, range.start, visited + 1); i <= end; i++) {
                    const tl = previous[i - 1], tr = previous[i], bl = row[i - 1], br = row[i];
                    if (tl === tr && tr === br && br === bl) continue;
                    const x = box[0] + i * step;
                    hits.length = 0;
                    if (tl !== tr) hits.push([x - step / 2, y - step]);
                    if (tr !== br) hits.push([x, y - step / 2]);
                    if (br !== bl) hits.push([x - step / 2, y]);
                    if (bl !== tl) hits.push([x - step, y - step / 2]);
                    for (let k = 1; k < hits.length; k += 2) segments.push({ a: hits[k - 1], b: hits[k] });
                }
                visited = Math.max(visited, end);
            }
        }

        const next = previous, nextRanges = previousRanges;
        previous = row; row = next;
        previousRanges = ranges; ranges = nextRanges;
    }
    return [segments];
}

export function nearbyBoundary(shape: RegionShape, p: Point, radius: number, tolerance: number) {
    if (!shape.spine) return shape.boundary();
    return trace(shape, tolerance, expand([p[0], p[1], p[0], p[1]], radius + tolerance));
}

export function makeShape(node: GeoNode<number, never>, below: Map<string, RegionShape>, tolerance: number): RegionShape {
    const c = node.construction;
    if (c.type === "outline") {
        const outlines = c.outlines.map(p => flattenPath(p, tolerance));
        const polygons = outlines.map(path => ({ points: path.map(s => s.a) }));
        const areas: number[] = [];
        const area = (index: number) => areas[index] ??= polygonArea(polygons[index].points);
        return {
            boundary: () => outlines, box: bounds(polygons.flatMap(p => p.points)),
            contains(p) {
                let inside = false;
                for (const polygon of polygons) if (insidePolygon(polygon, p)) inside = !inside;
                return inside;
            },
            containingOutlines(p) {
                const hits = polygons.flatMap((polygon, i) => insidePolygon(polygon, p) ? [i] : []);
                return hits.sort((a, b) => area(a) - area(b));
            }
        };
    }
    const references = [...below.keys()].filter(id => c.of.some(ref => ref === id));
    const upperId = references.at(-1)!, upper = below.get(upperId)!;
    const lower = references.length === 2 ? below.get(references[0]) : undefined;
    const firstInside = upperId === c.of[0], [w1, w2] = c.widths;
    const outline = upper && references.length === c.of.length ? rangeOf(upper.boundary(), c.range) : [], lowerEdges = lower?.boundary().flat() ?? [];
    const edges = lower ? outline.flatMap(s => commonEdge(s, lower, lowerEdges, tolerance)) : outline;
    const oriented = edges.filter(({ a, b }) => distance(a, b) > 0).map(({ a, b }) => {
        const length = distance(a, b), nx = (a[1] - b[1]) / length, ny = (b[0] - a[0]) / length, mid = mixPoint(a, b, .5);
        const sign = upper.contains([mid[0] + nx * tolerance * .001, mid[1] + ny * tolerance * .001]) === firstInside ? -1 : 1;
        return { a, b, normal: [sign * nx, sign * ny] as Point };
    });
    const reach = Math.max(w1, w2), index = indexSegments(oriented, reach);
    function firstSide(p: Point) {
        if (!oriented.length) return;
        const inside = upper.contains(p);
        if (lower && !inside && !lower.contains(p)) return;
        return inside === firstInside;
    }
    function cross(p: Point): CrossSection | undefined {
        const first = firstSide(p);
        if (first === undefined) return;
        const width = first ? w1 : w2, [x, y] = p;
        const hit = index.nearest(x, y, width * width);
        if (!hit) return;
        const { segment: { a, normal }, dx, dy } = hit;
        const t = segmentProjection(x, y, hit);
        const ax = a[0] + dx * t, ay = a[1] + dy * t;
        const dist = Math.sqrt((x - ax) ** 2 + (y - ay) ** 2), sign = first ? -1 : 1;
        return { s: clamp((w1 + sign * dist) / (w1 + w2)), first, at: [ax, ay],
            normal: dist > 1e-9 ? [sign * (x - ax) / dist, sign * (y - ay) / dist] : normal };
    }
    function contains(p: Point) {
        const first = firstSide(p);
        if (first === undefined) return false;
        const width = first ? w1 : w2;
        return index.within(p[0], p[1], width * width);
    }
    let contour: Segment[][] | undefined;
    const shape: RegionShape = { box: expand(bounds(edges.flatMap(e => [e.a, e.b])), reach),
        spine: edges, reach, spineIndex: index, cross, contains, boundary: () => contour ??= trace(shape, tolerance) };
    return shape;
}

export function canvasGrid(d: Design, shapes: Map<string, RegionShape>) {
    const boxes = d.geoNodes.filter(n => !n.disabled && functionTable[n.function.type].initial).map(n => {
        const shape = shapes.get(n.id)!;
        if (n.construction.type === "outline") return shape.box;
        return bounds(shape.boundary().flatMap(path => path.flatMap(s => [s.a, s.b])));
    });
    const { step } = d.grid, low = (x: number) => Math.floor(x / step) * step, high = (x: number) => Math.ceil(x / step) * step;
    if (!boxes.length) return createGrid({ xMin: 0, yMin: 0, xMax: step, yMax: step, step });
    const xMin = low(Math.min(...boxes.map(b => b[0]))), yMin = low(Math.min(...boxes.map(b => b[1])));
    const xMax = high(Math.max(...boxes.map(b => b[2]))), yMax = high(Math.max(...boxes.map(b => b[3])));
    if (![xMin, yMin, xMax, yMax].every(Number.isFinite) || xMax <= xMin || yMax <= yMin) throw new Error("画布范围为空");
    return createGrid({ xMin, xMax, yMin, yMax, step });
}

export function rasterRegion(grid: Grid, shape: RegionShape): Region {
    const left = grid.col(shape.box[0]), right = grid.col(shape.box[2]);
    const top = grid.row(shape.box[3]), bottom = grid.row(shape.box[1]);
    const width = Math.max(0, right - left + 1), height = Math.max(0, bottom - top + 1);
    const mask = new Uint8Array(width * height), point: Point = [0, 0];
    let count = 0;
    for (let j = 0; j < height; j++) {
        point[1] = grid.y(top + j);
        const start = j * width;
        for (let i = 0; i < width; i++) {
            point[0] = grid.x(left + i);
            if (shape.contains(point)) {
                mask[start + i] = 1;
                count++;
            }
        }
    }
    const cells = new Int32Array(count);
    let index = 0;
    for (let j = 0; j < height; j++) {
        const start = j * width, canvasStart = (top + j) * grid.width + left;
        for (let i = 0; i < width; i++) if (mask[start + i]) cells[index++] = canvasStart + i;
    }
    return { cells, mask, shape, left, top, width, height, canvasWidth: grid.width };
}

export function regionMaskIndex(region: Region, k: number) {
    const i = k % region.canvasWidth - region.left, j = Math.floor(k / region.canvasWidth) - region.top;
    return i >= 0 && i < region.width && j >= 0 && j < region.height ? j * region.width + i : -1;
}

export function regionMaskAt(region: Region, k: number) {
    return region.mask[regionMaskIndex(region, k)] ?? 0;
}

function boundarySquaredDistance(x: number, y: number, entry: IndexedSegment<Segment>) {
    const { segment: { a }, dx, dy } = entry, t = segmentProjection(x, y, entry);
    return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2;
}

export function signedBoundaryDistance(shape: RegionShape, reach?: number) {
    const edges = shape.boundary().flat(), point: Point = [0, 0];
    const index = reach === undefined ? undefined : indexSegments(edges, reach);
    return (x: number, y: number) => {
        let best = Infinity;
        if (index) {
            const hit = index.nearest(x, y, Infinity, boundarySquaredDistance);
            if (hit) best = boundarySquaredDistance(x, y, hit);
        }
        else for (const { a, b } of edges) {
            const t = projection(x, y, a, b);
            best = Math.min(best, (x - a[0] - t * (b[0] - a[0])) ** 2 + (y - a[1] - t * (b[1] - a[1])) ** 2);
        }
        point[0] = x; point[1] = y;
        return (shape.contains(point) ? 1 : -1) * Math.sqrt(best);
    };
}

function pathCenter(path: ClosedCurve, tolerance: number): Point {
    const edges = flattenPath(path, tolerance);
    let area = 0, x = 0, y = 0;
    for (const { a, b } of edges) {
        const cross = a[0] * b[1] - b[0] * a[1];
        area += cross; x += (a[0] + b[0]) * cross; y += (a[1] + b[1]) * cross;
    }
    if (Math.abs(area) > 1e-8) return [x / (3 * area), y / (3 * area)];
    const box = bounds(path.nodes.map(v => v.p));
    return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

export function constructionCenter(c: Construction<number, never>, step: number, grid?: Grid, region?: Region): Point {
    if (c.type === "outline" && c.outlines.length === 1) return pathCenter(c.outlines[0], step / 8);
    if (grid && region?.cells.length) {
        const sum: Point = [0, 0];
        for (const k of region.cells) {
            const [x, y] = grid.point(k);
            sum[0] += x; sum[1] += y;
        }
        return [sum[0] / region.cells.length, sum[1] / region.cells.length];
    }
    const box = region?.shape.box;
    return box?.every(Number.isFinite) ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : [0, 0];
}

export function shapeLayout(d: Design) {
    const shapes = new Map<string, RegionShape>();
    for (const n of d.geoNodes) shapes.set(n.id, makeShape(n, shapes, d.grid.step / 8));
    return { grid: canvasGrid(d, shapes), shapes };
}