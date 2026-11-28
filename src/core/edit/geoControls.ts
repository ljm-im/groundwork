import { copyAt } from "../design/address.ts";
import { parameters, readAt, writeAt, type Address } from "../design/parameters.ts";
import { type Curve, type CurveGeometry, type Design, type GeoNode, type GeometryObject, type PlacedGeoNode, type ResolvedDesign, type Held, type Point, type PointHolder } from "../design/v5.ts";
import { curveGraph, geoPointSlots, geometryAt, geometryIndex, geometrySlot, geometryUsers, offsetPoint, placedPoint, pointGeometryId, profileGroupsFor, profileIndex, resolvedCurvePath, translateCurve, type FunctionMember, type PointSlot } from "../design/curveReferences.ts";
import { editCurve, localPoint } from "./curveEdits.ts";
import { movePointGeometry, translateHolder } from "./controls.ts";
import { type Selection } from "./types.ts";
import { arcHandle, canRemoveNode, insertPathNode, moveHandle, nearestSegment, removePathNode, removePathSegment,
    setBulge } from "./paths.ts";
import { flattenPath, neighbor, pathHandle } from "../design/path.ts";
import { distance } from "../math/geometry.ts";
import { copyHeldGeometry, nodeIds, parameterRemovalUses, requireUnused, retargetCopiedReferences } from "./geoNodes.ts";

export interface GeometryTarget { kind: "outline" | "curve" | "parameter"; index: number }
export interface GeoControl {
    role: "vertex" | "in" | "out" | "arc" | "segment" | "body" | "outline" | "curve" | "parameter" | "pointHolder";
    path: number; index: number; point: Point;
}

export type CurveOwner = PlacedGeoNode | CurveGeometry;
export function controlOwner(control?: GeoControl): GeoControl | undefined {
    if (control?.role === "arc") return { ...control, role: "segment" };
    if (control?.role === "in" || control?.role === "out") return { ...control, role: "vertex" };
    return control;
}

export function geometryPath(n: CurveOwner, index: number): Curve | undefined {
    if ("curve" in n) return index === -1 ? n.curve : undefined;
    if (index >= 0) return n.construction.type === "outline" ? n.construction.outlines[index] : undefined;
    const f = n.function;
    if (f.type === "mountain") return (f.ridges[-1 - index] ?? f.valleys[-1 - index - f.ridges.length])?.curve;
    if (f.type === "slope" && f.kind === "path") return f.lines[-1 - index]?.curve;
    if (f.type === "coast" && index === -1) return f.shore;
}

export function curveMember(f: PlacedGeoNode["function"] | GeoNode["function"], path: number) {
    for (const group of profileGroupsFor(f)) {
        const index = profileIndex(f, group, 0) - path;
        const size = f.type === "mountain" ? (group === "valleys" ? f.valleys.length : f.ridges.length) : f.type === "slope" ? f.lines.length : 0;
        if (index >= 0 && index < size) return { group, index };
    }
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
    const paths: [number, Curve][] = n.construction.type === "outline" ? n.construction.outlines.map((p, i) => [i, p]) : [];
    const f = n.function;
    const count = f.type === "mountain" ? f.ridges.length + f.valleys.length : f.type === "slope" && f.kind === "path" ? f.lines.length : 1;
    for (let i = -1; i >= -count; i--) {
        const curve = geometryPath(n, i);
        if (curve) paths.push([i, curve]);
    }
    return paths;
}

const vertexControl = (path: number, index: number, point: Point): GeoControl => ({ role: "vertex", path, index, point });
const pointControl = (path: number, point: Point): GeoControl => ({ role: "parameter", path, index: 0, point });

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
export function hitPointHandle(point: Point, pointer: Point, scale: number, radius = handleRadius) {
    return distance(point, pointer) * scale <= radius;
}

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
export function hitCurveVertex(curve: Curve, p: Point, scale: number, excluded?: string) {
    return hitGeoHandle(curve.nodes.flatMap(({ p: point, id }, index): GeoControl[] =>
        id === excluded ? [] : [{ role: "vertex", path: -1, index, point }]), p, scale);
}

