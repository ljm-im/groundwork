import { clamp, type Point } from "./geometry.ts";

interface Segment { a: Point; b: Point }
export interface IndexedSegment<T extends Segment> {
    segment: T;
    order: number;
    dx: number;
    dy: number;
    denominator: number;
    padding: number;
}
type Metric<T extends Segment> = (x: number, y: number, entry: IndexedSegment<T>) => number;
interface BucketRow<T extends Segment> {
    columns: Map<number, IndexedSegment<T>[]>;
}

export function segmentProjection(x: number, y: number, entry: IndexedSegment<Segment>) {
    const { segment: { a }, dx, dy, denominator } = entry;
    return clamp(((x - a[0]) * dx + (y - a[1]) * dy) / denominator);
}

export function segmentSquaredDistance(x: number, y: number, entry: IndexedSegment<Segment>) {
    const { segment: { a }, dx, dy } = entry;
    const t = segmentProjection(x, y, entry);
    const ax = a[0] + dx * t, ay = a[1] + dy * t;
    return (x - ax) ** 2 + (y - ay) ** 2;
}

// Register the radius-expanded bounds so a query can read just its own bucket.
export function indexSegments<T extends Segment>(segments: readonly T[], radius: number) {
    const rows = new Map<number, BucketRow<T>>();
    const overflow: IndexedSegment<T>[] = [], empty: readonly IndexedSegment<T>[] = [];
    const bin = (value: number) => Math.floor(value / radius);
    const entries = segments.map((segment, order): IndexedSegment<T> => {
        const { a, b } = segment, dx = b[0] - a[0], dy = b[1] - a[1];
        const padding = 8 * Number.EPSILON * Math.max(1, radius, Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]));
        return { segment, order, dx, dy, denominator: dx * dx + dy * dy || 1, padding };
    });

    for (const entry of entries) {
        const { segment: { a, b }, padding } = entry, reach = radius + padding;
        const left = bin(Math.min(a[0], b[0]) - reach), right = bin(Math.max(a[0], b[0]) + reach);
        const bottom = bin(Math.min(a[1], b[1]) - reach), top = bin(Math.max(a[1], b[1]) + reach);
        // Keep very long edges and grids with unrepresentable bucket coordinates sparse.
        if (![left, right, bottom, top].every(Number.isSafeInteger) || (right - left + 1) * (top - bottom + 1) > 256) {
            overflow.push(entry);
            continue;
        }
        for (let j = bottom; j <= top; j++) {
            let row = rows.get(j);
            if (!row) rows.set(j, row = { columns: new Map() });
            for (let i = left; i <= right; i++) {
                const bucket = row.columns.get(i);
                if (bucket) bucket.push(entry);
                else row.columns.set(i, [entry]);
            }
        }
    }

    function find(x: number, y: number, limit: number, metric: Metric<T>, firstMatch: boolean) {
        const i = bin(x), j = bin(y), local = rows.get(j)?.columns.get(i);
        let hit: IndexedSegment<T> | undefined, best = limit;
        const fallback = Number.isSafeInteger(i) && Number.isSafeInteger(j) ? overflow : entries;
        let candidates: readonly IndexedSegment<T>[] = local ?? empty;
        for (let pass = 0; pass < 2; pass++, candidates = fallback) {
            for (let k = 0; k < candidates.length; k++) {
                const edge = candidates[k], d = metric(x, y, edge);
                if (d < best || d === best && d < Infinity && (!hit || edge.order < hit.order)) {
                    if (firstMatch) return edge;
                    best = d;
                    hit = edge;
                }
            }
        }
        return hit;
    }

    return {
        nearest: (x: number, y: number, limit = radius * radius, metric: Metric<T> = segmentSquaredDistance) => find(x, y, limit, metric, false),
        within: (x: number, y: number, limit: number) => !!find(x, y, limit, segmentSquaredDistance, true)
    };
}