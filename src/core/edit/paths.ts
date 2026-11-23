import { type GeoNode, type Path, type PathNode, type Point } from "../design/v5.ts";
import { advance, bearing, distance, mixPoint, projection } from "../math/geometry.ts";
import { type Segment } from "../design/regions.ts";
import { defaultArcBulge, pathHandle } from "../design/path.ts";

export type ShapeTool = "pen" | "rect" | "circle" | "sector";
export function penNode(id: string, p: Point, drag?: Point): PathNode {
    if (!drag) return { id, p, mode: "auto" };
    const out: Point = [drag[0] - p[0], drag[1] - p[1]];
    return { id, p, mode: "manual", out, in: [-out[0], -out[1]] };
}
export function closedPen(nodes: PathNode[]): Path {
    if (nodes.length < 3) throw Error("闭合路径至少需要三个节点");
    return { closed: true, nodes };
}
export function shapePath(tool: Exclude<ShapeTool, "pen">, a: Point, b: Point, id: () => string, end?: Point): Path {
    const corner = (p: Point): PathNode => ({ id: id(), p, mode: "corner", next: "line" });
    const arc = (p: Point, bulge: number): PathNode => ({ ...corner(p), next: "arc", bulge });
    if (distance(a, b) < 1e-6) throw Error("请拖出形状的大小");
    if (tool === "rect") {
        if (a[0] === b[0] || a[1] === b[1]) throw Error("矩形需要有宽度和高度");
        return { closed: true, nodes: [a, [b[0], a[1]], b, [a[0], b[1]]].map(p => corner(p as Point)) };
    }
    if (tool === "circle") return { closed: true, nodes: [arc(b, 1), arc([2 * a[0] - b[0], 2 * a[1] - b[1]], 1)] };
    const angle = ((bearing(a, end ?? b) - bearing(a, b)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (angle < 1e-6 || Math.PI * 2 - angle < 1e-6) throw Error("请单击不同于起始角的方向");
    return { closed: true, nodes: [corner(a), arc(b, Math.tan(angle / 4)), corner(advance(a, bearing(a, b) + angle, distance(a, b)))] };
}
export function moveHandle(path: Path, i: number, side: "in" | "out", target: Point, independent: boolean) {
    const v = path.nodes[i], other = side === "in" ? "out" : "in";
    const current = pathHandle(path, i, other), length = distance(current, v.p);
    const delta: Point = [target[0] - v.p[0], target[1] - v.p[1]], size = Math.hypot(...delta);
    v[other] = independent ? [current[0] - v.p[0], current[1] - v.p[1]] :
        size ? [-delta[0] * length / size, -delta[1] * length / size] : [0, 0];
    v.mode = independent ? "corner" : "manual";
    v[side] = delta;
}
export function arcHandle(a: Point, b: Point, bulge: number): Point {
    return [(a[0] + b[0] + (b[1] - a[1]) * bulge) / 2, (a[1] + b[1] - (b[0] - a[0]) * bulge) / 2];
}
export function setSegment(path: Path, i: number, type: "line" | "curve" | "arc" | "tangent") {
    const nodes = path.nodes, node = nodes[i], next = nodes[(i + 1) % nodes.length], prev = nodes[(i + nodes.length - 1) % nodes.length];
    if (type === "tangent") {
        let tangent = bearing(prev.p, node.p);
        if (prev.next === "arc") tangent += 2 * Math.atan(prev.bulge ?? defaultArcBulge);
        else if (prev.next !== "line") {
            const handle = pathHandle(path, i, "in");
            const start = pathHandle(path, (i + nodes.length - 1) % nodes.length, "out");
            if (distance(handle, node.p) > 1e-8) tangent = bearing(handle, node.p);
            else if (distance(start, node.p) > 1e-8) tangent = bearing(start, node.p);
        }
        const delta = bearing(node.p, next.p) - tangent;
        const bulge = Math.tan(Math.atan2(Math.sin(delta), Math.cos(delta)) / 2);
        if (Math.abs(bulge) > 1e5) throw Error("此方向无法形成有限的相切圆弧");
        if (Math.abs(bulge) < 1e-8) type = "line";
        else node.bulge = bulge;
    }
    node.next = type === "tangent" ? "arc" : type;
    if (node.next === "arc") node.bulge ??= defaultArcBulge;
    else delete node.bulge;
}
export function setBulge(a: PathNode, b: Point, at: Point) {
    const dx = b[0] - a.p[0], dy = b[1] - a.p[1];
    const value = 2 * ((at[0] - a.p[0]) * dy - (at[1] - a.p[1]) * dx) / (dx * dx + dy * dy);
    if (Number.isFinite(value) && Math.abs(value) > .0001) a.bulge = value;
}
export function nearestSegment(edges: Segment[], at: Point) {
    let best: { edge: Segment; point: Point; distance: number } | undefined;
    for (const edge of edges) {
        const point = mixPoint(edge.a, edge.b, projection(...at, edge.a, edge.b)), gap = distance(at, point);
        if (!best || gap < best.distance) best = { edge, point, distance: gap };
    }
    return best;
}
export function translateGeo(n: GeoNode, delta: Point) {
    const move = (p: Point) => {
        p[0] += delta[0]; p[1] += delta[1];
    };
    if (n.construction.type === "free") for (const path of n.construction.paths) for (const v of path.nodes) move(v.p);
    const f = n.function;
    if (f.type === "coast") {
        for (const v of f.shore.nodes) move(v.p);
        if (f.harbor) move(f.harbor.center);
    }
    if (f.type === "mountain") {
        for (const ridge of f.ridges) for (const v of ridge.line.points) move(v.p);
        for (const peak of f.peaks) move(peak.at.p);
    }
    if (f.type === "slope") {
        if (f.kind === "radial") move(f.center);
        else for (const v of f.line.points) move(v.p);
    }
}