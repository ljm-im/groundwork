import { parameters, readAt, slotName, writeAt, type Address } from "../design/parameters.ts";
import { type Curve, type CurveValue, type Design, type Expression, type GeoNode, type Point, type SharedCurve } from "../design/v5.ts";
import { curveGraph, curveKey, geometryIndex, geometrySlot, isCurveRef, refKey, type CurveSlot } from "../design/curveReferences.ts";
import { editCurve } from "./curveEdits.ts";
import { type Selection } from "./types.ts";
import { lineProfile } from "../design/polyline.ts";
import { type RegionShape } from "../design/regions.ts";
import { arcHandle, canRemoveNode, insertPathNode, moveHandle, nearestSegment, removePathNode, removePathSegment,
    segmentRemovalIndex, setBulge, translateCurve, translateGeo } from "./paths.ts";
import { flattenPath, neighbor, pathHandle } from "../design/path.ts";
import { distance } from "../math/geometry.ts";
import { curveRemovalUses, nodeIds, requireUnused } from "./geoNodes.ts";

export interface GeometryTarget { kind: "outline" | "curve" | "parameter"; index: number }
export interface GeoControl {
    role: "vertex" | "in" | "out" | "arc" | "segment" | "body" | "outline" | "curve" | "parameter";
    path: number; index: number; point: Point;
}

export type CurveOwner = GeoNode | SharedCurve;
export interface CurveSelection { role: "outline" | "curve" | "vertex" | "segment"; nodeId: string; path?: number }
export type GeometrySelection = CurveSelection | { role: "parameter"; path: number };
export type GeometryHover = GeometrySelection | { role: "in" | "out" | "arc"; nodeId: string; path?: number };
export type GeometryPart = Pick<GeoControl, "role" | "path" | "index">;

export function geometrySelection(n: CurveOwner, { role, path, index }: GeometryPart): GeometrySelection | undefined {
    if (role === "parameter") return { role, path };
    if (role === "outline" || role === "curve" || role === "vertex" || role === "segment") {
        const curve = geometryPath(n, path), node = curve?.nodes[role === "outline" || role === "curve" ? 0 : index];
        if (node) return { role, nodeId: node.id, ...curvePlacement(n, path, node.id) };
    }
}

export function geometryHover(n: CurveOwner, control: GeometryPart): GeometryHover | undefined {
    const { role, path, index } = control;
    if (role === "in" || role === "out" || role === "arc") {
        const node = geometryPath(n, path)?.nodes[index];
        return node && { role, nodeId: node.id, ...curvePlacement(n, path, node.id) };
    }
    return geometrySelection(n, control);
}

export function controlOwner(control?: GeoControl): GeoControl | undefined {
    if (control?.role === "arc") return { ...control, role: "segment" };
    if (control?.role === "in" || control?.role === "out") return { ...control, role: "vertex" };
    return control;
}

export function parameterTarget(control: GeoControl): GeometryTarget | undefined {
    if (control.path < 0) return { kind: "curve", index: control.path };
    if (control.role === "parameter") return { kind: "parameter", index: control.path };
}

function curvePlacement(n: CurveOwner, path: number, id: string) {
    return pathEntries(n).some(([i, curve]) => i !== path && curve.nodes.some(node => node.id === id)) ? { path } : undefined;
}

function geometryValue(n: CurveOwner, index: number): CurveValue | undefined {
    if ("curve" in n) return index === -1 ? n.curve : undefined;
    if (index >= 0) return n.construction.type === "outline" ? n.construction.outlines[index] : undefined;
    const f = n.function;
    if (f.type === "mountain") return f.ridges[-1 - index]?.line;
    if (index === -1) {
        if (f.type === "coast") return f.shore;
        if (f.type === "slope" && f.kind === "path") return f.line;
    }
}

export function geometryPath(n: CurveOwner, index: number): Curve | undefined {
    const value = geometryValue(n, index);
    return value && !isCurveRef(value) ? value : undefined;
}

export function parameterPoints(n: CurveOwner): [number, Point][] {
    if ("curve" in n) return [];
    const f = n.function;
    if (f.type === "mountain") return f.peaks.map(({ at }, i) => [f.ridges.length + i, at]);
    if (f.type === "coast") return [[0, f.harbor.center]];
    if (f.type === "slope" && f.kind === "radial") return [[0, f.center]];
    return [];
}

export function pathEntries(n: CurveOwner): [number, Curve][] {
    if ("curve" in n) return [[-1, n.curve]];
    const paths: [number, Curve][] = n.construction.type === "outline" ? n.construction.outlines.flatMap((p, i) => isCurveRef(p) ? [] : [[i, p]]) : [];
    const count = n.function.type === "mountain" ? n.function.ridges.length : 1;
    for (let i = -1; i >= -count; i--) {
        const curve = geometryPath(n, i);
        if (curve) paths.push([i, curve]);
    }
    return paths;
}

