import { readAt, writeAt, type Address } from "../design/address.ts";
import { curveGraph, geometrySlot, geometryUsers, isHolderRef, nodeQuantities, nodeQuantityPath, refKey, translateCurve, type CurveSlot, type PointSlot } from "../design/curveReferences.ts";
import { quotedLocation } from "../design/problems.ts";
import { references } from "../design/expression.ts";
import { defaultNodeSlope, slopeEndpointValues } from "../design/functionTable.ts";
import { expressionLookup, parameters, slotName, type Slot } from "../design/parameters.ts";
import { interpolates, lineProfile, needsNodeValue, profileMix, setNodeInterpolation, writeCurveProfile } from "../design/polyline.ts";
import { type Curve, type Design, type NodeQuantity, type Point, type ProfileCurve } from "../design/v5.ts";
import { copyGeometry } from "./geoNodes.ts";
import { type Selection } from "./types.ts";

type Graph = ReturnType<typeof curveGraph>;
type ProfileEdit = { insertAfter?: number; mergeAt?: number; extendFrom?: number; redraw?: (p: Point) => number };

function valueKey(slot: CurveSlot, id: string, q: NodeQuantity) {
    return slot.holder!.key + "." + nodeQuantityPath(id, q).join(".");
}

function removedNodes(before: Curve, after: Curve) {
    const surviving = new Set(after.nodes.map(n => n.id));
    return before.nodes.flatMap(n => surviving.has(n.id) ? [] : [n.id]);
}

function nodeRemovalUsers(d: Design, graph: Graph, placements: CurveSlot[], ids: string[], path?: Address) {
    if (!ids.length || !placements.length) return [];
    const dropped = new Set(placements.flatMap(slot => slot.holder ? ids.flatMap(id =>
        nodeQuantities(slot.holder!.kind).map(q => valueKey(slot, id, q))) : []));
    if (!dropped.size) return [];
    return [...parameters(d, undefined, graph, true).values()].filter(slot => {
        if (dropped.has(slot.key) || path?.every((part, i) => part === slot.path[i])) return false;
        const formula = readAt(d, slot.path);
        return typeof formula === "string" && references(formula).some(ref => dropped.has(ref));
    });
}

function requireUnusedNodes(uses: Slot[]) {
    if (uses.length) throw Error("仍被引用：\n" + [...new Set(uses.map(slotName))].join("\n"));
}

export function curveNodePointUsers(d: Design, id: string, ids?: readonly string[]) {
    if (ids?.length === 0) return [];
    return (geometryUsers(d).get(id) ?? []).filter((slot): slot is PointSlot =>
        !("kind" in slot) && "node" in slot.value && (!ids || ids.includes(slot.value.node)));
}

export function curveNodeUsers(d: Design, slot: CurveSlot, index: number, graph = curveGraph(d)) {
    const { id, curve } = graph.source(slot), ids = [curve.nodes[index].id];
    return { parameters: nodeRemovalUsers(d, graph, graph.curvePlacements(id).map(graph.ofHolder), ids), points: curveNodePointUsers(d, id, ids) };
}

export function seedProfile(curve: ProfileCurve, quantities: readonly NodeQuantity[], tolerance: number, ease: boolean, height: (p: Point) => number,
    numberAt?: (i: number, q: NodeQuantity) => number) {
    const slopeLine = quantities.length === 1;
    for (const q of quantities) {
        for (const [i, node] of curve.nodes.entries()) {
            if (node[q] !== undefined || node.interpolate?.includes(q)) continue;
            if (q === "h" && !slopeLine) node.h = height(node.p);
            else if (needsNodeValue(curve, i))
                node[q] = q === "slope" ? defaultNodeSlope : slopeEndpointValues[+(i !== 0)];
            else setNodeInterpolation(node, q, true);
        }
        const profile = lineProfile(curve, tolerance, q);
        for (const [i, node] of curve.nodes.entries()) if (node[q] === undefined) {
            const span = profile.span(profile.nodeStation(i), ease);
            if (!span) node[q] = q === "slope" ? defaultNodeSlope : 0;
            else {
                const value = ({ index, value }: typeof span.a) => typeof value === "number" ? value : numberAt?.(index, q) ?? 0;
                node[q] = span.a === span.b ? value(span.a) : profileMix(value(span.a), value(span.b), span.t);
            }
        }
    }
    return curve;
}

function quantityReader(d: Design, graph: Graph) {
    const slots = parameters(d, undefined, graph, true);
    const get = expressionLookup(d, key => slots.get(key), undefined, key => graph.parameterKey(key, true));
    return (slot: CurveSlot, id: string, q: NodeQuantity) => get(valueKey(slot, id, q)) as number;
}