export function hitPathSegment(n: CurveOwner, p: Point, scale: number, tolerance: number, target?: GeometryTarget) {
    return hitSegments(editablePaths(n, target), p, scale, tolerance);
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

function parameterHolder(n: GeoNode, path: number) {
    const f = n.function;
    if (f.type === "mountain") return f.peaks[path - f.ridges.length]?.at;
    if (f.type === "coast") return f.harbor.center;
    if (f.type === "slope" && f.kind === "radial") return f.center;
}

function moveCurveControl(path: Curve, h: GeoControl, at: Point, independent: boolean, delta: Point) {
    if (h.role === "curve") {
        for (const node of path.nodes) node.p = offsetPoint(node.p, delta);
        return;
    }
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

function draggedPoint(d: Design, selection: Selection, control: GeoControl, index: number, offset?: Point): PointHolder | undefined {
    if (selection.kind === "geometry") return { point: selection.id, offset };
    if (selection.kind === "section") return d.sections.find(s => s.id === selection.id)?.points[control.index];
    if (selection.kind === "mark") {
        const mark = d.marks.find(m => m.id === selection.id);
        if (mark?.follow === "map") return mark.point;
    }
    if (selection.kind === "geoNode" && index >= 0) return parameterHolder(d.geoNodes[index], control.path);
}

export interface ControlPreview {
    nodes: ReadonlyMap<string, { node: PlacedGeoNode; paths: ReadonlySet<number> }>;
    geometry?: GeometryObject;
    point?: { id: string; point: Point };
    curve?: { id: string; curve: Curve };
}

export function previewPoint(holder: PointHolder, preview: Pick<ControlPreview, "point" | "curve">) {
    const point = "point" in holder ? preview.point?.id === holder.point ? preview.point.point : undefined :
        preview.curve?.id === holder.curve ? preview.curve.curve.nodes.find(node => node.id === holder.node)?.p : undefined;
    return point && offsetPoint(point, holder.offset ?? [0, 0]);
}

export function controlPreview(d: Design, resolved: ResolvedDesign, graph: ReturnType<typeof curveGraph>,
    selection: Selection, control: GeoControl, independent: boolean, offset?: Point): ((at: Point) => ControlPreview) | undefined {
    const { id } = selection, index = d.geoNodes.findIndex(n => n.id === id), selected = resolved.geoNodes[index];
    const standalone = selection.kind === "geometry", placing = !standalone && movesPlacement(control);
    const placingPoint = control.role === "pointHolder";
    const curveSlot = control.role !== "parameter" && !placingPoint && (!movesPlacement(control) || standalone && control.role === "curve") ?
        geometrySlot(d, id, control.path, standalone) : undefined;
    const moved = placing ? movedHolders(graph, id, control) : undefined;
    const point = control.role === "parameter" || placingPoint ? draggedPoint(d, selection, control, index, offset) : undefined;
    const nodeSlot = point && !placingPoint && "node" in point ? geometrySlot(d, point.curve, -1, true) : undefined;
    const sourceSlot = curveSlot ?? nodeSlot, source = sourceSlot && graph.source(sourceSlot);
    const ownPoints = selected && (control.role === "body" || placingPoint) ?
        geoPointSlots(d.geoNodes[index], index).filter(slot => !placingPoint || slot.value === point) : [];
    const shapeId = source?.id ?? (point && !placingPoint ? pointGeometryId(point) : undefined);
    const pointUsers = shapeId ? geometryUsers(d).get(shapeId)?.filter((slot): slot is PointSlot => !("kind" in slot) && slot.location.kind === "geo") ?? [] : [];
    if (!moved?.size && !source && !point && !ownPoints.length) return;
    const affected = moved ? [...moved].flatMap(graph.holderPlacements) : source ? graph.curvePlacements(source.id) : [];
    const placements = affected.filter(item => item.active).map(holder => {
        const slot = graph.ofHolder(holder);
        return { slot, holder, offset: graph.offset(slot), curve: placing ? graph.shape(slot) : undefined };
    });
    return at => {
        const nodes = new Map<string, { node: PlacedGeoNode; paths: Set<number> }>();
        function update(owner: string, index: number, path: Address, value: unknown, curve?: number) {
            const entry = nodes.get(owner) ?? { node: resolved.geoNodes[index], paths: new Set<number>() };
            entry.node = copyAt(entry.node, path, value);
            if (curve !== undefined) entry.paths.add(curve);
            nodes.set(owner, entry);
        }
        const delta = dragDelta(control, at), local = point && !placingPoint ? localPoint(point.offset ?? [0, 0], at) : undefined;
        for (const item of ownPoints)
            update(id, index, item.location.path, offsetPoint(placedPoint(d, item.value), delta));
        const edited = source && structuredClone(source.curve);
        if (edited && curveSlot) moveCurveControl(edited, control, localPoint(offset ?? graph.offset(curveSlot), at), independent, delta);
        if (edited && local && point && "node" in point) edited.nodes.find(node => node.id === point.node)!.p = local;
        const preview = {
            point: local && point && "point" in point ? { id: point.point, point: local } : undefined,
            curve: edited ? { id: source!.id, curve: edited } : undefined
        };
        for (const item of pointUsers) {
            const at = item.location, position = previewPoint(item.value, preview);
            if (at.kind === "geo" && position) update(at.id, at.index!, at.path, position);
        }
        for (const { slot, holder, offset, curve } of placements) {
            const placed = translateCurve(curve ?? edited!, placing ? addOffset(offset, delta) : offset);
            update(holder.location.id, holder.location.index, resolvedCurvePath(slot).slice(2), placed, holder.index);
        }
        const item = standalone && geometryAt(d, id);
        const geometry = item && (edited ? { ...item, curve: edited } : local ? { ...item, point: local } : undefined);
        return { nodes, ...preview, ...(geometry && { geometry }) };
    };
}

export function commitControl(d: Design, selection: Selection, control: GeoControl, at: Point, independent: boolean, offset?: Point) {
    const { id } = selection, standalone = selection.kind === "geometry";
    if (control.role === "parameter" || control.role === "pointHolder") {
        const holder = draggedPoint(d, selection, control, d.geoNodes.findIndex(n => n.id === id), offset);
        if (holder && control.role === "pointHolder") translateHolder(holder, dragDelta(control, at));
        else if (holder) movePointGeometry(d, holder, at);
    }
    else if (!standalone && movesPlacement(control)) {
        const delta = dragDelta(control, at);
        if (!delta.some(Boolean)) return;
        for (const { value } of movedHolders(curveGraph(d), id, control)) translateHolder(value, delta);
        if (control.role === "body") {
            const index = d.geoNodes.findIndex(n => n.id === id);
            for (const slot of geoPointSlots(d.geoNodes[index], index)) translateHolder(slot.value, delta);
        }
    }
    else if (!movesPlacement(control) || control.role === "curve")
        editCurve(d, selection, control.path, (curve, local) => moveCurveControl(curve, control, offset ? localPoint(offset, at) : local(at), independent, dragDelta(control, at)));
}

export function geometryItemCurveUses(d: Design, id: string, path: Address, index: number) {
    const prefix = path[0] === "construction" ? [...path, index] : ["function", ...path, index];
    const matches = (location: { kind: string; id?: string; path: Address }) =>
        location.kind === "geo" && location.id === id && prefix.every((part, i) => location.path[i] === part);
    return parameterRemovalUses(d, matches);
}

export function removeGeometryItem(d: Design, n: GeoNode, path: Address, index: number) {
    const items = readAt(path[0] === "construction" ? n : n.function, path);
    if (!Array.isArray(items) || !items[index]) return;
    requireUnused(geometryItemCurveUses(d, n.id, path, index));
    shiftGeometryReferences(d, n, path, index, -1);
    items.splice(index, 1);
}
export function copyGeometryItem(d: Design, n: GeoNode, path: [FunctionMember], index: number) {
    const items = readAt(n.function, path);
    if (!Array.isArray(items) || !items[index]) return;
    const { prefix, slots, belongs } = shiftGeometryReferences(d, n, path, index, 1);
    const copy = structuredClone(items[index]);
    const from = prefix + index, to = prefix + (index + 1);
    const length = path.length + 2;
    for (const slot of slots.values()) if (slot.owner === "geo" && slot.id === n.id && slot.key.startsWith(from + ".")) {
        const address = slot.location.path.slice(length), value = readAt(copy, address);
        if (typeof value === "string") writeAt(copy, address, retargetCopiedReferences(value, from, to, (key, next) => belongs(key) ? next : key));
    }
    const holder = path[0] === "peaks" ? (copy as { at: PointHolder }).at : copy as Held;
    if (!("ref" in holder)) {
        const source = ["function", ...path, index];
        copyHeldGeometry(d, [holder], at => at.kind === "geo" && at.id === n.id && source.every((part, i) => at.path[i] === part));
    }
    items.splice(index + 1, 0, copy);
}
function shiftGeometryReferences(d: Design, n: GeoNode, path: Address, index: number, offset: -1 | 1) {
    const graph = curveGraph(d), slots = parameters(d, undefined, graph, true), prefix = "geo:" + n.id + "." + path.join(".") + ".";
    function belongs(key: string) {
        const location = (slots.get(key) ?? graph.parameterHolder(key))?.location;
        return location?.kind === "geo" && location.id === n.id;
    }
    const edits: [Address, string][] = [];
    const shifted = (key: string) => key.replace(/^(\d+)(?=\.|$)/, at => Number(at) > index ? String(Number(at) + offset) : at);
    for (const s of slots.values()) {
        const formula = readAt(d, s.path);
        if (typeof formula !== "string") continue;
        const next = formula.replace(/\{([^{}]+)\}/g, (text, ref: string) => {
            if (!ref.startsWith(prefix) || !belongs(ref) || !slots.has(graph.parameterKey(ref, true))) return text;
            const [at, ...rest] = ref.slice(prefix.length).split(".");
            return "{" + prefix + shifted([at, ...rest].join(".")) + "}";
        });
        if (next !== formula) edits.push([s.path, next]);
    }
    for (const { slot, target } of graph.references()) if (target.key.startsWith(prefix) && target.location.kind === "geo" && target.location.id === n.id) {
        const next = prefix + shifted(target.key.slice(prefix.length));
        if (next !== target.key) edits.push([[...slot.path, "ref"], "{" + next + "}"]);
    }
    for (const [address, formula] of edits) writeAt(d, address, formula);
    return { prefix, slots, belongs };
}
function selectedOwner(n: GeoNode | Selection): Selection {
    return "kind" in n ? n : { kind: "geoNode", id: n.id };
}

export function removeCurveNode(d: Design, n: GeoNode | Selection, h: GeoControl) {
    return editCurve(d, selectedOwner(n), h.path, path => {
        if (path.nodes[h.index] && canRemoveNode(path)) removePathNode(path, h.index);
    });
}

export function removeCurveSegment(d: Design, n: GeoNode | Selection, control: GeoControl) {
    return editCurve(d, selectedOwner(n), control.path, path => removePathSegment(path, control.index), { mergeAt: control.index });
}

export function insertCurveNode(d: Design, n: GeoNode | Selection, h: GeoControl) {
    return editCurve(d, selectedOwner(n), h.path, (path, local) => insertPathNode(path, h.index, local(h.point), nodeIds(d)()), { insertAfter: h.index });
}