export interface OutlineParameterGeometry {
    paths: readonly number[];
    points: ReadonlySet<number>;
}

export function outlineParameterGeometry(n: GeoNode, outline: number, shape?: RegionShape): OutlineParameterGeometry | undefined {
    const containingOutlines = shape?.containingOutlines;
    if (!containingOutlines) return;
    const owns = (point: Point) => containingOutlines(point)[0] === outline;
    return {
        paths: pathEntries(n).filter(([index, path]) => index < 0 && path.nodes.length && path.nodes.every(node => owns(node.p)))
            .map(([index]) => index),
        points: new Set(parameterPoints(n).filter(([, point]) => owns(point)).map(([index]) => index))
    };
}

const vertexControl = (path: number, index: number, point: Point): GeoControl => ({ role: "vertex", path, index, point });
const pointControl = (path: number, point: Point): GeoControl => ({ role: "parameter", path, index: 0, point });

export function resolveGeometrySelection(n: CurveOwner, part: GeometryHover): GeoControl | undefined {
    if (part.role === "parameter") {
        const point = parameterPoints(n).find(([i]) => i === part.path);
        return point && pointControl(...point);
    }
    const { role, nodeId } = part;
    for (const [path, curve] of pathEntries(n)) {
        if (part.path !== undefined && part.path !== path) continue;
        const index = curve.nodes.findIndex(v => v.id === nodeId);
        if (index < 0) continue;
        const node = curve.nodes[index];
        if (role === "in" || role === "out") return { role, path, index, point: pathHandle(curve, index, role) };
        const next = neighbor(curve, index, 1);
        if (role === "arc") {
            if (next !== undefined && node.bulge !== undefined)
                return { role, path, index, point: arcHandle(node.p, curve.nodes[next].p, node.bulge) };
        }
        else if (role === "vertex" || next !== undefined) return { role, path, index, point: node.p };
    }
}

