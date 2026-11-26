import { mixPoint } from "../math/geometry.ts";
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

export function functionGeometry(c: Construction<number, "resolved">, shape: RegionShape, step: number, nextId: () => string) {
    const outline = shape.boundary();
    const rings = c.type === "outline" ? outline.map(path => path.map(e => e.a)) : closedContours(outline.flat(), step * 1e-6);
    const largest = rings.flatMap((ring, i) => ring.length < 3 ? [] : [{ ring, i, ...measure(ring) }]).sort((a, b) => b.area - a.area)[0];
    if (!largest?.area) throw Error("地件的区域没有面积");
    const { center } = largest;
    return { center,
        shore(): ClosedCurve {
            if (c.type === "outline") return { closed: true, nodes: c.outlines[largest.i].nodes.map(n => ({ ...n, id: nextId(),
                p: mixPoint(center, n.p, .9),
                ...(n.in && { in: [n.in[0] * .9, n.in[1] * .9] }),
                ...(n.out && { out: [n.out[0] * .9, n.out[1] * .9] }) })) };
            return { closed: true, nodes: largest.ring.map(p => ({ id: nextId(), p: mixPoint(center, p, .9), mode: "corner" })) };
        }
    };
}