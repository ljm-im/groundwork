import { isCurveRef } from "../design/curveReferences.ts";
import { type ClosedCurve, type Curve, type CurveValue, type Expression, type CurveNode, type GeoNode, type Point } from "../design/v5.ts";
import { advance, bearing, distance, mixPoint, projection } from "../math/geometry.ts";
import { arcGeometry, autoHandle, defaultArcBulge, flattenBezier, flattenSegment, handleOffset, hasHandleSide, neighbor, pathBezier,
    pathHandle, segmentType, splitBezier, type Bezier, type Segment, type SegmentType } from "../design/path.ts";

export type ShapeTool = "pen" | "rect" | "circle" | "sector";
type Side = "in" | "out";
const offset = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const scale = (v: Point, factor: number): Point => [v[0] * factor, v[1] * factor];

export function penNode(id: string, p: Point, drag?: Point): CurveNode<never> {
    if (!drag) return { id, p, mode: "corner" };
    const out = offset(drag, p);
    return { id, p, mode: "manual", out, in: scale(out, -1) };
}
export function closedPen(nodes: CurveNode<never>[]): ClosedCurve {
    if (nodes.length < 3) throw Error("闭合曲线至少需要三个节点");
    return { closed: true, nodes };
}
export function penPath<N extends Expression>(nodes: CurveNode<N>[], closed: boolean): Curve<N> {
    const path = { closed, nodes: closed ? nodes : nodes.map(node => ({ ...node })) };
    if (!closed) cleanHandles(path);
    return path;
}
export const isEndpoint = (curve: Curve, index: number) =>
    !curve.closed && (index === 0 || index === curve.nodes.length - 1);

export function extendCurve(curve: Curve, nodes: CurveNode<never>[], start: number, closed: boolean) {
    const additions = start === 0 ? nodes.toReversed().map(({ in: incoming, out: outgoing, ...node }) => ({
        ...node, ...(outgoing && { in: outgoing }), ...(incoming && { out: incoming })
    })) : nodes;
    const original = curve.nodes.map(n => ({ ...n }));
    return penPath(start === 0 ? [...additions, ...original] : [...original, ...additions], closed);
}

