import { type Address } from "../design/address.ts";
import { curveGraph, geoPointSlots, geometryAt, markPointSlot, pointGeometryId, profileIndex, sectionPointSlot, type CurveSlot } from "../design/curveReferences.ts";
import { neighbor, pathHandle } from "../design/path.ts";
import { type Curve, type Design, type GeoNode, type PlacedGeoNode } from "../design/v5.ts";
import { arcHandle } from "./paths.ts";
import { controlOwner, curveMember, type GeoControl, type GeometryTarget } from "./geoControls.ts";
import { type HolderGroup, type HolderLayer, type PointTarget, type Selection } from "./types.ts";

export { type HolderGroup, type HolderLayer, type PointTarget } from "./types.ts";
type GeometryLayer = { kind: "geometry"; id: string };
export type CurvePartLayer = { kind: "vertex" | "segment"; nodeId: string };
type ChildLayer = HolderLayer | GeometryLayer | CurvePartLayer;
export type SelectionPath = readonly [Selection, ...ChildLayer[]];

export const holderLayer = (group: HolderGroup, index = 0): HolderLayer => ({ kind: "holder", group, index });

export function selectionLayers(path: SelectionPath | null | undefined) {
    const root = path?.[0], second = path?.[1], leaf = path?.at(-1);
    const holder = second?.kind === "holder" ? second : undefined;
    const geometry = root?.kind === "geometry" ? root : (holder ? path?.[2] : second);
    return { root, holder, leaf, geometry: geometry?.kind === "geometry" ? geometry : undefined,
        part: leaf?.kind === "vertex" || leaf?.kind === "segment" ? leaf : undefined };
}

function sameLayer(a: SelectionPath[number], b: SelectionPath[number]) {
    if (a.kind === "holder") return b.kind === a.kind && b.group === a.group && b.index === a.index;
    if (a.kind === "vertex" || a.kind === "segment") return b.kind === a.kind && b.nodeId === a.nodeId;
    return b.kind === a.kind && "id" in a && "id" in b && a.id === b.id;
}

export function commonSelectionLength(a: SelectionPath, b: SelectionPath) {
    const limit = Math.min(a.length, b.length);
    let length = 0;
    while (length < limit && sameLayer(a[length], b[length])) length++;
    return length;
}

export function includesSelection(path: SelectionPath, prefix: SelectionPath) {
    return commonSelectionLength(path, prefix) === prefix.length;
}

export function selectionPrefix(path: SelectionPath, length: number): SelectionPath {
    return path.length <= length ? path : [path[0], ...(path.slice(1, length) as ChildLayer[])];
}

export function geometrySelectionPath(path: SelectionPath): SelectionPath {
    const { part } = selectionLayers(path);
    return part ? selectionPrefix(path, path.length - 1) : path;
}

type TerrainObject = GeoNode | PlacedGeoNode;

export function holderForTarget(n: TerrainObject, { kind, index }: GeometryTarget): HolderLayer | undefined {
    if (kind === "outline") return holderLayer("outlines", index);
    const f = n.function;
    if (kind === "parameter") {
        if (f.type === "mountain") return holderLayer("peaks", index - f.ridges.length);
        if (f.type === "coast") return holderLayer("harbor");
        if (f.type === "slope" && f.kind === "radial") return holderLayer("center");
        return;
    }
    const member = curveMember(f, index);
    if (member) return holderLayer(member.group, member.index);
    if (f.type === "coast" && index === -1) return holderLayer("shore");
}

export function holderTarget(n: TerrainObject, { group, index }: HolderLayer): GeometryTarget | undefined {
    const f = n.function;
    switch (group) {
        case "outlines": return n.construction.type === "outline" && n.construction.outlines[index] ? { kind: "outline", index } : undefined;
        case "ridges":
        case "valleys": return f.type === "mountain" && f[group][index] ? { kind: "curve", index: profileIndex(f, group, index) } : undefined;
        case "lines": return f.type === "slope" && f.kind === "path" && f.lines[index] ? { kind: "curve", index: profileIndex(f, group, index) } : undefined;
        case "peaks": return f.type === "mountain" && f.peaks[index] ? { kind: "parameter", index: f.ridges.length + index } : undefined;
        case "shore": return f.type === "coast" ? { kind: "curve", index: -1 } : undefined;
        case "harbor": return f.type === "coast" ? { kind: "parameter", index: 0 } : undefined;
        case "center": return f.type === "slope" && f.kind === "radial" ? { kind: "parameter", index: 0 } : undefined;
    }
}

function holderAddress({ group, index }: HolderLayer): Address {
    if (group === "outlines") return ["construction", group, index];
    if (group === "shore" || group === "center") return ["function", group];
    if (group === "harbor") return ["function", group, "center"];
    if (group === "peaks") return ["function", group, index, "at"];
    return ["function", group, index];
}

