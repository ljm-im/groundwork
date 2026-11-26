import { type Curve, type Point } from "./v5.ts";
import { distance, mixPoint, projection } from "../math/geometry.ts";

export interface Segment { a: Point; b: Point; from?: string }
export type Bezier = [Point, Point, Point, Point];
export type SegmentType = "line" | "curve" | "arc";

export const defaultArcBulge = .4142135624;
export const degreesFromBulge = (bulge: number) => Math.atan(bulge) * (720 / Math.PI);

export function bulgeFromDegrees(angle: number) {
    if (!Number.isFinite(angle) || angle === 0 || Math.abs(angle) >= 360)
        throw Error("请输入大于 −360°、小于 360° 且非零的数字");
    return Math.tan(angle * (Math.PI / 720)) || Math.sign(angle) * Number.MIN_VALUE;
}

export function splitBezier([a, b, c, d]: Bezier, t: number): [Bezier, Bezier] {
    const ab = mixPoint(a, b, t), bc = mixPoint(b, c, t), cd = mixPoint(c, d, t);
    const left = mixPoint(ab, bc, t), right = mixPoint(bc, cd, t), mid = mixPoint(left, right, t);
    return [[a, ab, left, mid], [mid, right, cd, d]];
}

export function flattenBezier(curve: Bezier, tolerance: number, add: (point: Point, t: number) => void, minDepth = 0) {
    // The two inner control points together have weight at most 3/4.
    // Preserve the existing boundary sampling while bounding profile samples more closely.
    const chordBound = minDepth ? .75 : 1;
    function visit(curve: Bezier, t0: number, t1: number, depth: number) {
        const [a, b, c, d] = curve, mid = (t0 + t1) / 2;
        const gap = (p: Point) => distance(p, mixPoint(a, d, projection(...p, a, d)));
        if (mid === t0 || depth >= minDepth && chordBound * Math.max(gap(b), gap(c)) <= tolerance) {
            add(d, t1);
            return;
        }
        const [left, right] = splitBezier(curve, .5);
        visit(left, t0, mid, depth + 1);
        visit(right, mid, t1, depth + 1);
    }
    visit(curve, 0, 1, 0);
}

export function arcGeometry(a: Point, b: Point, bulge: number) {
    const dx = b[0] - a[0], dy = b[1] - a[1], factor = (1 / bulge - bulge) / 4;
    const cx = (a[0] + b[0]) / 2 - dy * factor, cy = (a[1] + b[1]) / 2 + dx * factor;
    const radius = Math.hypot(dx, dy) * (Math.abs(bulge) + 1 / Math.abs(bulge)) / 4;
    return { cx, cy, radius, start: Math.atan2(a[1] - cy, a[0] - cx), angle: 4 * Math.atan(bulge) };
}

function flattenArc(a: Point, b: Point, bulge: number, tolerance: number, out: Point[]) {
    const chord = distance(a, b);
    if (!chord || Math.abs(bulge) <= 1 && Math.abs(bulge) * chord / 2 <= tolerance) {
        out.push(b);
        return;
    }
    const { cx, cy, radius, start, angle } = arcGeometry(a, b, bulge);
    const maxAngle = 4 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * radius))));
    const n = Math.max(1, Math.ceil(Math.abs(angle) / maxAngle));
    for (let i = 1; i < n; i++) {
        const t = start + angle * i / n;
        out.push([cx + radius * Math.cos(t), cy + radius * Math.sin(t)]);
    }
    out.push(b);
}

export function neighbor(path: Curve, i: number, step: -1 | 1): number | undefined {
    const j = i + step, count = path.nodes.length;
    return path.closed ? (j + count) % count : j >= 0 && j < count ? j : undefined;
}

export function segmentNeighbor(path: Curve, i: number, step: -1 | 1) {
    const next = neighbor(path, i, step);
    if (next !== undefined && neighbor(path, next, 1) !== undefined) return next;
}

export function autoHandle(path: Curve, i: number, side: "in" | "out"): Point {
    const { nodes } = path, prev = nodes[neighbor(path, i, -1) ?? i].p, next = nodes[neighbor(path, i, 1) ?? i].p;
    const sign = side === "in" ? -1 : 1;
    return [(next[0] - prev[0]) * sign / 6, (next[1] - prev[1]) * sign / 6];
}

export function hasHandleSide(path: Curve, i: number, side: "in" | "out") {
    const adjacent = neighbor(path, i, side === "in" ? -1 : 1);
    return adjacent !== undefined && path.nodes[side === "in" ? adjacent : i].bulge === undefined;
}

export function handleOffset(path: Curve, i: number, side: "in" | "out") {
    if (!hasHandleSide(path, i, side)) return;
    const node = path.nodes[i];
    return node.mode === "auto" ? autoHandle(path, i, side) : node[side];
}

export function pathHandle(path: Curve, i: number, side: "in" | "out"): Point {
    const { p } = path.nodes[i], offset = handleOffset(path, i, side);
    return offset ? [p[0] + offset[0], p[1] + offset[1]] : p;
}

export function segmentType(path: Curve, i: number): SegmentType | undefined {
    const next = neighbor(path, i, 1);
    if (next === undefined) return;
    if (path.nodes[i].bulge !== undefined) return "arc";
    return handleOffset(path, i, "out")?.some(Boolean) || handleOffset(path, next, "in")?.some(Boolean) ? "curve" : "line";
}

export function pathBezier(path: Curve, i: number): Bezier {
    const next = neighbor(path, i, 1)!;
    return [path.nodes[i].p, pathHandle(path, i, "out"), pathHandle(path, next, "in"), path.nodes[next].p];
}

function appendSegment(path: Curve, i: number, j: number, tolerance: number, minDepth: number, segments: Segment[]) {
    const v = path.nodes[i], next = path.nodes[j], points = [v.p];
    if (v.bulge !== undefined) flattenArc(v.p, next.p, v.bulge, tolerance, points);
    else if (segmentType(path, i) === "line") points.push(next.p);
    else flattenBezier(pathBezier(path, i), tolerance, p => points.push(p), minDepth);
    const start = segments.length;
    for (let k = 1; k < points.length; k++)
        if (distance(points[k - 1], points[k]) > 0) segments.push({ a: points[k - 1], b: points[k], from: v.id });
    if (segments.length === start) segments.push({ a: v.p, b: next.p, from: v.id });
}

export function flattenSegment(path: Curve, i: number, tolerance: number) {
    const segments: Segment[] = [], j = neighbor(path, i, 1);
    if (j !== undefined) appendSegment(path, i, j, tolerance, 0, segments);
    return segments;
}

export function flattenPath(path: Curve, tolerance: number, minDepth = 0) {
    const segments: Segment[] = [];
    for (let i = 0; i < path.nodes.length; i++) {
        const j = neighbor(path, i, 1);
        if (j === undefined) break;
        appendSegment(path, i, j, tolerance, minDepth, segments);
    }
    return segments;
}