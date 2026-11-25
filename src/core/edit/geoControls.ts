import { parameters, readAt, slotName, writeAt, type Address } from "../design/parameters.ts";
import { type Curve, type Design, type GeoNode, type Point } from "../design/v5.ts";
import { arcHandle, canRemoveNode, cleanHandles, insertPathNode, moveHandle, nearestSegment, setBulge, translateGeo } from "./paths.ts";
import { flattenPath, neighbor, pathHandle } from "../design/path.ts";
import { distance } from "../math/geometry.ts";
import { nodeIds } from "./geoNodes.ts";

export interface GeometryTarget { kind: "path" | "parameter"; index: number }
export interface GeoControl {
    role: "vertex" | "in" | "out" | "arc" | "segment" | "body" | "parameter";
    path: number; index: number; point: Point;
}

export function geometryPath(n: GeoNode, index: number): Curve | undefined {
    if (index >= 0) return n.construction.type === "free" ? n.construction.paths[index] : undefined;
    const f = n.function;
    if (f.type === "mountain") return f.ridges[-1 - index]?.line;
    if (index === -1) {
        if (f.type === "coast") return f.shore;
        if (f.type === "slope" && f.kind === "path") return f.line;
    }
}

export function parameterPoints(n: GeoNode): [number, Point][] {
    const f = n.function;
    if (f.type === "mountain") return f.peaks.map(({ at }, i) => [f.ridges.length + i, at.p]);
    if (f.type === "coast") return [[0, f.harbor.center]];
    if (f.type === "slope" && f.kind === "radial") return [[0, f.center]];
    return [];
}

export function pathEntries(n: GeoNode): [number, Curve][] {
    const paths: [number, Curve][] = n.construction.type === "free" ? n.construction.paths.map((p, i) => [i, p]) : [];
    const count = n.function.type === "mountain" ? n.function.ridges.length : 1;
    for (let i = -1; i >= -count; i--) {
        const curve = geometryPath(n, i);
        if (curve) paths.push([i, curve]);
    }
    return paths;
}

const vertexControl = (path: number, index: number, point: Point): GeoControl => ({ role: "vertex", path, index, point });
const pointControl = (path: number, point: Point): GeoControl => ({ role: "parameter", path, index: 0, point });

export function geoControls(n: GeoNode, target?: GeometryTarget) {
    const controls: GeoControl[] = [];
    for (const [path, p] of editablePaths(n, target)) for (const [index, v] of p.nodes.entries()) {
        controls.push(vertexControl(path, index, v.p));
        for (const role of ["in", "out"] as const) {
            const point = pathHandle(p, index, role);
            if (distance(point, v.p) > .0001) controls.push({ role, path, index, point });
        }
        const j = neighbor(p, index, 1);
        if (j !== undefined && v.bulge !== undefined) controls.push({ role: "arc", path, index, point: arcHandle(v.p, p.nodes[j].p, v.bulge) });
    }
    if (target?.kind === "parameter") {
        const entry = parameterPoints(n).find(([i]) => i === target.index);
        if (entry) controls.push(pointControl(...entry));
    }
    return controls;
}

function editablePaths(n: GeoNode, target?: GeometryTarget) {
    return pathEntries(n).filter(([i]) => target ? target.kind === "path" && i === target.index : i >= 0);
}
const handleRadius = 7, segmentRadius = 5;
function hitGeoHandle(controls: GeoControl[], p: Point, scale: number) {
    let best: GeoControl | undefined, gap = handleRadius;
    for (const control of controls) {
        const distancePx = distance(p, control.point) * scale;
        if (distancePx > gap) continue;
        best = control; gap = distancePx;
    }
    return best;
}

export const displayCurveTolerance = (tolerance: number, scale: number) => Math.min(tolerance, .5 / scale);

function hitSegments(paths: [number, Curve][], p: Point, scale: number, tolerance: number): GeoControl | undefined {
    for (const [index, path] of paths.toReversed()) {
        const hit = nearestSegment(flattenPath(path, displayCurveTolerance(tolerance, scale)), p);
        if (hit && hit.distance * scale <= segmentRadius)
            return { role: "segment", path: index, index: path.nodes.findIndex(v => v.id === hit.edge.from), point: hit.point };
    }
}

