import { type GeoNode, type Path, type Point } from "../design/v5.ts";
import { arcHandle, moveHandle, nearestSegment, setBulge, translateGeo } from "./paths.ts";
import { flattenPath, pathHandle } from "../design/path.ts";
import { distance, spline } from "../math/geometry.ts";

export interface GeoControl {
    role: "vertex" | "in" | "out" | "arc" | "segment" | "body" | "parameter";
    path: number; index: number; point: Point;
}
export function geometryPath(n: GeoNode, index: number): Path | undefined {
    if (index === -1) return n.function.type === "coast" ? n.function.shore : undefined;
    return n.construction.type === "free" ? n.construction.paths[index] : undefined;
}
export function parameterLines(n: GeoNode) {
    const f = n.function;
    if (f.type === "mountain") return [...f.ridges.map(r => r.line), ...f.peaks.map(p => ({ points: [p.at] }))];
    if (f.type === "slope") return f.kind === "path" ? [f.line] : [{ points: [{ p: f.center }] }];
    return [];
}
export function linePoints(n: GeoNode) {
    return parameterLines(n).map(l => {
        const p = l.points.map(v => v.p);
        return "smooth" in l && l.smooth && p.length > 1 ? spline(p, false, 12) : p;
    });
}
export function pathEntries(n: GeoNode): [number, Path][] {
    const paths: [number, Path][] = n.construction.type === "free" ? n.construction.paths.map((p, i) => [i, p]) : [];
    if (n.function.type === "coast") paths.push([-1, n.function.shore]);
    return paths;
}
export function geoControls(n: GeoNode) {
    const controls: GeoControl[] = [];
    for (const [path, p] of pathEntries(n)) for (const [index, v] of p.nodes.entries()) {
        const next = p.nodes[(index + 1) % p.nodes.length], prev = p.nodes[(index + p.nodes.length - 1) % p.nodes.length];
        controls.push({ role: "vertex", path, index, point: v.p });
        for (const role of ["in", "out"] as const) {
            const segment = role === "in" ? prev : v;
            if ((segment.next ?? "curve") !== "curve") continue;
            const point = pathHandle(p, index, role);
            if (distance(point, v.p) > .0001) controls.push({ role, path, index, point });
        }
        if (v.next === "arc") controls.push({ role: "arc", path, index, point: arcHandle(v.p, next.p, v.bulge!) });
    }
    parameterLines(n).forEach((l, path) => l.points.forEach((v, index) => controls.push({ role: "parameter", path, index, point: v.p })));
    return controls;
}
export function hitControl(n: GeoNode, p: Point, scale: number, tolerance: number): GeoControl | undefined {
    const handle = geoControls(n).reverse().map(c => ({ c, gap: distance(p, c.point) * scale })).filter(v => v.gap <= 7).sort((a, b) => a.gap - b.gap)[0];
    if (handle) return handle.c;
    for (const [index, path] of pathEntries(n).reverse()) {
        const hit = nearestSegment(flattenPath(path, Math.min(tolerance, .5 / scale)), p);
        if (hit && hit.distance * scale <= 5)
            return { role: "segment", path: index, index: path.nodes.findIndex(v => v.id === hit.edge.from), point: hit.point };
    }
}
export function editControl(n: GeoNode, h: GeoControl, at: Point, independent: boolean) {
    if (h.role === "body") return translateGeo(n, [at[0] - h.point[0], at[1] - h.point[1]]);
    if (h.role === "parameter") {
        const p = parameterLines(n)[h.path].points[h.index].p;
        p[0] = at[0]; p[1] = at[1];
        return;
    }
    const path = geometryPath(n, h.path)!, v = path.nodes[h.index];
    if (h.role === "vertex") v.p = at;
    if (h.role === "in" || h.role === "out") moveHandle(path, h.index, h.role, at, independent);
    if (h.role === "arc") setBulge(v, path.nodes[(h.index + 1) % path.nodes.length].p, at);
}
export function removeParameterPoint(n: GeoNode, h: GeoControl) {
    const f = n.function;
    if (f.type === "mountain" && h.path >= f.ridges.length) {
        f.peaks.splice(h.path - f.ridges.length, 1); return;
    }
    if (f.type === "slope" && f.kind === "radial") throw Error("径向坡面需要保留圆心");
    const line = f.type === "mountain" ? f.ridges[h.path]?.line : f.type === "slope" && f.kind === "path" ? f.line : undefined;
    if (!line) return;
    if (line.points.length < 3) throw Error("折线至少需要两个顶点");
    const remaining = line.points.filter((_, i) => i !== h.index);
    if (remaining[0].h === undefined || remaining.at(-1)!.h === undefined) throw Error("请先给新的端点设置高度");
    line.points = remaining;
}

export function insertPathNode(path: Path, index: number, at: Point, id: string) {
    const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length];
    const v = { id, p: at, mode: "auto" as const, next: a.next, bulge: undefined as number | undefined };
    if (a.next === "arc") {
        const angle = 4 * Math.atan(a.bulge!), dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], k = (1 / a.bulge! - a.bulge!) / 4;
        const cx = (a.p[0] + b.p[0]) / 2 - dy * k, cy = (a.p[1] + b.p[1]) / 2 + dx * k;
        const delta = (Math.atan2(at[1] - cy, at[0] - cx) - Math.atan2(a.p[1] - cy, a.p[0] - cx)) * Math.sign(angle);
        const first = Math.sign(angle) * ((delta + 2 * Math.PI) % (2 * Math.PI));
        if (Math.abs(first) < .00001 || Math.abs(angle - first) < .00001) return;
        a.bulge = Math.tan(first / 4); v.bulge = Math.tan((angle - first) / 4);
    }
    path.nodes.splice(index + 1, 0, v);
}