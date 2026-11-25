import { type Curve } from "./v5.ts";
import { smooth, stations } from "../math/geometry.ts";
import { flattenPath } from "./path.ts";

export function lineProfile<N>(line: Curve<N>, tolerance: number) {
    // Keep at least eight samples per curved segment for stable terrain evaluation.
    const segments = flattenPath(line, tolerance, 3);
    const points = segments.length ? [segments[0].a, ...segments.map(e => e.b)] : line.nodes.map(v => v.p);
    const lengths = stations(points), total = lengths.at(-1) ?? 0;
    const starts = new Map<string | undefined, number>();
    for (const [i, edge] of segments.entries()) if (!starts.has(edge.from)) starts.set(edge.from, lengths[i]);
    const nodeStation = (i: number) => starts.get(line.nodes[i].id) ?? total;
    const anchors = line.nodes.flatMap((v, index) => v.h === undefined ? [] : [{ index, s: nodeStation(index), h: v.h }]);
    const station = (segment: number, t: number) => lengths[segment] + t * (lengths[segment + 1] - lengths[segment]);
    function span(s: number, ease = false) {
        if (!anchors.length) return;
        const end = anchors.findIndex(a => a.s >= s);
        const first = anchors[0], last = anchors.at(-1)!;
        const wraps = line.closed && anchors.length > 1;
        const b = end >= 0 ? anchors[end] : wraps ? { ...first, s: first.s + total } : last;
        const a = end > 0 ? anchors[end - 1] : end < 0 ? last : wraps ? { ...last, s: last.s - total } : b;
        const t = a === b ? 0 : (s - a.s) / (b.s - a.s || 1);
        return { a, b, t: ease ? smooth(t) : t };
    }
    return { points, station, span, nodeStation };
}

export function numericProfile(line: Curve<number>, tolerance: number) {
    const profile = lineProfile(line, tolerance);
    return { ...profile, value(s: number, ease = false) {
        const span = profile.span(s, ease);
        return span ? span.a.h + (span.b.h - span.a.h) * span.t : 0;
    } };
}