function updateProfile(graph: Graph, slot: CurveSlot, shape: Curve, tolerance: number,
    read: ReturnType<typeof quantityReader>, edit: ProfileEdit) {
    const holder = slot.holder!, previous = graph.materialize(slot), offset = graph.offset(slot);
    const curve: ProfileCurve = translateCurve(structuredClone(shape), offset);
    const quantities = nodeQuantities(holder.kind), ease = holder.kind === "line" ? !!graph.holder(holder).value.ease : true;
    const indices = new Map(previous.nodes.map((n, i) => [n.id, i]));
    for (const q of quantities) {
        let profile: ReturnType<typeof lineProfile> | undefined;
        const current = (i: number) => read(slot, previous.nodes[i].id, q);
        const insertedValue = (i: number, point: Point) => {
            profile ??= lineProfile(previous, tolerance, q);
            const s = profile.stationOnSegment(i, point), span = profile.span(s, ease)!;
            return profileMix(current(span.a.index), current(span.b.index), span.t);
        };
        for (const [i, node] of curve.nodes.entries()) {
            const j = indices.get(node.id), required = needsNodeValue(curve, i);
            const prev = j === undefined ? undefined : previous.nodes[j];
            if (prev && j !== undefined) {
                const interpolate = interpolates(prev, q);
                node[q] = interpolate && required || prev[q] === undefined ? current(j) : prev[q];
                setNodeInterpolation(node, q, interpolate && !required);
                if (edit.mergeAt === j && previous.closed) {
                    const k = (j + 1) % previous.nodes.length;
                    node[q] = current(j) / 2 + current(k) / 2;
                    setNodeInterpolation(node, q, !required && interpolate && interpolates(previous.nodes[k], q));
                }
            }
            else if (edit.extendFrom !== undefined && required) {
                node[q] = previous.nodes[edit.extendFrom][q]!;
            }
            else if (edit.insertAfter !== undefined) {
                node[q] = insertedValue(edit.insertAfter, node.p);
                setNodeInterpolation(node, q, !required);
            }
            else if (edit.extendFrom !== undefined) setNodeInterpolation(node, q, true);
        }
    }
    seedProfile(curve, quantities, tolerance, ease, edit.redraw ?? (() => 0), (i, q) => {
        const prior = indices.get(curve.nodes[i].id) ?? edit.extendFrom;
        return prior === undefined ? 0 : read(slot, previous.nodes[prior].id, q);
    });
    return curve;
}

function sameNodes(a: Curve, b: Curve) {
    return a.closed === b.closed && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => n.id === b.nodes[i].id);
}

export function editCurve<T>(d: Design, selection: Selection, index: number, change: (curve: Curve, local: (p: Point) => Point) => T, edit?: ProfileEdit) {
    const slot = geometrySlot(d, selection.id, index, selection.kind === "geometry");
    if (slot) return editCurveSource(d, slot.key, change, edit);
}

export function localPoint([x, y]: Point, p: Point): Point {
    return x || y ? [p[0] - x, p[1] - y] : p;
}

export function editCurveSource<T>(d: Design, key: string, change: (curve: Curve, local: (p: Point) => Point) => T, edit: ProfileEdit = {}) {
    const graph = curveGraph(d), slot = graph.slots.get(key);
    if (!slot) return;
    const source = graph.source(slot), offset = graph.offset(slot), next = structuredClone(source.curve);
    const result = change(next, p => localPoint(offset, p));
    if (!next.closed && source.curve.closed && graph.needsClosed(source.slot)) throw Error("需要闭合曲线");
    if (sameNodes(source.curve, next) && !edit.redraw) {
        writeAt(d, source.slot.path, next);
        return result;
    }

    const placements = graph.curvePlacements(source.id).map(graph.ofHolder);
    const owners = placements.filter(p => p.holder && !isHolderRef(p.holder.value) && nodeQuantities(p.holder.kind).length);
    const points = curveNodePointUsers(d, source.id, edit.redraw ? undefined : removedNodes(source.curve, next));
    if (points.length) throw Error("仍被引用：\n" + points.map(slot => quotedLocation(slot.name, slot.label)).join("\n"));
    if (edit.redraw && owners.length) for (const [i, node] of next.nodes.entries()) node.id = source.curve.nodes[i]?.id ?? node.id;
    requireUnusedNodes(nodeRemovalUsers(d, graph, placements, removedNodes(source.curve, next)));

    if (owners.length) {
        const read = quantityReader(d, graph), tolerance = d.grid.step / 8;
        const profiles = owners.map(owner => [owner, updateProfile(graph, owner, next, tolerance, read, edit)] as const);
        for (const [owner, profile] of profiles) {
            const holder = graph.holder(owner.holder!);
            writeCurveProfile(holder.value, profile, nodeQuantities(holder.kind));
        }
    }

    writeAt(d, source.slot.path, next);
    return result;
}

