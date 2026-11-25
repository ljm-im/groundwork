import { type Point } from "./geometry.ts";

export function insidePolygon(polygon: { points: Point[] }, point: Point) {
    const [x, y] = point, points = polygon.points;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
    }
    return inside;
}

export function polygonArea(points: readonly Point[]) {
    const edges = points.flatMap((a, i) => {
        const b = points[(i + 1) % points.length];
        if (a[0] === b[0]) return [];
        const [left, right] = a[0] < b[0] ? [a, b] : [b, a];
        return [{ left, right, slope: (right[1] - left[1]) / (right[0] - left[0]) }];
    }).sort((a, b) => a.left[0] - b.left[0]);
    const cuts = new Set(points.map(p => p[0]));
    const yAt = ({ left, slope }: typeof edges[number], x: number) => left[1] + (x - left[0]) * slope;
    for (const [i, a] of edges.entries()) {
        for (let j = i + 1; j < edges.length && edges[j].left[0] < a.right[0]; j++) {
            const b = edges[j], start = b.left[0], end = Math.min(a.right[0], b.right[0]);
            const first = yAt(a, start) - yAt(b, start), last = yAt(a, end) - yAt(b, end);
            if (first < 0 && last > 0 || first > 0 && last < 0)
                cuts.add(start + (end - start) * (first / (first - last)));
        }
    }
    // Between consecutive vertices and crossings, the filled vertical width varies linearly.
    const sorted = [...cuts].sort((a, b) => a - b);
    let area = 0, next = 0, active: typeof edges = [];
    for (let i = 1; i < sorted.length; i++) {
        const width = sorted[i] - sorted[i - 1], x = sorted[i - 1] + width / 2;
        while (next < edges.length && edges[next].left[0] < x) active.push(edges[next++]);
        active = active.filter(edge => edge.right[0] > x);
        const ys = active.map(edge => yAt(edge, x)).sort((a, b) => a - b);
        for (let j = 1; j < ys.length; j += 2) area += width * (ys[j] - ys[j - 1]);
    }
    return area;
}