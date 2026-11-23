import { type Path, type Point } from "./v5.ts";
import { distance, mixPoint, projection } from "../math/geometry.ts";

import { type Segment } from "./regions.ts";
export { type Segment } from "./regions.ts";

function flattenCurve(a: Point, b: Point, c: Point, d: Point, tolerance: number, out: Point[]) {
    const gap = (p: Point) => distance(p, mixPoint(a, d, projection(...p, a, d)));
    // The cubic lies in its control hull. Measuring against the finite chord also catches loops.
    if (Math.max(gap(b), gap(c)) <= tolerance) {
        out.push(d);
        return;
    }
    const ab = mixPoint(a, b, .5), bc = mixPoint(b, c, .5), cd = mixPoint(c, d, .5);
    const left = mixPoint(ab, bc, .5), right = mixPoint(bc, cd, .5), mid = mixPoint(left, right, .5);
    flattenCurve(a, ab, left, mid, tolerance, out);
    flattenCurve(mid, right, cd, d, tolerance, out);
}

function flattenArc(a: Point, b: Point, bulge: number, tolerance: number, out: Point[]) {
    const dx = b[0] - a[0], dy = b[1] - a[1], factor = (1 / bulge - bulge) / 4;
    const cx = (a[0] + b[0]) / 2 - dy * factor, cy = (a[1] + b[1]) / 2 + dx * factor;
    const radius = Math.hypot(dx, dy) * (Math.abs(bulge) + 1 / Math.abs(bulge)) / 4;
    const start = Math.atan2(a[1] - cy, a[0] - cx), angle = 4 * Math.atan(bulge);
    const maxAngle = 4 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * radius))));
    const n = Math.max(1, Math.ceil(Math.abs(angle) / maxAngle));
    for (let i = 1; i < n; i++) {
        const t = start + angle * i / n;
        out.push([cx + radius * Math.cos(t), cy + radius * Math.sin(t)]);
    }
    out.push(b);
}

export function pathHandle(path: Path, i: number, side: "in" | "out"): Point {
    const nodes = path.nodes, v = nodes[i], prev = nodes[(i + nodes.length - 1) % nodes.length].p, next = nodes[(i + 1) % nodes.length].p;
    const sign = side === "in" ? -1 : 1;
    const offset = v.mode === "auto" ? [(next[0] - prev[0]) * sign / 6, (next[1] - prev[1]) * sign / 6] : v[side] ?? [0, 0];
    return [v.p[0] + offset[0], v.p[1] + offset[1]];
}

export function flattenPath(path: Path, tolerance: number) {
    const { nodes } = path, count = nodes.length, segments: Segment[] = [];
    for (let i = 0; i < count; i++) {
        const v = nodes[i], next = nodes[(i + 1) % count], points = [v.p];
        if (v.next === "arc") flattenArc(v.p, next.p, v.bulge!, tolerance, points);
        else if (v.next === "line") points.push(next.p);
        else flattenCurve(v.p, pathHandle(path, i, "out"), pathHandle(path, (i + 1) % count, "in"), next.p, tolerance, points);
        const start = segments.length;
        for (let j = 1; j < points.length; j++)
            if (distance(points[j - 1], points[j]) > 0) segments.push({ a: points[j - 1], b: points[j], from: v.id });
        if (segments.length === start) segments.push({ a: v.p, b: next.p, from: v.id });
    }
    return segments;
}