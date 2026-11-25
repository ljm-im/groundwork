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
    type Anchor = typeof anchors[number];
    const first = anchors[0], last = anchors.at(-1)!;
    const wraps = line.closed && anchors.length > 1;
    const before = wraps ? { ...last, s: last.s - total } : first;
    const after = wraps ? { ...first, s: first.s + total } : last;
    function interpolate<T>(s: number, ease: boolean, read: (a: Anchor, b: Anchor, t: number) => T) {
        if (!anchors.length) return;
        let end = 0;
        while (end < anchors.length && !(anchors[end].s >= s)) end++;
        const b = end < anchors.length ? anchors[end] : after;
        const a = end > 0 ? anchors[end - 1] : before;
        const t = a === b ? 0 : (s - a.s) / (b.s - a.s || 1);
        return read(a, b, ease ? smooth(t) : t);
    }
    const spanValue = (a: Anchor, b: Anchor, t: number) => ({ a, b, t });
    const span = (s: number, ease = false) => interpolate(s, ease, spanValue);
    return { points, station, span, nodeStation, interpolate };
}

export function numericProfile(line: Curve<number>, tolerance: number) {
    const { interpolate, ...profile } = lineProfile(line, tolerance);
    const height = (a: { h: number }, b: { h: number }, t: number) => a.h + (b.h - a.h) * t;
    return { ...profile, value: (s: number, ease = false) => interpolate(s, ease, height) ?? 0 };
}