export function geoControls(n: CurveOwner, target?: GeometryTarget) {
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

function editablePaths(n: CurveOwner, target?: GeometryTarget) {
    return pathEntries(n).filter(([i]) => target ? target.kind !== "parameter" && i === target.index : i >= 0 || "curve" in n);
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

export function hitControl(n: CurveOwner, p: Point, scale: number, tolerance: number, target?: GeometryTarget) {
    return hitGeoControl(n, p, scale, target) ?? hitPathSegment(n, p, scale, tolerance, target);
}
export function hitGeoControl(n: CurveOwner, p: Point, scale: number, target?: GeometryTarget) {
    return hitGeoHandle(geoControls(n, target), p, scale);
}
export function hitOutlineVertex(n: GeoNode, p: Point, scale: number) {
    const controls = editablePaths(n).flatMap(([path, curve]) => curve.nodes.map((v, i) => vertexControl(path, i, v.p)));
    return hitGeoHandle(controls, p, scale);
}

export function* hitParameterGeometries(n: GeoNode, p: Point, scale: number, tolerance: number) {
    for (const [index, point] of parameterPoints(n).reverse())
        if (distance(p, point) * scale <= handleRadius) yield pointControl(index, point);
    for (const [path, curve] of pathEntries(n).reverse()) {
        if (path >= 0) continue;
        const vertices = curve.nodes.map((v, i) => vertexControl(path, i, v.p));
        const hit = hitGeoHandle(vertices, p, scale) ?? hitSegments([[path, curve]], p, scale, tolerance);
        if (hit) yield hit;
    }
}
export function hitPathSegment(n: CurveOwner, p: Point, scale: number, tolerance: number, target?: GeometryTarget) {
    return hitSegments(editablePaths(n, target), p, scale, tolerance);
}
export type FollowingCurves = ReadonlyMap<string, ReadonlySet<number>>;

function movesCurves({ role, path }: GeoControl) {
    return role === "body" || role === "outline" || role === "curve" || role === "segment" && path < 0;
}

function movesPath(h: GeoControl, path: number, outlineGeometry?: OutlineParameterGeometry) {
    return h.role === "body" || h.path === path || h.role === "outline" && !!outlineGeometry?.paths.includes(path);
}

export function followingCurves(graph: ReturnType<typeof curveGraph>, owner: string, h: GeoControl, outlineGeometry?: OutlineParameterGeometry): FollowingCurves | undefined {
    if (!movesCurves(h)) return;
    const followers = new Map<string, Set<number>>(), inherited = new Map<string, boolean>();
    function follows(slot: CurveSlot): boolean {
        const value = slot.value, known = inherited.get(slot.key);
        if (known !== undefined) return known;
        if (!isCurveRef(value)) return false;
        const source = graph.slots.get(refKey(value.ref) ?? "");
        if (!source) return false;
        const moves = source.location.kind === "geo" && source.location.id === owner && movesPath(h, geometryIndex(source), outlineGeometry) ||
            follows(source);
        inherited.set(slot.key, moves);
        return moves;
    }
    for (const slot of graph.slots.values()) {
        if (slot.location.kind !== "geo" || !follows(slot)) continue;
        const id = slot.location.id, paths = followers.get(id) ?? new Set<number>();
        paths.add(geometryIndex(slot));
        followers.set(id, paths);
    }
    return followers.size ? followers : undefined;
}

function movePlacement(n: CurveOwner, h: GeoControl, at: Point, outlineGeometry?: OutlineParameterGeometry, inherited?: ReadonlySet<number>) {
    const delta: Point = [at[0] - h.point[0], at[1] - h.point[1]];
    if (h.role === "body" && !("curve" in n)) {
        const skip = inherited && new Set([...inherited].map(path => geometryValue(n, path)!));
        translateGeo(n, delta, skip);
        return true;
    }
    if (h.role === "parameter") {
        const p = parameterPoints(n).find(([i]) => i === h.path)![1];
        p[0] = at[0]; p[1] = at[1];
        return true;
    }
    if (!movesCurves(h)) return false;
    const move = (path: number) => {
        if (!inherited?.has(path)) translateCurve(geometryValue(n, path)!, delta);
    };
    move(h.path);
    if (h.role === "outline" && outlineGeometry) {
        for (const index of outlineGeometry.paths) move(index);
        for (const [index, point] of parameterPoints(n)) if (outlineGeometry.points.has(index)) {
            point[0] += delta[0];
            point[1] += delta[1];
        }
    }
    return true;
}

function moveCurveControl(path: Curve, h: GeoControl, at: Point, independent: boolean) {
    const v = path.nodes[h.index];
    if (h.role === "vertex") v.p = at;
    if (h.role === "in" || h.role === "out") moveHandle(path, h.index, h.role, at, independent);
    if (h.role === "arc") setBulge(v, path.nodes[neighbor(path, h.index, 1)!].p, at);
}

export function editControl(n: CurveOwner, h: GeoControl, at: Point, independent: boolean, outlineGeometry?: OutlineParameterGeometry, followers?: ReadonlySet<number>) {
    if (!movePlacement(n, h, at, outlineGeometry)) moveCurveControl(geometryPath(n, h.path)!, h, at, independent);
    if (!followers) return;
    const delta: Point = [at[0] - h.point[0], at[1] - h.point[1]];
    for (const path of followers) if (!movesPath(h, path, outlineGeometry)) translateCurve(geometryPath(n, path)!, delta);
}

export function commitControl(d: Design, selection: Selection, h: GeoControl, at: Point, independent: boolean, outlineGeometry?: OutlineParameterGeometry) {
    const n = selection.kind === "curve" ? d.curves[selection.id] : d.geoNodes.find(v => v.id === selection.id)!;
    if (!movesCurves(h)) {
        if (h.role === "parameter") movePlacement(n, h, at);
        else editCurve(d, selection, h.path, (curve, local) => moveCurveControl(curve, h, local(at), independent));
        return;
    }
    const graph = curveGraph(d);
    if (selection.kind !== "curve") {
        // A curve already following another moved slot needs no change to its own offset.
        const inherited = followingCurves(graph, selection.id, h, outlineGeometry)?.get(selection.id);
        movePlacement(n, h, at, outlineGeometry, inherited);
        return;
    }
    movePlacement(n, h, at, outlineGeometry);
    const key = curveKey(selection.id), inverse: Point = [h.point[0] - at[0], h.point[1] - at[1]];
    if (!inverse.some(Boolean)) return;
    // A shared curve's origin is only used for editing it.
    for (const { value } of graph.slots.values()) if (isCurveRef(value) && refKey(value.ref) === key) translateCurve(value, inverse);
}

export function geometryItemCurveUses(d: Design, id: string, path: Address, index: number) {
    return curveRemovalUses(d, slot => slot.location.kind === "geo" && slot.location.id === id &&
        path.every((part, i) => slot.location.path[i + (path[0] === "construction" ? 0 : 1)] === part) &&
        slot.location.path[path.length + (path[0] === "construction" ? 0 : 1)] === index);
}

export function removeGeometryItem(d: Design, n: GeoNode, path: Address, index: number) {
    const items = readAt(path[0] === "construction" ? n : n.function, path);
    if (!Array.isArray(items) || !items[index]) return;
    requireUnused(geometryItemCurveUses(d, n.id, path, index));
    shiftGeometryReferences(d, n, path, index, -1);
    items.splice(index, 1);
}
export function copyGeometryItem(d: Design, n: GeoNode, path: Address, index: number) {
    const items = readAt(path[0] === "construction" ? n : n.function, path);
    if (!Array.isArray(items) || !items[index]) return;
    shiftGeometryReferences(d, n, path, index, 1);
    const copy = structuredClone(items[index]);
    const curve = path[0] === "ridges" ? copy.line as CurveValue : path[0] === "construction" ? copy as CurveValue : undefined;
    if (curve && !isCurveRef(curve)) {
        const id = nodeIds(d);
        for (const v of curve.nodes) v.id = id();
    }
    items.splice(index + 1, 0, copy);
}
function shiftGeometryReferences(d: Design, n: GeoNode, path: Address, index: number, offset: -1 | 1) {
    const slots = parameters(d), prefix = "geo:" + n.id + "." + path.join(".") + ".";
    const uses: string[] = [], edits: [Address, string][] = [];
    const shifted = (key: string) => key.replace(/^(\d+)(?=\.|$)/, at => Number(at) > index ? String(Number(at) + offset) : at);
    for (const s of slots.values()) {
        const formula = readAt(d, s.path);
        if (typeof formula !== "string" || offset === -1 && s.owner === "geo" && s.id === n.id && s.key.startsWith(prefix + index + ".")) continue;
        const next = formula.replace(/\{([^{}]+)\}/g, (text, ref: string) => {
            const target = slots.get(ref);
            if (!ref.startsWith(prefix) || target?.id !== n.id || target.owner !== "geo") return text;
            const [at, ...rest] = ref.slice(prefix.length).split(".");
            if (offset === -1 && Number(at) === index) uses.push(slotName(s));
            return "{" + prefix + shifted([at, ...rest].join(".")) + "}";
        });
        if (next !== formula) edits.push([s.path, next]);
    }
    const { slots: curves } = curveGraph(d);
    for (const slot of curves.values()) if (isCurveRef(slot.value)) {
        const key = refKey(slot.value.ref), target = key ? curves.get(key) : undefined;
        if (key?.startsWith(prefix) && target?.location.kind === "geo" && target.location.id === n.id) {
            const next = prefix + shifted(key.slice(prefix.length));
            if (next !== key) edits.push([[...slot.path, "ref"], "{" + next + "}"]);
        }
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

function selectedOwner(n: GeoNode | Selection): Selection {
    return "kind" in n ? n : { kind: "geoNode", id: n.id };
}

export function removeCurveNode(d: Design, n: GeoNode | Selection, h: GeoControl) {
    return editCurve(d, selectedOwner(n), h.path, path => {
        if (path.nodes[h.index] && canRemoveNode(path)) removePathNode(path, h.index);
    });
}

function mixHeight(a: Expression, b: Expression, t: number): Expression {
    if (!t || a === b) return a;
    if (t === 1) return b;
    if (typeof a === "number" && typeof b === "number") return a * (1 - t) + b * t;
    return "(" + a + ") * " + (1 - t) + " + (" + b + ") * " + t;
}

function mergedHeight(d: Design, n: GeoNode, path: Curve, a: number, b: number) {
    const start = path.nodes[a].h, end = path.nodes[b].h;
    if (start !== undefined && end !== undefined) return mixHeight(start, end, .5);
    const f = n.function, ease = f.type === "mountain" || f.type === "slope" && f.kind === "path" && f.ease;
    const profile = lineProfile(path, d.grid.step / 8);
    function height(index: number) {
        const span = profile.span(profile.nodeStation(index), ease);
        return path.nodes[index].h ?? (span ? mixHeight(span.a.h, span.b.h, span.t) : 0);
    }
    return mixHeight(height(a), height(b), .5);
}

export function removeCurveSegment(d: Design, n: GeoNode | Selection, control: GeoControl) {
    const owner = selectedOwner(n), slot = geometrySlot(d, owner.id, control.path, owner.kind === "curve");
    return editCurve(d, owner, control.path, path => {
        const removed = segmentRemovalIndex(path, control.index);
        if (removed === undefined) return;
        const geo = slot?.height && !isCurveRef(slot.value) && d.geoNodes.find(v => v.id === owner.id);
        const height = geo && path.closed ? mergedHeight(d, geo, path, control.index, removed) : undefined;
        const node = removePathSegment(path, control.index)!;
        if (height !== undefined) node.h = height;
        return node;
    });
}

export function insertCurveNode(d: Design, n: GeoNode | Selection, h: GeoControl) {
    return editCurve(d, selectedOwner(n), h.path, (path, local) => insertPathNode(path, h.index, local(h.point), nodeIds(d)()));
}