export function hitControl(n: GeoNode, p: Point, scale: number, tolerance: number, target?: GeometryTarget) {
    return hitGeoHandle(geoControls(n, target), p, scale) ?? hitPathSegment(n, p, scale, tolerance, target);
}
export function hitParameterGeometry(n: GeoNode, p: Point, scale: number, tolerance: number) {
    const paths = pathEntries(n).filter(([i]) => i < 0);
    const controls = paths.flatMap(([path, curve]) => curve.nodes.map((v, i) => vertexControl(path, i, v.p)));
    controls.push(...parameterPoints(n).map(([index, point]) => pointControl(index, point)));
    return hitGeoHandle(controls, p, scale) ?? hitSegments(paths, p, scale, tolerance);
}
export function hitPathSegment(n: GeoNode, p: Point, scale: number, tolerance: number, target?: GeometryTarget) {
    return hitSegments(editablePaths(n, target), p, scale, tolerance);
}
export function editControl(n: GeoNode, h: GeoControl, at: Point, independent: boolean) {
    if (h.role === "body") return translateGeo(n, [at[0] - h.point[0], at[1] - h.point[1]]);
    if (h.role === "parameter") {
        const p = parameterPoints(n).find(([i]) => i === h.path)![1];
        p[0] = at[0]; p[1] = at[1];
        return;
    }
    const path = geometryPath(n, h.path)!, v = path.nodes[h.index];
    if (h.role === "vertex") v.p = at;
    if (h.role === "in" || h.role === "out") moveHandle(path, h.index, h.role, at, independent);
    if (h.role === "arc") setBulge(v, path.nodes[neighbor(path, h.index, 1)!].p, at);
}

export function removeGeometryItem(d: Design, n: GeoNode, path: Address, index: number) {
    const items = readAt(n.function, path);
    if (!Array.isArray(items) || !items[index]) return;
    shiftGeometryReferences(d, n, path, index, -1);
    items.splice(index, 1);
}
export function copyGeometryItem(d: Design, n: GeoNode, path: Address, index: number) {
    const items = readAt(n.function, path);
    if (!Array.isArray(items) || !items[index]) return;
    shiftGeometryReferences(d, n, path, index, 1);
    const copy = structuredClone(items[index]);
    if (path[0] === "ridges") {
        const id = nodeIds(d);
        for (const v of (copy.line as Curve).nodes) v.id = id();
    }
    items.splice(index + 1, 0, copy);
}
function shiftGeometryReferences(d: Design, n: GeoNode, path: Address, index: number, offset: -1 | 1) {
    const slots = parameters(d), prefix = "geo:" + n.id + "." + path.join(".") + ".";
    const uses: string[] = [], edits: [Address, string][] = [];
    for (const s of slots.values()) {
        const formula = readAt(d, s.path);
        if (typeof formula !== "string" || offset === -1 && s.owner === "geo" && s.id === n.id && s.key.startsWith(prefix + index + ".")) continue;
        const next = formula.replace(/\{([^{}]+)\}/g, (text, ref: string) => {
            const target = slots.get(ref);
            if (!ref.startsWith(prefix) || target?.id !== n.id || target.owner !== "geo") return text;
            const [at, ...rest] = ref.slice(prefix.length).split(".");
            if (offset === -1 && Number(at) === index) uses.push(slotName(s));
            return Number(at) > index ? "{" + prefix + (Number(at) + offset) + "." + rest.join(".") + "}" : text;
        });
        if (next !== formula) edits.push([s.path, next]);
    }
    if (uses.length) throw Error("仍被引用：\n" + [...new Set(uses)].join("\n"));
    for (const [address, formula] of edits) writeAt(d, address, formula);
}
export function removeParameterPoint(d: Design, n: GeoNode, h: GeoControl) {
    const f = n.function;
    if (f.type === "mountain") removeGeometryItem(d, n, ["peaks"], h.path - f.ridges.length);
    if (f.type === "coast") throw Error("港湾需要保留圆心");
    if (f.type === "slope" && f.kind === "radial") throw Error("径向坡面需要保留圆心");
}

function profileNodes(n: GeoNode, path: number): Address | undefined {
    if (path >= 0) return;
    const f = n.function;
    if (f.type === "mountain") return ["ridges", -1 - path, "line", "nodes"];
    if (f.type === "slope" && f.kind === "path") return ["line", "nodes"];
}

export function removeCurveNode(d: Design, n: GeoNode, h: GeoControl) {
    const path = geometryPath(n, h.path);
    if (!path || !canRemoveNode(path)) return;
    const address = profileNodes(n, h.path);
    if (address) shiftGeometryReferences(d, n, address, h.index, -1);
    path.nodes.splice(h.index, 1);
    cleanHandles(path);
}

export function insertCurveNode(d: Design, n: GeoNode, h: GeoControl) {
    const path = geometryPath(n, h.path);
    if (!path) return;
    const address = profileNodes(n, h.path);
    return insertPathNode(path, h.index, h.point, nodeIds(d)(), address ? () => shiftGeometryReferences(d, n, address, h.index, 1) : undefined);
}