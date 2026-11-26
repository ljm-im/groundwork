import { type Curve, type CurveNode, type CurveRef, type NodeQuantity } from "./v5.ts";
import { nearest, smooth, stations, type Point } from "../math/geometry.ts";
import { flattenPath } from "./path.ts";

export function needsNodeValue(curve: Curve, index: number) {
    return index === 0 || !curve.closed && index === curve.nodes.length - 1;
}

export function interpolates(node: CurveNode, quantity: NodeQuantity) {
    return node[quantity] === undefined || !!node.interpolate?.includes(quantity);
}

export function setNodeInterpolation(node: CurveNode, quantity: NodeQuantity, enabled: boolean) {
    const quantities = (node.interpolate ?? []).filter(key => key !== quantity);
    if (enabled) quantities.push(quantity);
    if (quantities.length) node.interpolate = quantities;
    else delete node.interpolate;
}

export function writeCurveProfile(ref: CurveRef, curve: Curve, quantities: readonly NodeQuantity[]) {
    for (const q of quantities) ref[q] = Object.fromEntries(curve.nodes.flatMap(n => n[q] === undefined ? [] : [[n.id, n[q]]]));
    const flags = curve.nodes.flatMap(n => n.interpolate?.length ? [[n.id, n.interpolate] as const] : []);
    if (flags.length) ref.interpolate = Object.fromEntries(flags);
    else delete ref.interpolate;
}

export const profileMix = (a: number, b: number, t: number) => a + (b - a) * t;

export function lineProfile<N extends number | string>(line: Curve<N>, tolerance: number, quantity: NodeQuantity = "h") {
    // Keep at least eight samples per curved segment for stable terrain evaluation.
    const segments = flattenPath(line, tolerance, 3);
    const points = segments.length ? [segments[0].a, ...segments.map(e => e.b)] : line.nodes.map(v => v.p);
    const lengths = stations(points), total = lengths.at(-1) ?? 0;
    const starts = new Map<string | undefined, number>();
    for (const [i, edge] of segments.entries()) if (!starts.has(edge.from)) starts.set(edge.from, i);
    const nodeStation = (i: number) => lengths[starts.get(line.nodes[i].id)!] ?? total;
    const anchors = line.nodes.flatMap((v, index) => interpolates(v, quantity) ? [] : [{ index, s: nodeStation(index), value: v[quantity]! }]);
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
    function stationOnSegment(index: number, point: Point) {
        const a = starts.get(line.nodes[index].id)!, b = starts.get(line.nodes[index + 1]?.id) ?? segments.length;
        const hit = nearest(...point, points.slice(a, b + 1));
        return station(a + hit.segment, hit.t);
    }
    return { points, station, span, nodeStation, stationOnSegment, interpolate };
}

export function numericProfile(line: Curve<number>, tolerance: number, quantity: NodeQuantity = "h") {
    const { interpolate, ...profile } = lineProfile(line, tolerance, quantity);
    const value = (s: number, ease = false) => interpolate(s, ease, (a, b, t) => a === b ? a.value : profileMix(a.value, b.value, t)) ?? 0;
    const nodeValue = (index: number, ease: boolean) => interpolates(line.nodes[index], quantity)
        ? value(profile.nodeStation(index), ease) : line.nodes[index][quantity]!;
    return { ...profile, value, nodeValue };
}