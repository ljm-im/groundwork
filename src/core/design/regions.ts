import { type ResolvedDesign as Design, type Construction, type GeoNode, type ClosedCurve, type Point, type Strip } from "./v5.ts";
import { bounds, clamp, createGrid, distance, eachCell, mixPoint, projection, type Box, type Grid } from "../math/geometry.ts";
import { functionTable } from "./functionTable.ts";
import { insidePolygon, polygonArea } from "../math/polygon.ts";
import { flattenPath, type Segment } from "./path.ts";

export { type Segment } from "./path.ts";

export interface CrossSection { s: number; first: boolean; at: Point; normal: Point }
export interface RegionShape {
    box: Box;
    contains: (p: Point) => boolean;
    boundary: () => Segment[][];
    containingOutlines?: (p: Point) => number[];
    spine?: Segment[];
    cross?: (p: Point) => CrossSection | undefined;
}
export interface Region { shape: RegionShape; cells: number[]; mask: Uint8Array }

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
            const u = projection(...p, a, b), v = projection(...q, a, b);
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

// Trace implicit strip boundaries only when another construction needs their contour.
// Every traced segment fits inside one square of diagonal at most the flattening tolerance.
function trace(shape: RegionShape, tolerance: number, clip?: Box) {
    if (!shape.box.every(Number.isFinite)) return [];
    const step = tolerance / Math.SQRT2, box = expand(shape.box, step), segments: Segment[] = [];
    if (clip) {
        if (!intersects(box, clip)) return [];
        box[0] = Math.max(box[0], clip[0]); box[1] = Math.max(box[1], clip[1]);
        box[2] = Math.min(box[2], clip[2]); box[3] = Math.min(box[3], clip[3]);
    }
    const nx = Math.ceil((box[2] - box[0]) / step), ny = Math.ceil((box[3] - box[1]) / step);
    let previous = new Uint8Array(nx + 1);
    for (let j = 0; j <= ny; j++) {
        const row = new Uint8Array(nx + 1), y = box[1] + j * step;
        for (let i = 0; i <= nx; i++) {
            const x = box[0] + i * step;
            row[i] = +shape.contains([x, y]);
            if (!i || !j) continue;
            const hits: Point[] = [];
            if (previous[i - 1] !== previous[i]) hits.push([x - step / 2, y - step]);
            if (previous[i] !== row[i]) hits.push([x, y - step / 2]);
            if (row[i] !== row[i - 1]) hits.push([x - step / 2, y]);
            if (row[i - 1] !== previous[i - 1]) hits.push([x - step, y - step / 2]);
            for (let k = 1; k < hits.length; k += 2) segments.push({ a: hits[k - 1], b: hits[k] });
        }
        previous = row;
    }
    return [segments];
}

export function nearbyBoundary(shape: RegionShape, p: Point, radius: number, tolerance: number) {
    if (!shape.spine) return shape.boundary();
    return trace(shape, tolerance, expand([p[0], p[1], p[0], p[1]], radius + tolerance));
}

export function makeShape(node: GeoNode<number>, below: Map<string, RegionShape>, tolerance: number): RegionShape {
    const c = node.construction;
    if (c.type === "free") {
        const paths = c.paths.map(p => flattenPath(p, tolerance));
        const polygons = paths.map(path => ({ points: path.map(s => s.a) }));
        const areas: number[] = [];
        const area = (index: number) => areas[index] ??= polygonArea(polygons[index].points);
        return {
            boundary: () => paths,
            box: bounds(polygons.flatMap(p => p.points)),
            contains: p => polygons.reduce((inside, poly) => inside !== insidePolygon(poly, p), false),
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
    function cross(p: Point): CrossSection | undefined {
        const inside = upper.contains(p), first = inside === firstInside;
        if (lower && !inside && !lower.contains(p)) return;
        const width = first ? w1 : w2;
        let best = Infinity, at: Point | undefined, normal: Point = [0, 0];
        for (const edge of oriented) {
            const q = mixPoint(edge.a, edge.b, projection(...p, edge.a, edge.b));
            const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
            if (d < best) {
                best = d;
                at = q;
                normal = edge.normal;
            }
        }
        if (!at || best > width * width) return;
        const dist = Math.sqrt(best), sign = first ? -1 : 1;
        if (dist > 1e-9) normal = [sign * (p[0] - at[0]) / dist, sign * (p[1] - at[1]) / dist];
        return { s: clamp((w1 + sign * dist) / (w1 + w2)), first, at, normal };
    }
    let contour: Segment[][] | undefined;
    const shape: RegionShape = { box: expand(bounds(edges.flatMap(e => [e.a, e.b])), Math.max(w1, w2)),
        spine: edges, cross, contains: p => oriented.length > 0 && !!cross(p), boundary: () => contour ??= trace(shape, tolerance) };
    return shape;
}

export function canvasGrid(d: Design, shapes: Map<string, RegionShape>) {
    const boxes = d.geoNodes.filter(n => !n.disabled && functionTable[n.function.type].initial).map(n => {
        const shape = shapes.get(n.id)!;
        if (n.construction.type === "free") return shape.box;
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
    const mask = new Uint8Array(grid.size), cells: number[] = [];
    eachCell(grid, shape.box, 0, (k, x, y) => {
        if (shape.contains([x, y])) {
            cells.push(k);
            mask[k] = 1;
        }
    });
    return { cells, mask, shape };
}

export function signedBoundaryDistance(shape: RegionShape) {
    const edges = shape.boundary().flat();
    return (x: number, y: number) => {
        let best = Infinity;
        for (const { a, b } of edges) {
            const t = projection(x, y, a, b);
            best = Math.min(best, (x - a[0] - t * (b[0] - a[0])) ** 2 + (y - a[1] - t * (b[1] - a[1])) ** 2);
        }
        return (shape.contains([x, y]) ? 1 : -1) * Math.sqrt(best);
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

export function constructionCenter(c: Construction, step: number, grid?: Grid, region?: Region): Point {
    if (c.type === "free" && c.paths.length === 1) return pathCenter(c.paths[0], step / 8);
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