import { copyAt } from "../design/address.ts";
import { parameters, readAt, slotName, writeAt, type Address } from "../design/parameters.ts";
import { type Curve, type CurveValue, type Design, type Expression, type GeoNode, type PlacedGeoNode, type ResolvedDesign, type Held, type Point, type SharedCurve } from "../design/v5.ts";
import { curveGraph, geometryIndex, geometrySlot, isCurveRef, isHolderRef, resolvedCurvePath, translateCurve } from "../design/curveReferences.ts";
import { editCurve, localPoint } from "./curveEdits.ts";
import { type Selection } from "./types.ts";
import { references } from "../design/expression.ts";
import { lineProfile } from "../design/polyline.ts";
import { arcHandle, canRemoveNode, insertPathNode, moveHandle, nearestSegment, removePathNode, removePathSegment,
    segmentRemovalIndex, setBulge } from "./paths.ts";
import { flattenPath, flattenSegment, neighbor, pathHandle } from "../design/path.ts";
import { distance } from "../math/geometry.ts";
import { curveRemovalUses, nodeIds, requireUnused, retargetCopiedReferences } from "./geoNodes.ts";

export interface GeometryTarget { kind: "outline" | "curve" | "parameter"; index: number }
export interface GeoControl {
    role: "vertex" | "in" | "out" | "arc" | "segment" | "body" | "outline" | "curve" | "parameter";
    path: number; index: number; point: Point;
}

export type CurveOwner = PlacedGeoNode | SharedCurve;
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

export function geometryPath(n: CurveOwner, index: number): Curve | undefined {
    if ("curve" in n) return index === -1 ? n.curve : undefined;
    if (index >= 0) return n.construction.type === "outline" ? n.construction.outlines[index] : undefined;
    const f = n.function;
    if (f.type === "mountain") return f.ridges[-1 - index]?.curve;
    if (index === -1) {
        if (f.type === "coast") return f.shore;
        if (f.type === "slope" && f.kind === "path") return f.line;
    }
}


export function parameterPoints(n: CurveOwner | GeoNode): [number, Point][] {
    if ("curve" in n) return [];
    const f = n.function;
    if (f.type === "mountain") return f.peaks.map(({ at }, i) => [f.ridges.length + i, at]);
    if (f.type === "coast") return [[0, f.harbor.center]];
    if (f.type === "slope" && f.kind === "radial") return [[0, f.center]];
    return [];
}

