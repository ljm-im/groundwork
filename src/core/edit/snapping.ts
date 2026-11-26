import { bearing, distance, mixPoint, type Point } from "../math/geometry.ts";
import { indexSegments, segmentProjection, type IndexedSegment } from "../math/segmentIndex.ts";

export const snapPixels = 6;

export interface SnapPoint { point: Point; group: string; index: number }
export interface SnapLine { a: Point; b: Point; group: string }
export type SnapGuide = { kind: "point"; point: Point } | { kind: "align"; from: Point; to: Point };
export interface SnapRay { origin: Point; direction: Point }
interface SnapOptions { alignmentPoints?: readonly Point[]; exclude?: { group: string; indices?: readonly number[] } }
export interface SnapResult { point: Point; snapped?: true; guides?: SnapGuide[] }

const directions: Point[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const axes = [0, 1] as const;

export function directionRay(origin: Point, pointer: Point): SnapRay {
    const step = Math.round(bearing(origin, pointer) / (Math.PI / 4));
    return { origin, direction: directions[(step + 8) % 8] };
}

export function projectToRay({ origin, direction: [x, y] }: SnapRay, point: Point): Point {
    const t = Math.max(0, ((point[0] - origin[0]) * x + (point[1] - origin[1]) * y) / (x * x + y * y));
    return [origin[0] + t * x, origin[1] + t * y];
}

export function squareCorner(origin: Point, pointer: Point): Point {
    const x = pointer[0] - origin[0], y = pointer[1] - origin[1], side = Math.max(Math.abs(x), Math.abs(y));
    return [origin[0] + (x < 0 ? -side : side), origin[1] + (y < 0 ? -side : side)];
}

function linePoint(pointer: Point, edge: IndexedSegment<SnapLine>): Point {
    const { a, b } = edge.segment;
    return mixPoint(a, b, segmentProjection(...pointer, edge));
}

function addToBucket<T>(buckets: Map<number, T[]>, bin: number, entry: T) {
    const bucket = buckets.get(bin);
    if (bucket) bucket.push(entry);
    else buckets.set(bin, [entry]);
}

export function indexSnapTargets(points: readonly SnapPoint[], lines: readonly SnapLine[], startScale: number) {
    const cellSize = 4 * snapPixels / startScale, bin = (value: number) => Math.floor(value / cellSize);
    const columns = new Map<number, Map<number, SnapPoint[]>>();
    for (const target of points) {
        const i = bin(target.point[0]), j = bin(target.point[1]);
        let column = columns.get(i);
        if (!column) columns.set(i, column = new Map());
        addToBucket(column, j, target);
    }
    const segments = indexSegments(lines, cellSize);
    function* bucketsNear<T>(buckets: Map<number, T>, value: number, gap: number) {
        const first = bin(value - gap), last = bin(value + gap);
        if (last - first + 1 <= buckets.size && Number.isSafeInteger(first) && Number.isSafeInteger(last)) {
            for (let i = first; i <= last; i++) {
                const bucket = buckets.get(i);
                if (bucket) yield bucket;
            }
        }
        else for (const [i, bucket] of buckets) if (i >= first && i <= last) yield bucket;
    }

    return function snap(at: Point, scale: number, { alignmentPoints = [], exclude }: SnapOptions = {}): SnapResult {
        const gap = snapPixels / scale;
        const excluded = (target: SnapPoint) => target.group === exclude?.group && exclude.indices?.includes(target.index);
        const nearby: SnapPoint[] = [];
        for (const column of bucketsNear(columns, at[0], gap))
            for (const bucket of bucketsNear(column, at[1], gap)) for (const target of bucket) nearby.push(target);
        const blocked = nearby.filter(excluded);
        const collapses = (point: Point) => blocked.some(({ point: p }) => p[0] === point[0] && p[1] === point[1]);
        let closestPoint: SnapPoint | undefined, best = gap;
        for (const target of nearby) {
            if (excluded(target)) continue;
            const d = distance(at, target.point);
            if (d > best || d === best && closestPoint || collapses(target.point)) continue;
            closestPoint = target; best = d;
        }
        if (closestPoint) return { point: [...closestPoint.point],
            snapped: true, guides: [{ kind: "point", point: closestPoint.point }] };

        function metric(_x: number, _y: number, edge: IndexedSegment<SnapLine>) {
            if (edge.segment.group === exclude?.group) return Infinity;
            const point = linePoint(at, edge);
            return collapses(point) ? Infinity : distance(point, at) ** 2;
        }
        let edge: IndexedSegment<SnapLine> | undefined;
        if (gap <= cellSize) edge = segments.nearest(...at, gap ** 2, metric);
        else {
            let squared = gap ** 2;
            segments.forRow(at[1], gap, candidate => {
                const d = metric(...at, candidate);
                if (d > squared || d === squared && edge && candidate.order >= edge.order) return;
                edge = candidate; squared = d;
            });
        }
        if (edge) return { point: linePoint(at, edge), snapped: true };

        function alignment(axis: 0 | 1) {
            let best: { from: Point; point: Point; gap: number; distance: number } | undefined;
            for (const from of alignmentPoints) {
                const correction = Math.abs(from[axis] - at[axis]);
                if (correction >= gap) continue;
                const point: Point = [...at];
                point[axis] = from[axis];
                const near = distance(from, point);
                if (collapses(point) || best && (correction > best.gap || correction === best.gap && near >= best.distance)) continue;
                best = { from, point, gap: correction, distance: near };
            }
            return best;
        }

        const [x, y] = axes.map(alignment);
        if (!x && !y) return { point: at };
        const point: Point = [x?.point[0] ?? at[0], y?.point[1] ?? at[1]];
        if (x && y && collapses(point)) {
            const hit = x.gap <= y.gap ? x : y;
            return { point: hit.point, snapped: true, guides: [{ kind: "align", from: hit.from, to: hit.point }] };
        }
        const guides = [x, y].flatMap(hit => hit ? [{ kind: "align" as const, from: hit.from, to: point }] : []);
        return { point, snapped: true, guides };
    };
}