export function pointSlotForSelection(d: Design, { root, holder }: PointTarget) {
    if (root.kind === "mark" && !holder) {
        const index = d.marks.findIndex(mark => mark.id === root.id), mark = d.marks[index];
        if (mark?.follow === "map") return markPointSlot(mark, index);
    }
    if (root.kind === "section" && holder?.group === "endpoints") {
        const index = d.sections.findIndex(section => section.id === root.id), section = d.sections[index];
        if (section?.points[holder.index]) return sectionPointSlot(section, index, holder.index);
    }
    if (root.kind === "geoNode" && holder && (holder.group === "peaks" || holder.group === "harbor" || holder.group === "center")) {
        const index = d.geoNodes.findIndex(node => node.id === root.id), node = d.geoNodes[index];
        if (!node || holderTarget(node, holder)?.kind !== "parameter") return;
        const address = holderAddress(holder);
        return geoPointSlots(node, index).find(slot => address.length === slot.location.path.length &&
            address.every((value, i) => value === slot.location.path[i]));
    }
}

export function selectionPlacement(design: Design, graph: ReturnType<typeof curveGraph>, root: Selection, holder?: HolderLayer) {
    const point = pointSlotForSelection(design, { root, holder })?.value;
    if (point) return { id: pointGeometryId(point), offset: point.offset, point, slot: undefined };
    if (root.kind === "geoNode" && holder) {
        const n = design.geoNodes.find(node => node.id === root.id);
        if (!n || !holderTarget(n, holder)) return;
        const address = holderAddress(holder);
        const property = address[0] === "function" ? address.slice(1) : address;
        const slot = graph.slots.get("geo:" + n.id + "." + property.join(".") + ".curve");
        if (slot) return { id: graph.source(slot).id, offset: graph.offset(slot), slot, point: undefined };
    }
}

export function placementSelection(design: Design, graph: ReturnType<typeof curveGraph>, root: Selection, holder?: HolderLayer): SelectionPath {
    const placement = selectionPlacement(design, graph, root, holder);
    if (!placement) return [root];
    const layer = placement.point && "node" in placement.point ? { kind: "vertex", nodeId: placement.point.node } as const :
        { kind: "geometry", id: placement.id } as const;
    return holder ? [root, holder, layer] : [root, layer];
}

export function existsSelection(design: Design, root: Selection) {
    switch (root.kind) {
        case "geoNode": return design.geoNodes.some(n => n.id === root.id);
        case "section": return design.sections.some(s => s.id === root.id);
        case "mark": return design.marks.some(m => m.id === root.id);
        case "input": return Object.hasOwn(design.inputs, root.id);
        case "field": return Object.hasOwn(design.fields, root.id);
        case "geometry": return Object.hasOwn(design.geometry, root.id);
    }
}

export function validSelection(design: Design, graph: ReturnType<typeof curveGraph>, path: SelectionPath | null): SelectionPath | null {
    const { root, holder, geometry, part } = selectionLayers(path);
    if (!path || !root || !existsSelection(design, root)) return null;
    const placement = root.kind !== "geometry" && (holder || geometry || part) ? selectionPlacement(design, graph, root, holder) : undefined;
    if (holder && !placement) return selectionPrefix(path, 1);
    if (!geometry) {
        if (!part) return path;
        return part.kind === "vertex" && placement?.point && "node" in placement.point && placement.point.node === part.nodeId &&
            "curve" in (geometryAt(design, placement.id) ?? {}) ? path : geometrySelectionPath(path);
    }
    const item = geometryAt(design, geometry.id);
    if (!item || root.kind !== "geometry" && placement?.id !== geometry.id)
        return selectionPrefix(path, holder ? 2 : 1);
    if (part && (!("curve" in item) || !partControl(item.curve, part, -1))) return geometrySelectionPath(path);
    return path;
}

export function partControl(curve: Curve, part: CurvePartLayer, path: number, role: GeoControl["role"] = part.kind): GeoControl | undefined {
    const index = curve.nodes.findIndex(node => node.id === part.nodeId);
    if (index < 0) return;
    const { p, bulge } = curve.nodes[index], next = neighbor(curve, index, 1);
    if (part.kind === "segment" && next === undefined) return;
    let point = p;
    if (role === "in" || role === "out") point = pathHandle(curve, index, role);
    if (role === "arc" && next !== undefined && bulge !== undefined) point = arcHandle(p, curve.nodes[next].p, bulge);
    return { role, path, index, point };
}

export function withCurvePart(path: SelectionPath, curve: Curve, control: GeoControl): SelectionPath {
    const { role, index } = controlOwner(control)!;
    if (role !== "vertex" && role !== "segment") return path;
    const node = curve.nodes[index];
    return node ? [...geometrySelectionPath(path), { kind: role, nodeId: node.id }] : path;
}

export function placementRedrawLabel(slot: CurveSlot) {
    switch (slot.holder?.kind) {
        case "outline": return "轮廓";
        case "shore": return "海岸线";
        case "ridge": return "山脊线";
        case "valley": return "山谷线";
        case "line": return "坡线";
        default: return "曲线";
    }
}