export function shapePath(tool: Exclude<ShapeTool, "pen">, a: Point, b: Point, id: () => string, end?: Point): ClosedCurve {
    const corner = (p: Point): CurveNode<never> => ({ id: id(), p, mode: "corner" });
    const arc = (p: Point, bulge: number): CurveNode<never> => ({ ...corner(p), bulge });
    if (distance(a, b) < 1e-6) throw Error("请选取不同的起点和终点");
    if (tool === "rect") {
        if (a[0] === b[0] || a[1] === b[1]) throw Error("矩形需要有宽度和高度");
        return { closed: true, nodes: [a, [b[0], a[1]], b, [a[0], b[1]]].map(p => corner(p as Point)) };
    }
    if (tool === "circle") {
        const opposite: Point = [2 * a[0] - b[0], 2 * a[1] - b[1]], quarter = Math.tan(Math.PI / 8);
        return { closed: true, nodes: [b, arcHandle(b, opposite, 1), opposite, arcHandle(opposite, b, 1)].map(p => arc(p, quarter)) };
    }
    const angle = ((bearing(a, end ?? b) - bearing(a, b)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (angle < 1e-6 || Math.PI * 2 - angle < 1e-6) throw Error("请单击不同于起始角的方向");
    return { closed: true, nodes: [corner(a), arc(b, Math.tan(angle / 4)), corner(advance(a, bearing(a, b) + angle, distance(a, b)))] };
}

export const canSetManual = (path: Curve, i: number) => hasHandleSide(path, i, "in") && hasHandleSide(path, i, "out");
export const canRemoveNode = (path: Curve) => path.nodes.length > (path.closed ? 3 : 2);

export function cleanHandles(path: Curve) {
    for (const [i, node] of path.nodes.entries()) {
        if (neighbor(path, i, 1) === undefined) delete node.bulge;
        if (!hasHandleSide(path, i, "in")) delete node.in;
        if (!hasHandleSide(path, i, "out")) delete node.out;
        if (node.mode === "manual" && (!node.in || !node.out)) node.mode = "corner";
    }
}

export function setNodeMode(path: Curve, i: number, mode: CurveNode["mode"]) {
    const node = path.nodes[i];
    if (node.mode === mode || mode === "manual" && !canSetManual(path, i)) return;
    const incoming = handleOffset(path, i, "in"), outgoing = handleOffset(path, i, "out");
    node.mode = mode;
    delete node.in;
    delete node.out;
    if (mode === "corner") {
        if (incoming) node.in = incoming;
        if (outgoing) node.out = outgoing;
    }
    if (mode === "manual") {
        const a = incoming ?? autoHandle(path, i, "in"), b = outgoing ?? autoHandle(path, i, "out");
        const lengthIn = Math.hypot(...a), lengthOut = Math.hypot(...b);
        const average = offset(scale(b, 1 / (lengthOut || 1)), scale(a, 1 / (lengthIn || 1)));
        const direction = average.some(Boolean) ? average : b;
        const length = Math.hypot(...direction) || 1;
        node.in = scale(direction, -lengthIn / length);
        node.out = scale(direction, lengthOut / length);
    }
}

export function editWholeCurve(path: Curve, action: "auto" | "line") {
    let changed = false;
    for (const [index, node] of path.nodes.entries()) {
        if (action === "auto") {
            if (node.mode === "auto") continue;
            setNodeMode(path, index, "auto");
        }
        else {
            if (node.mode === "corner" && node.in === undefined && node.out === undefined && node.bulge === undefined) continue;
            node.mode = "corner";
            delete node.in;
            delete node.out;
            delete node.bulge;
        }
        changed = true;
    }
    return changed;
}

export function moveHandle(path: Curve, i: number, side: Side, target: Point, independent: boolean) {
    if (!hasHandleSide(path, i, side)) return;
    const v = path.nodes[i], other = side === "in" ? "out" : "in";
    if (v.mode === "auto") setNodeMode(path, i, canSetManual(path, i) ? "manual" : "corner");
    const delta = offset(target, v.p), size = Math.hypot(...delta);
    if (v.mode === "manual") {
        if (independent) v.mode = "corner";
        else if (size) v[other] = scale(delta, -Math.hypot(...v[other]!) / size);
    }
    v[side] = delta;
}

export function retractHandle(path: Curve, i: number, side: Side) {
    if (handleOffset(path, i, side) === undefined) return;
    setNodeMode(path, i, "corner");
    delete path.nodes[i][side];
}

export function arcHandle(a: Point, b: Point, bulge: number): Point {
    return [(a[0] + b[0] + (b[1] - a[1]) * bulge) / 2, (a[1] + b[1] - (b[0] - a[0]) * bulge) / 2];
}
export function setSegment(path: Curve, i: number, type: SegmentType | "tangent") {
    const j = neighbor(path, i, 1);
    if (j === undefined) return;
    const node = path.nodes[i], next = path.nodes[j];
    let arc = node.bulge ?? defaultArcBulge;
    if (type === "tangent") {
        const k = neighbor(path, i, -1);
        if (k === undefined) return;
        const prev = path.nodes[k];
        let tangent = bearing(prev.p, node.p);
        if (prev.bulge !== undefined) tangent += 2 * Math.atan(prev.bulge);
        else {
            const end = pathHandle(path, i, "in"), start = pathHandle(path, k, "out");
            if (distance(end, node.p) > 1e-8) tangent = bearing(end, node.p);
            else if (distance(start, node.p) > 1e-8) tangent = bearing(start, node.p);
        }
        const delta = bearing(node.p, next.p) - tangent;
        arc = Math.tan(Math.atan2(Math.sin(delta), Math.cos(delta)) / 2);
        if (Math.abs(arc) > 1e5) throw Error("此方向无法形成有限的相切圆弧");
        type = Math.abs(arc) < 1e-8 ? "line" : "arc";
    }
    if (type === "curve") {
        delete node.bulge;
        if (node.mode === "corner" && !node.out?.some(Boolean)) node.out = autoHandle(path, i, "out");
        if (next.mode === "corner" && !next.in?.some(Boolean)) next.in = autoHandle(path, j, "in");
        return;
    }
    if (type === "line" || node.mode === "manual") setNodeMode(path, i, "corner");
    if (type === "line" || next.mode === "manual") setNodeMode(path, j, "corner");
    delete node.out;
    delete next.in;
    if (type === "arc") node.bulge = arc;
    else delete node.bulge;
}
export function setBulge(a: CurveNode, b: Point, at: Point) {
    const dx = b[0] - a.p[0], dy = b[1] - a.p[1];
    const value = 2 * ((at[0] - a.p[0]) * dy - (at[1] - a.p[1]) * dx) / (dx * dx + dy * dy);
    if (Number.isFinite(value) && Math.abs(value) > .0001) a.bulge = value;
}

function nearestBezierParameter(curve: Bezier, at: Point) {
    const [a, b, c, d] = curve;
    const tolerance = Math.max(distance(a, d), distance(a, b), distance(c, d)) / 256 || 1;
    let previous = a, start = 0, gap = Infinity, low = 0, high = 1;
    flattenBezier(curve, tolerance, (point, t) => {
        const hit = mixPoint(previous, point, projection(...at, previous, point)), delta = distance(hit, at);
        if (delta < gap) {
            gap = delta;
            low = start;
            high = t;
        }
        previous = point;
        start = t;
    });
    const error = (t: number) => distance(splitBezier(curve, t)[0][3], at);
    for (let i = 0; i < 48; i++) {
        const left = (2 * low + high) / 3, right = (low + 2 * high) / 3;
        if (error(left) < error(right)) high = right;
        else low = left;
    }
    return (low + high) / 2;
}

function newNodeMode(a: CurveNode, b: CurveNode) {
    return a.mode === b.mode ? a.mode : "auto";
}

export function insertPathNode(path: Curve, i: number, at: Point, id: string, beforeInsert?: () => void) {
    const j = neighbor(path, i, 1);
    if (j === undefined) return;
    const a = path.nodes[i], b = path.nodes[j], type = segmentType(path, i);
    const v: CurveNode = { id, p: at, mode: newNodeMode(a, b) };
    let change: () => void = () => {};
    if (type === "arc") {
        const { cx, cy, radius, start, angle } = arcGeometry(a.p, b.p, a.bulge!);
        const delta = (Math.atan2(at[1] - cy, at[0] - cx) - start) * Math.sign(angle);
        const first = Math.sign(angle) * ((delta + 2 * Math.PI) % (2 * Math.PI));
        if (Math.abs(first) < 1e-5 || Math.abs(first) >= Math.abs(angle) - 1e-5) return;
        v.p = [cx + radius * Math.cos(start + first), cy + radius * Math.sin(start + first)];
        v.bulge = Math.tan((angle - first) / 4);
        change = () => a.bulge = Math.tan(first / 4);
    }
    else if (type === "line") {
        const t = projection(...at, a.p, b.p);
        if (t <= 1e-8 || t >= 1 - 1e-8) return;
        v.p = mixPoint(a.p, b.p, t);
        if (v.mode === "manual") {
            v.in = [0, 0];
            v.out = [0, 0];
        }
    }
    else {
        const curve = pathBezier(path, i), t = nearestBezierParameter(curve, at);
        if (t <= 1e-8 || t >= 1 - 1e-8) return;
        const [[, out, incoming, mid], [, outgoing, into]] = splitBezier(curve, t);
        v.p = mid;
        if (v.mode !== "auto") {
            v.in = offset(incoming, mid);
            v.out = offset(outgoing, mid);
        }
        change = () => {
            if (a.mode !== "auto") a.out = offset(out, a.p);
            if (b.mode !== "auto") b.in = offset(into, b.p);
        };
    }
    beforeInsert?.();
    change();
    path.nodes.splice(i + 1, 0, v);
    if (v.mode === "manual" && !canSetManual(path, i + 1)) v.mode = "corner";
    return v;
}

export function removePathNode(path: Curve, index: number) {
    path.nodes.splice(index, 1);
    cleanHandles(path);
}

export function segmentRemovalIndex(path: Curve, index: number) {
    if (!canRemoveNode(path) || !path.nodes[index]) return;
    const next = neighbor(path, index, 1);
    if (path.closed || next === path.nodes.length - 1) return next;
    if (index === 0) return 0;
}

function segmentMidpoint(path: Curve, index: number, next: number): Point {
    const a = path.nodes[index], b = path.nodes[next];
    if (a.bulge !== undefined) return arcHandle(a.p, b.p, a.bulge);
    if (segmentType(path, index) === "line") return mixPoint(a.p, b.p, .5);
    const [start, out, incoming, end] = pathBezier(path, index);
    const tolerance = Math.max(distance(start, out), distance(out, incoming), distance(incoming, end)) / 65536;
    const edges = flattenSegment(path, index, tolerance);
    const lengths = edges.map(({ a, b }) => distance(a, b));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (const [i, length] of lengths.entries()) {
        if (length && remaining <= length) return mixPoint(edges[i].a, edges[i].b, remaining / length);
        remaining -= length;
    }
    return b.p;
}

export function removePathSegment(path: Curve, index: number) {
    const removed = segmentRemovalIndex(path, index);
    if (removed === undefined) return;
    if (!path.closed) {
        removePathNode(path, removed);
        return removed === 0 ? path.nodes[0] : path.nodes.at(-1);
    }

    const a = path.nodes[index], b = path.nodes[removed], mode = newNodeMode(a, b);
    a.p = segmentMidpoint(path, index, removed);
    a.mode = "corner";
    if (b.out === undefined) delete a.out;
    else a.out = b.out;
    if (b.bulge === undefined) delete a.bulge;
    else a.bulge = b.bulge;
    removePathNode(path, removed);
    setNodeMode(path, path.nodes.indexOf(a), mode);
    return a;
}

export function nearestSegment(edges: Segment[], at: Point) {
    let best: { edge: Segment; point: Point; distance: number } | undefined;
    for (const edge of edges) {
        const point = mixPoint(edge.a, edge.b, projection(...at, edge.a, edge.b)), gap = distance(at, point);
        if (!best || gap < best.distance) best = { edge, point, distance: gap };
    }
    return best;
}
export function translateCurve(path: CurveValue, delta: Point) {
    if (isCurveRef(path)) {
        const [x = 0, y = 0] = path.offset ?? [];
        const moved: Point = [x + delta[0], y + delta[1]];
        if (moved.some(Boolean)) path.offset = moved;
        else delete path.offset;
        return;
    }
    for (const v of path.nodes) {
        v.p[0] += delta[0];
        v.p[1] += delta[1];
    }
}
export function translateGeo(n: GeoNode, delta: Point, inherited?: ReadonlySet<CurveValue>) {
    const move = (p: Point) => {
        p[0] += delta[0]; p[1] += delta[1];
    };
    const moveCurve = (curve: CurveValue) => {
        if (!inherited?.has(curve)) translateCurve(curve, delta);
    };
    if (n.construction.type === "outline") for (const outline of n.construction.outlines) moveCurve(outline);
    const f = n.function;
    if (f.type === "coast") {
        moveCurve(f.shore);
        move(f.harbor.center);
    }
    if (f.type === "mountain") {
        for (const ridge of f.ridges) moveCurve(ridge.line);
        for (const peak of f.peaks) move(peak.at.p);
    }
    if (f.type === "slope") {
        if (f.kind === "radial") move(f.center);
        else moveCurve(f.line);
    }
}