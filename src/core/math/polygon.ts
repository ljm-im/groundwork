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