export function setCurveOverride(d: Design, key: string, index: number, q: NodeQuantity, override: boolean) {
    const graph = curveGraph(d), slot = graph.slots.get(key);
    if (!slot?.holder) return;
    const holder = graph.holder(slot.holder), owned = graph.ofHolder(holder), curve = graph.shape(owned);
    const node = curve.nodes[index];
    if (!node || needsNodeValue(curve, index) || !nodeQuantities(slot.holder.kind).includes(q)) return;
    node[q] ??= quantityReader(d, graph)(owned, node.id, q);
    setNodeInterpolation(node, q, !override);
    writeCurveProfile(holder.value, curve, nodeQuantities(holder.kind));
}

export function setCurveReference(d: Design, key: string, target?: string) {
    const graph = curveGraph(d), slot = graph.slots.get(key), holder = slot?.holder;
    if (!slot || !holder) return;
    const owned = graph.holder(holder), previous = graph.source(slot), quantities = nodeQuantities(holder.kind);
    if (!target) {
        if (!graph.canUnlink(slot)) return;
        writeAt(d, holder.path, { ...structuredClone(owned.value), curve: copyGeometry(d, previous.id) });
        return;
    }

    // Other holders sharing the shape stay as they are. References to this
    // semantic holder follow its new curve and must retain all referenced nodes.
    const places = graph.holderPlacements(holder).filter(candidate => {
        for (let item = candidate; ; ) {
            if (item.key === holder.key) return true;
            if (!isHolderRef(item.value)) return false;
            item = graph.holders.get(refKey(item.value.ref)!)!;
        }
    }).map(graph.ofHolder);
    const same = graph.holders.get(target);
    if (same) {
        if (!graph.canUseHolder(slot, same)) throw Error("不能引用“" + same.label + "”");
        const next = graph.source(graph.ofHolder(same)).curve;
        requireUnusedNodes(nodeRemovalUsers(d, graph, places, removedNodes(previous.curve, next), holder.path));
        writeAt(d, holder.path, { ref: "{" + target + "}" });
        return;
    }

    const candidate = graph.slots.get(target);
    if (!candidate || candidate.holder || !graph.canUse(slot, candidate)) throw Error("不能引用这条曲线");
    if (previous.id === candidate.id && !isHolderRef(holder.value)) return;
    const { curve: next } = graph.source(candidate);
    requireUnusedNodes(nodeRemovalUsers(d, graph, places, removedNodes(previous.curve, next)));
    const value = { ...structuredClone(owned.value), curve: candidate.id };
    if (quantities.length) writeCurveProfile(value, copyCurveValues(d, graph, slot, graph.shape(slot), next), quantities);
    writeAt(d, holder.path, value);
}

function copyCurveValues(d: Design, graph: Graph, slot: CurveSlot, previous: ProfileCurve, shape: Curve) {
    const curve: ProfileCurve = structuredClone(shape);
    const kind = slot.holder!.kind, quantities = nodeQuantities(kind), read = quantityReader(d, graph);
    const indices = new Map(previous.nodes.map((node, i) => [node.id, i]));
    for (const [i, node] of curve.nodes.entries()) {
        const required = needsNodeValue(curve, i);
        const j = indices.get(node.id) ?? (required ? (i === 0 ? 0 : previous.nodes.length - 1) : undefined);
        if (j === undefined) {
            for (const q of quantities) setNodeInterpolation(node, q, true);
            continue;
        }
        const old = previous.nodes[j];
        for (const q of quantities) {
            const output = interpolates(old, q);
            node[q] = old[q] === undefined || output && required || node.id !== old.id && typeof old[q] === "string"
                ? read(slot, old.id, q) : old[q];
            setNodeInterpolation(node, q, output && !required);
        }
    }
    return seedProfile(curve, quantities, d.grid.step / 8, kind !== "line" || !!graph.holder(slot.holder!).value.ease, () => 0,
        (i, q) => {
            const j = indices.get(curve.nodes[i].id);
            return j === undefined ? 0 : read(slot, previous.nodes[j].id, q);
        });
}