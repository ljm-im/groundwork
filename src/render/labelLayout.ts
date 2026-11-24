import { type Region, type Segment } from "../core/design/regions.ts";
import { distance, mixPoint, projection, type Grid, type Point } from "../core/math/geometry.ts";

function midpoint(segments: Segment[]): Point | undefined {
    const lengths = segments.map(({ a, b }) => distance(a, b));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (const [i, length] of lengths.entries()) {
        if (length > 0 && remaining <= length) return mixPoint(segments[i].a, segments[i].b, remaining / length);
        remaining -= length;
    }
}

function areaCenter(boundary: Segment[]): Point | undefined {
    // Between vertices and crossings the even-odd intervals are bounded by straight edges.
    const edges = boundary.flatMap(({ a, b }) => {
        if (a[1] === b[1]) return [];
        const [low, high] = a[1] < b[1] ? [a, b] : [b, a];
        return [{ low, high, slope: (high[0] - low[0]) / (high[1] - low[1]) }];
    }).sort((a, b) => a.low[1] - b.low[1]);
    const at = (edge: typeof edges[number], y: number) => edge.low[0] + (y - edge.low[1]) * edge.slope;
    const events = new Set(edges.flatMap(e => [e.low[1], e.high[1]]));
    edges.forEach((a, i) => {
        for (let j = i + 1; j < edges.length && edges[j].low[1] < a.high[1]; j++) {
            const b = edges[j], start = b.low[1], delta = a.slope - b.slope;
            if (!delta) continue;
            const y = start + (b.low[0] - at(a, start)) / delta;
            if (y > start && y < Math.min(a.high[1], b.high[1])) events.add(y);
        }
    });
    const levels = [...events].sort((a, b) => a - b);
    let area = 0, mx = 0, my = 0;
    const active = new Set<typeof edges[number]>();
    let next = 0;
    for (let i = 1; i < levels.length; i++) {
        const low = levels[i - 1], high = levels[i], half = (high - low) / 2;
        while (next < edges.length && edges[next].low[1] <= low) active.add(edges[next++]);
        for (const edge of active) if (edge.high[1] <= low) active.delete(edge);
        // Two-point Gauss quadrature integrates the area and both first moments exactly here.
        for (const sample of [-1 / Math.sqrt(3), 1 / Math.sqrt(3)]) {
            const y = low + half * (1 + sample), xs = [...active].map(e => at(e, y)).sort((a, b) => a - b);
            for (let j = 1; j < xs.length; j += 2) {
                const left = xs[j - 1], right = xs[j], weight = (right - left) * half;
                area += weight;
                mx += weight * (left + right) / 2;
                my += weight * y;
            }
        }
    }
    if (area > 0) return [mx / area, my / area];
}

const positions = new WeakMap<Region, Point | undefined>();
export function constrainGeoLabel(region: Region, grid: Grid, target: Point, fallback?: Point) {
    if (region.shape.contains(target)) return target;
    let closest: Point | undefined, gap = Infinity;
    for (const cell of region.cells) {
        const point = grid.point(cell), here = distance(target, point);
        if (!closest || here < gap) {
            closest = point; gap = here;
        }
    }
    return closest ?? fallback;
}

export function geoLabelPoint(region: Region, grid: Grid): Point | undefined {
    if (positions.has(region)) return positions.get(region);
    const { shape } = region;
    const center = shape.spine ? midpoint(shape.spine) : areaCenter(shape.boundary().flat());
    const point = center && !shape.spine ? constrainGeoLabel(region, grid, center) : center;
    positions.set(region, point);
    return point;
}

export function constrainSectionLabel([a, b]: [Point, Point], target: Point) {
    return mixPoint(a, b, projection(...target, a, b));
}