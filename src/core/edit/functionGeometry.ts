import { bounds, mixPoint } from "../math/geometry.ts";
import { slopeEndpointValues } from "../design/functionTable.ts";
import { type RegionShape, type Segment } from "../design/regions.ts";
import { type Construction, type ClosedCurve, type Point } from "../design/v5.ts";

function closedContours(edges: Segment[], tolerance: number) {
    const key = ([x, y]: Point) => Math.round(x / tolerance) + "," + Math.round(y / tolerance);
    const ends = new Map<string, number[]>();
    for (const [i, { a, b }] of edges.entries()) for (const p of [a, b]) {
        const id = key(p), at = ends.get(id) ?? [];
        at.push(i); ends.set(id, at);
    }
    const visited = new Set<number>(), rings: Point[][] = [];
    for (const [i, { a, b }] of edges.entries()) {
        if (visited.has(i)) continue;
        visited.add(i);
        const start = key(a), ring = [a];
        let p = b;
        while (key(p) !== start) {
            ring.push(p);
            const next = ends.get(key(p))?.find(j => !visited.has(j));
            if (next === undefined) break;
            visited.add(next);
            const edge = edges[next];
            p = key(edge.a) === key(p) ? edge.b : edge.a;
        }
        if (key(p) === start && ring.length >= 3) rings.push(ring.filter((v, j) => {
            const prev = ring[(j + ring.length - 1) % ring.length], next = ring[(j + 1) % ring.length];
            return Math.abs((v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0])) > tolerance ** 2;
        }));
    }
    return rings;
}

function measure(ring: Point[]) {
    const [ox, oy] = ring[0];
    let area = 0, x = 0, y = 0;
    for (const [i, a] of ring.entries()) {
        const b = ring[(i + 1) % ring.length];
        const cross = (a[0] - ox) * (b[1] - oy) - (a[1] - oy) * (b[0] - ox);
        area += cross; x += (a[0] + b[0] - 2 * ox) * cross; y += (a[1] + b[1] - 2 * oy) * cross;
    }
    return { area: Math.abs(area), center: [ox + x / (3 * area), oy + y / (3 * area)] as Point };
}

export function functionGeometry(c: Construction, shape: RegionShape, step: number, nextId: () => string) {
    const outline = shape.boundary();
    const rings = c.type === "free" ? outline.map(path => path.map(e => e.a)) : closedContours(outline.flat(), step * 1e-6);
    const largest = rings.flatMap((ring, i) => ring.length < 3 ? [] : [{ ring, i, ...measure(ring) }]).sort((a, b) => b.area - a.area)[0];
    if (!largest?.area) throw Error("地件的区域没有面积");
    const { center } = largest;
    return { center,
        shore(): ClosedCurve {
            if (c.type === "free") return { closed: true, nodes: c.paths[largest.i].nodes.map(n => ({ ...n, id: nextId(),
                p: mixPoint(center, n.p, .9),
                ...(n.in && { in: [n.in[0] * .9, n.in[1] * .9] }),
                ...(n.out && { out: [n.out[0] * .9, n.out[1] * .9] }) })) };
            return { closed: true, nodes: largest.ring.map(p => ({ id: nextId(), p: mixPoint(center, p, .9), mode: "corner" })) };
        },
        line() {
            const [x0, y0, x1, y1] = bounds(rings.flat());
            const preferred = x1 - x0 >= y1 - y0 ? 0 : 1;
            const crossLine = (axis: number, transverse: number) => {
                const other = 1 - axis, at = (v: number): Point => axis === 0 ? [v, transverse] : [transverse, v];
                const hits: number[] = [];
                for (const ring of rings) for (const [i, a] of ring.entries()) {
                    const b = ring[(i + 1) % ring.length];
                    if ((a[other] > transverse) !== (b[other] > transverse))
                        hits.push(a[axis] + (transverse - a[other]) / (b[other] - a[other]) * (b[axis] - a[axis]));
                }
                hits.sort((a, b) => a - b);
                const intervals = hits.slice(0, -1).map((low, i) => ({ low, high: hits[i + 1] }))
                    .filter(({ low, high }) => low < high && shape.contains(at((low + high) / 2)));
                const proximity = ({ low, high }: { low: number; high: number }) => Math.max(low - center[axis], center[axis] - high, 0);
                const span = intervals.sort((a, b) => proximity(a) - proximity(b) || (b.high - b.low) - (a.high - a.low))[0];
                if (!span) return;
                return [.1, .9].map(t => at(span.low + t * (span.high - span.low)));
            };
            const other = 1 - preferred;
            let vertices = crossLine(preferred, center[other]) ?? crossLine(other, center[preferred]);
            for (const [i, p] of largest.ring.entries()) {
                if (vertices) break;
                vertices = crossLine(preferred, (p[other] + largest.ring[(i + 1) % largest.ring.length][other]) / 2);
            }
            if (!vertices) throw Error("地件没有足够的空间放置坡线");
            return { closed: false, nodes: vertices.map((p, i) => ({ id: nextId(), p, mode: "corner" as const, h: slopeEndpointValues[i] })) };
        }
    };
}