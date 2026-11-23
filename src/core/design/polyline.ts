import { type Polyline } from "./v5.ts";
import { smooth, spline, stations } from "../math/geometry.ts";

// Resolved slopes keep their authored stops so smoothstep spans survive filling vertex heights.
export function lineProfile<N>(line: Polyline<N> & { heightStops?: number[] }) {
    const divisions = line.smooth ? 8 : 1, vertices = line.points.map(v => v.p);
    const points = line.smooth ? spline(vertices, false, divisions) : vertices, lengths = stations(points);
    const stops = line.heightStops ?? line.points.flatMap((v, i) => v.h === undefined ? [] : [i]);
    const anchors = stops.map(i => ({ index: i, s: lengths[i * divisions], h: line.points[i].h! }));
    const station = (segment: number, t: number) => lengths[segment] + t * (lengths[segment + 1] - lengths[segment]);
    function span(s: number, ease = false) {
        if (!anchors.length) return;
        const end = anchors.findIndex(a => a.s >= s);
        const b = anchors[end < 0 ? anchors.length - 1 : end], a = end > 0 ? anchors[end - 1] : b;
        const t = a === b ? 0 : (s - a.s) / (b.s - a.s || 1);
        return { a, b, t: ease ? smooth(t) : t };
    }
    return { points, station, span, vertexStation: (i: number) => lengths[i * divisions] };
}

export function numericProfile(line: Polyline<number>) {
    const profile = lineProfile(line);
    return { ...profile, value(s: number, ease = false) {
        const span = profile.span(s, ease);
        return span ? span.a.h + (span.b.h - span.a.h) * span.t : 0;
    } };
}