export function pathEntries(n: CurveOwner): [number, Curve][] {
    if ("curve" in n) return [[-1, n.curve]];
    const paths: [number, Curve][] = n.construction.type === "outline" ? n.construction.outlines.map((p, i) => [i, p]) : [];
    const count = n.function.type === "mountain" ? n.function.ridges.length : 1;
    for (let i = -1; i >= -count; i--) {
        const curve = geometryPath(n, i);
        if (curve) paths.push([i, curve]);
    }
    return paths;
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
export function hitOutlineVertex(n: PlacedGeoNode, p: Point, scale: number) {
    const controls = editablePaths(n).flatMap(([path, curve]) => curve.nodes.map((v, i) => vertexControl(path, i, v.p)));
    return hitGeoHandle(controls, p, scale);
}

export function* hitParameterGeometries(n: PlacedGeoNode, p: Point, scale: number, tolerance: number) {
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
export function hitSelectedSegment(owner: CurveOwner, part: GeoControl, at: Point, scale: number, tolerance: number) {
    const curve = geometryPath(owner, part.path);
    if (!curve) return;
    const hit = nearestSegment(flattenSegment(curve, part.index, displayCurveTolerance(tolerance, scale)), at);
    if (hit && hit.distance * scale <= segmentRadius) return { ...part, point: hit.point };
}

function movesPlacement({ role }: GeoControl) {
    return role === "body" || role === "outline" || role === "curve";
}

function movedHolders(graph: ReturnType<typeof curveGraph>, id: string, control: GeoControl) {
    return new Set([...graph.holders.values()].filter(slot => slot.location.id === id &&
        (control.role === "body" || geometryIndex(slot) === control.path)).map(graph.holder));
}

function dragDelta(control: GeoControl, at: Point): Point {
    return [at[0] - control.point[0], at[1] - control.point[1]];
}

function addOffset(a: Point, b: Point): Point {
    return [a[0] + b[0], a[1] + b[1]];
}

function movePoints(n: GeoNode | PlacedGeoNode, control: GeoControl, at: Point) {
    if (control.role === "parameter") {
        const point = parameterPoints(n).find(([i]) => i === control.path)![1];
        [point[0], point[1]] = at;
    }
    if (control.role === "body") {
        const delta = dragDelta(control, at);
        for (const [, p] of parameterPoints(n)) [p[0], p[1]] = addOffset(p, delta);
    }
}

function moveCurveControl(path: Curve, h: GeoControl, at: Point, independent: boolean, delta: Point) {
    const v = path.nodes[h.index];
    if (h.role === "vertex") v.p = at;
    if (h.role === "segment") {
        const next = neighbor(path, h.index, 1);
        if (next !== undefined) {
            v.p = addOffset(v.p, delta);
            path.nodes[next].p = addOffset(path.nodes[next].p, delta);
        }
    }
    if (h.role === "in" || h.role === "out") moveHandle(path, h.index, h.role, at, independent);
    if (h.role === "arc") setBulge(v, path.nodes[neighbor(path, h.index, 1)!].p, at);
}

export interface ControlPreview {
    nodes: ReadonlyMap<string, { node: PlacedGeoNode; paths: ReadonlySet<number> }>;
    shared?: SharedCurve;
}

export function controlPreview(d: Design, resolved: ResolvedDesign, graph: ReturnType<typeof curveGraph>,
    selection: Selection, control: GeoControl, independent: boolean): ((at: Point) => ControlPreview) | undefined {
    const { id } = selection, selected = resolved.geoNodes.find(n => n.id === id);
    const placing = movesPlacement(control), shared = selection.kind === "curve";
    const slot = !placing && control.role !== "parameter" ? geometrySlot(d, id, control.path, shared) : undefined;
    const source = slot && graph.source(slot);
    const moved = placing && !shared ? movedHolders(graph, id, control) : undefined;
    const points = selected && (control.role === "parameter" || control.role === "body" && parameterPoints(selected).length > 0);
    if (!moved?.size && !source && !points) return;
    const affected = moved ? [...moved].flatMap(holder => graph.holderPlacements(holder).map(graph.ofHolder)) :
        source ? [...graph.slots.values()].filter(item => graph.source(item).slot === source.slot) : [];
    const placements = affected.map(item => ({ item, offset: graph.offset(item), curve: placing ? graph.shape(item) : undefined }));
    const origins = new Map(affected.flatMap(item => item.holder ? [[item.holder.location.id, resolved.geoNodes[item.holder.location.index]]] : []));
    return at => {
        const nodes = new Map<string, { node: PlacedGeoNode; paths: Set<number> }>();
        if (selected && points) {
            const node = structuredClone(selected);
            movePoints(node, control, at);
            nodes.set(id, { node, paths: new Set() });
        }
        const delta = dragDelta(control, at);
        const edited = source ? structuredClone(source.curve) : undefined;
        if (edited && slot) moveCurveControl(edited, control, localPoint(graph.offset(slot), at), independent, delta);
        for (const { item, offset, curve } of placements) {
            if (!item.holder) continue;
            const owner = item.holder.location.id;
            const entry = nodes.get(owner) ?? { node: origins.get(owner)!, paths: new Set<number>() };
            const placed = translateCurve(curve ?? edited!, placing ? addOffset(offset, delta) : offset);
            entry.node = copyAt(entry.node, resolvedCurvePath(item).slice(2), placed);
            entry.paths.add(geometryIndex(item));
            nodes.set(owner, entry);
        }
        return { nodes, ...(shared && edited && { shared: { ...resolved.curves[id], curve: edited as Curve<never> } }) };
    };
}

export function commitControl(d: Design, selection: Selection, control: GeoControl, at: Point, independent: boolean) {
    const { id } = selection;
    if (control.role === "parameter" || movesPlacement(control)) {
        if (selection.kind === "curve") return;
        const delta = dragDelta(control, at);
        const node = d.geoNodes.find(v => v.id === id)!;
        movePoints(node, control, at);
        if (control.role === "parameter" || !delta.some(Boolean)) return;
        for (const { value } of movedHolders(curveGraph(d), id, control)) {
            const offset = addOffset(value.offset ?? [0, 0], delta);
            if (offset.some(Boolean)) value.offset = offset;
            else delete value.offset;
        }
    }
    else editCurve(d, selection, control.path, (curve, local) => moveCurveControl(curve, control, local(at), independent, dragDelta(control, at)));
}

export function geometryItemCurveUses(d: Design, id: string, path: Address, index: number) {
    const prefix = path[0] === "construction" ? [...path, index] : ["function", ...path, index];
    const matches = (location: { kind: string; id?: string; path: Address }) =>
        location.kind === "geo" && location.id === id && prefix.every((part, i) => location.path[i] === part);
    const graph = curveGraph(d), slots = parameters(d, undefined, graph);
    const key = "geo:" + id + "." + [...path, index].join(".") + ".";
    const uses = curveRemovalUses(d, slot => matches(slot.location));
    for (const slot of slots.values()) if (!matches(slot.location) && typeof readAt(d, slot.path) === "string" &&
        references(slot.value).some(ref => ref.startsWith(key) && slots.has(graph.parameterKey(ref)))) uses.push({ kind: "parameter", slot });
    return uses;
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
    const { prefix, slots, belongs } = shiftGeometryReferences(d, n, path, index, 1);
    const copy = structuredClone(items[index]);
    const from = prefix + index, to = prefix + (index + 1);
    const length = path.length + (path[0] === "construction" ? 1 : 2);
    for (const slot of slots.values()) if (slot.owner === "geo" && slot.id === n.id && slot.key.startsWith(from + ".")) {
        const address = slot.location.path.slice(length), value = readAt(copy, address);
        if (typeof value === "string") writeAt(copy, address, retargetCopiedReferences(value, from, to, (key, next) => belongs(key) ? next : key));
    }
    const holder = path[0] === "ridges" || path[0] === "construction" ? copy as Held<CurveValue> : undefined;
    if (holder && !isHolderRef(holder) && !isCurveRef(holder.curve)) {
        const id = nodeIds(d);
        for (const v of holder.curve.nodes) v.id = id();
    }
    items.splice(index + 1, 0, copy);
}
function shiftGeometryReferences(d: Design, n: GeoNode, path: Address, index: number, offset: -1 | 1) {
    const graph = curveGraph(d), slots = parameters(d, undefined, graph), prefix = "geo:" + n.id + "." + path.join(".") + ".";
    function belongs(key: string) {
        const location = (slots.get(key) ?? graph.parameterHolder(key))?.location;
        return location?.kind === "geo" && location.id === n.id;
    }
    const uses: string[] = [], edits: [Address, string][] = [];
    const shifted = (key: string) => key.replace(/^(\d+)(?=\.|$)/, at => Number(at) > index ? String(Number(at) + offset) : at);
    for (const s of slots.values()) {
        const formula = readAt(d, s.path);
        if (typeof formula !== "string" || offset === -1 && s.owner === "geo" && s.id === n.id && s.key.startsWith(prefix + index + ".")) continue;
        const next = formula.replace(/\{([^{}]+)\}/g, (text, ref: string) => {
            if (!ref.startsWith(prefix) || !belongs(ref) || !slots.has(graph.parameterKey(ref))) return text;
            const [at, ...rest] = ref.slice(prefix.length).split(".");
            if (offset === -1 && Number(at) === index) uses.push(slotName(s));
            return "{" + prefix + shifted([at, ...rest].join(".")) + "}";
        });
        if (next !== formula) edits.push([s.path, next]);
    }
    for (const { slot, target } of graph.references()) if (target.key.startsWith(prefix) && target.location.kind === "geo" && target.location.id === n.id) {
        const next = prefix + shifted(target.key.slice(prefix.length));
        if (next !== target.key) edits.push([[...slot.path, "ref"], "{" + next + "}"]);
    }
    if (uses.length) throw Error("仍被引用：\n" + [...new Set(uses)].join("\n"));
    for (const [address, formula] of edits) writeAt(d, address, formula);
    return { prefix, slots, belongs };
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
    const source = slot && curveGraph(d).source(slot).slot;
    return editCurve(d, owner, control.path, path => {
        const removed = segmentRemovalIndex(path, control.index);
        if (removed === undefined) return;
        const geo = source?.holder && source.height && d.geoNodes[source.holder.location.index];
        const height = geo && path.closed ? mergedHeight(d, geo, path, control.index, removed) : undefined;
        const node = removePathSegment(path, control.index)!;
        if (height !== undefined) node.h = height;
        return node;
    });
}

export function insertCurveNode(d: Design, n: GeoNode | Selection, h: GeoControl) {
    return editCurve(d, selectedOwner(n), h.path, (path, local) => insertPathNode(path, h.index, local(h.point), nodeIds(d)()));
}