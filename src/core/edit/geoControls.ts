import { parameters, readAt, slotName, writeAt, type Address } from "../design/parameters.ts";
import { type Design, type GeoNode, type Path, type Point } from "../design/v5.ts";
import { arcHandle, moveHandle, nearestSegment, setBulge, translateGeo } from "./paths.ts";
import { defaultArcBulge, flattenPath, pathHandle } from "../design/path.ts";
import { distance, spline } from "../math/geometry.ts";

export interface GeometryTarget { kind: "path" | "parameter"; index: number }
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
    if (f.type === "coast") return [{ points: [{ p: f.harbor.center }] }];
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
export function geoControls(n: GeoNode, target?: GeometryTarget) {
    const controls: GeoControl[] = [];
    for (const [path, p] of editablePaths(n, target)) for (const [index, v] of p.nodes.entries()) {
        const next = p.nodes[(index + 1) % p.nodes.length], prev = p.nodes[(index + p.nodes.length - 1) % p.nodes.length];
        controls.push({ role: "vertex", path, index, point: v.p });
        for (const role of ["in", "out"] as const) {
            const segment = role === "in" ? prev : v;
            if ((segment.next ?? "curve") !== "curve") continue;
            const point = pathHandle(p, index, role);
            if (distance(point, v.p) > .0001) controls.push({ role, path, index, point });
        }
        if (v.next === "arc") controls.push({ role: "arc", path, index, point: arcHandle(v.p, next.p, v.bulge ?? defaultArcBulge) });
    }
    if (target?.kind === "parameter") parameterLines(n)[target.index]?.points.forEach((v, index) =>
        controls.push({ role: "parameter", path: target.index, index, point: v.p }));
    return controls;
}
function editablePaths(n: GeoNode, target?: GeometryTarget) {
    return pathEntries(n).filter(([i]) => target ? target.kind === "path" && i === target.index : i >= 0);
}
export function hitControl(n: GeoNode, p: Point, scale: number, tolerance: number, target?: GeometryTarget): GeoControl | undefined {
    const handle = geoControls(n, target).reverse().map(c => ({ c, gap: distance(p, c.point) * scale })).filter(v => v.gap <= 7).sort((a, b) => a.gap - b.gap)[0];
    if (handle) return handle.c;
    for (const [index, path] of editablePaths(n, target).reverse()) {
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
export function removeGeometryItem(d: Design, n: GeoNode, path: Address, index: number) {
    const items = readAt(n.function, path);
    if (!Array.isArray(items) || !items[index]) return;
    const slots = parameters(d), prefix = "geo:" + n.id + "." + path.join(".") + ".";
    const uses: string[] = [], edits: [Address, string][] = [];
    for (const s of slots.values()) {
        const formula = readAt(d, s.path);
        if (typeof formula !== "string" || s.owner === "geo" && s.id === n.id && s.key.startsWith(prefix + index + ".")) continue;
        const next = formula.replace(/\{([^{}]+)\}/g, (text, ref: string) => {
            const target = slots.get(ref);
            if (!ref.startsWith(prefix) || target?.id !== n.id || target.owner !== "geo") return text;
            const [at, ...rest] = ref.slice(prefix.length).split(".");
            if (Number(at) === index) uses.push(slotName(s));
            return Number(at) > index ? "{" + prefix + (Number(at) - 1) + "." + rest.join(".") + "}" : text;
        });
        if (next !== formula) edits.push([s.path, next]);
    }
    if (uses.length) throw Error("仍被引用：\n" + [...new Set(uses)].join("\n"));
    for (const [address, formula] of edits) writeAt(d, address, formula);
    items.splice(index, 1);
}
export function removeParameterPoint(d: Design, n: GeoNode, h: GeoControl) {
    const f = n.function;
    if (f.type === "mountain" && h.path >= f.ridges.length) {
        removeGeometryItem(d, n, ["peaks"], h.path - f.ridges.length); return;
    }
    if (f.type === "coast") throw Error("港湾需要保留圆心");
    if (f.type === "slope" && f.kind === "radial") throw Error("径向坡面需要保留圆心");
    const line = f.type === "mountain" ? f.ridges[h.path]?.line : f.type === "slope" && f.kind === "path" ? f.line : undefined;
    if (!line) return;
    if (line.points.length < 3) throw Error("折线至少需要两个顶点");
    removeGeometryItem(d, n, f.type === "mountain" ? ["ridges", h.path, "line", "points"] : ["line", "points"], h.index);
}

export function insertPathNode(path: Path, index: number, at: Point, id: string) {
    const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length];
    const v = { id, p: at, mode: "auto" as const, next: a.next, bulge: undefined as number | undefined };
    if (a.next === "arc") {
        const bulge = a.bulge ?? defaultArcBulge, angle = 4 * Math.atan(bulge), dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], k = (1 / bulge - bulge) / 4;
        const cx = (a.p[0] + b.p[0]) / 2 - dy * k, cy = (a.p[1] + b.p[1]) / 2 + dx * k;
        const delta = (Math.atan2(at[1] - cy, at[0] - cx) - Math.atan2(a.p[1] - cy, a.p[0] - cx)) * Math.sign(angle);
        const first = Math.sign(angle) * ((delta + 2 * Math.PI) % (2 * Math.PI));
        if (Math.abs(first) < .00001 || Math.abs(angle - first) < .00001) return;
        a.bulge = Math.tan(first / 4); v.bulge = Math.tan((angle - first) / 4);
    }
    path.nodes.splice(index + 1, 0, v);
}