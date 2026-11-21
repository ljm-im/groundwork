import { bearing, clamp, mixPoint, nearest, type Point } from "../math/geometry.ts";
import { perimeter, signedArea } from "../math/polygon.ts";
import { type Ellipse } from "./types.ts";

export interface Boundary { points: Point[]; ellipse?: Ellipse | null }

export function gateFraction(yard: Boundary, point: Point) {
    const { s, length } = perimeter(yard);
    let { segment, t } = nearest(...point, yard.points, true);
    if (yard.ellipse) {
        const { center, radii: [rx, ry] } = yard.ellipse, step = 2 * Math.PI / yard.points.length;
        const x = point[0] - center[0], y = point[1] - center[1];
        let angle = (segment + t) * step;
        for (let i = 0; i < 6; i++) {
            const c = Math.cos(angle), n = Math.sin(angle), dx = rx * c - x, dy = ry * n - y;
            const slope = rx * rx * n * n + ry * ry * c * c - dx * rx * c - dy * ry * n;
            if (Math.abs(slope) < 1e-9) break;
            angle -= clamp((-dx * rx * n + dy * ry * c) / slope, -step, step);
        }
        const u = ((angle / step % yard.points.length) + yard.points.length) % yard.points.length;
        segment = Math.floor(u);
        t = u - segment;
    }
    return ((s[segment] + t * (s[segment + 1] - s[segment])) / length) % 1;
}

export function gatePose(yard: Boundary, at: number): { point: Point; angle: number } {
    const { points, s, length } = perimeter(yard);
    const station = at * length;
    let i = 0;
    while (i < points.length - 2 && s[i + 1] <= station) i++;
    const t = clamp((station - s[i]) / (s[i + 1] - s[i]));
    if (yard.ellipse) {
        const { center, radii: [rx, ry] } = yard.ellipse;
        const theta = 2 * Math.PI * (i + t) / yard.points.length, c = Math.cos(theta), n = Math.sin(theta);
        return { point: [center[0] + rx * c, center[1] + ry * n], angle: Math.atan2(n / ry, c / rx) };
    }
    const sign = Math.sign(signedArea(yard.points));
    let angle = bearing(points[i], points[i + 1]) - sign * Math.PI / 2;
    // At a corner the bisector points out of both adjacent wall segments.
    if (t < 1e-7 || t > 1 - 1e-7) {
        const n = yard.points.length;
        const j = t < .5 ? (i + n - 1) % n : (i + 1) % n;
        const other = bearing(points[j], points[j + 1]) - sign * Math.PI / 2;
        angle = Math.atan2(Math.sin(angle) + Math.sin(other), Math.cos(angle) + Math.cos(other));
    }
    return { point: mixPoint(points[i], points[i + 1], t), angle };
}

export function gateDistance(a: { at?: number }, b: { at?: number }, length: number) {
    const delta = Math.abs(a.at! - b.at!);
    return Math.min(delta, 1 - delta) * length;
}