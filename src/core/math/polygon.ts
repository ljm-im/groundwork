import { distance, stations, type Point } from "./geometry.ts";

export function signedArea(points: Point[]) {
    return points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p[0] * q[1] - p[1] * q[0];
    }, 0) / 2;
}

export function simpleBoundary(points: Point[]) {
    if (Math.abs(signedArea(points)) < .01) return false;
    const side = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (distance(a, b) < .01) return false;
        for (let j = i + 2; j < points.length; j++) {
            const c = points[j], d = points[(j + 1) % points.length];
            if (d === a) continue;
            if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
          Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
            if (side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0) return false;
        }
    }
    return true;
}

export function insidePolygon(polygon: { points: Point[] }, point: Point) {
    const [x, y] = point, points = polygon.points;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
    }
    return inside;
}

export function perimeter(polygon: { points: Point[] }) {
    const points = [...polygon.points, polygon.points[0]], s = stations(points);
    return { points, s, length: s.at(-1)! };
}