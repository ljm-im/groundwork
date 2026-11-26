import { readAt, writeAt, type Address } from "../design/address.ts";
import { curveGraph, geometrySlot, isCurveRef, isHolderRef, nodeQuantities, nodeQuantityPath, translateCurve, type CurveSlot } from "../design/curveReferences.ts";
import { defaultNodeSlope, slopeEndpointValues } from "../design/functionTable.ts";
import { expressionLookup, parameters, slotName, type Slot } from "../design/parameters.ts";
import { interpolates, lineProfile, needsNodeValue, profileMix, setNodeInterpolation, writeCurveProfile } from "../design/polyline.ts";
import { type Curve, type CurveNode, type Design, type NodeQuantity, type Point } from "../design/v5.ts";
import { type Selection } from "./types.ts";

type Graph = ReturnType<typeof curveGraph>;
type ValueAddress = { key: string; path: Address };
type ProfileEdit = { insertAfter?: number; mergeAt?: number; extendFrom?: number; redraw?: (p: Point) => number };

function valueAddress(slot: CurveSlot, index: number, id: string, q: NodeQuantity, referenced: boolean): ValueAddress {
    const suffix = nodeQuantityPath(index, id, q, referenced);
    return { key: slot.key + "." + suffix.join("."), path: [...slot.path, ...suffix] };
}

function addressEdits(d: Design, graph: Graph, placements: CurveSlot[], previous: Curve, next: Curve,
    change?: { placements: Set<CurveSlot>; referenced: boolean; discard?: Address }) {
    const positions = new Map(next.nodes.map((n, i) => [n.id, i]));
    const mapping = new Map<string, ValueAddress | undefined>();
    for (const slot of placements) if (slot.holder) {
        const referenced = isCurveRef(graph.value(slot));
        const afterRef = change?.placements.has(slot) ? change.referenced : referenced;
        for (const [i, { id }] of previous.nodes.entries()) for (const q of nodeQuantities(slot.holder.kind)) {
            const j = positions.get(id), before = valueAddress(slot, i, id, q, referenced);
            const after = j === undefined ? undefined : valueAddress(slot, j, id, q, afterRef);
            if (before.key !== after?.key) mapping.set(before.key, after);
        }
    }
    function rewrite(formula: string, missing: () => void) {
        return formula.replace(/\{([^{}]+)\}/g, (text, key: string) => {
            if (!mapping.has(key)) return text;
            const after = mapping.get(key);
            if (after) return "{" + after.key + "}";
            missing();
            return text;
        });
    }
    const uses: Slot[] = [], edits: { path: Address; before: string; after: string }[] = [];
    if (mapping.size) for (const s of parameters(d, undefined, graph, true).values()) {
        if (change?.discard?.every((part, i) => part === s.path[i]) || mapping.has(s.key) && !mapping.get(s.key)) continue;
        const before = readAt(d, s.path);
        if (typeof before !== "string") continue;
        let used = false;
        const after = rewrite(before, () => used = true);
        if (used) uses.push(s);
        if (before !== after) edits.push({ path: mapping.get(s.key)?.path ?? s.path, before, after });
    }
    return { uses, edits, rewrite };
}

function requireUnusedNodes(uses: Slot[]) {
    if (uses.length) throw Error("仍被引用：\n" + [...new Set(uses.map(slotName))].join("\n"));
}

function placementsOf(graph: Graph, source: CurveSlot) {
    return [...graph.slots.values()].filter(slot => graph.source(slot).slot === source);
}

export function curveNodeUsers(d: Design, slot: CurveSlot, index: number, graph = curveGraph(d)) {
    const { slot: source, curve } = graph.source(slot);
    const after = { ...curve, nodes: curve.nodes.filter((_, i) => i !== index) };
    return addressEdits(d, graph, placementsOf(graph, source), curve, after).uses;
}

export function seedProfile(curve: Curve, quantities: readonly NodeQuantity[], tolerance: number, ease: boolean, height: (p: Point) => number,
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
    return (slot: CurveSlot, i: number, id: string, q: NodeQuantity) => get(valueAddress(slot, i, id, q, isCurveRef(graph.value(slot))).key) as number;
}

function withoutProfile(node: CurveNode) {
    const copy = { ...node };
    for (const key of ["h", "slope", "interpolate"] as const) delete copy[key];
    return copy;
}

function updateProfile(graph: Graph, slot: CurveSlot, shape: Curve, tolerance: number,
    read: ReturnType<typeof quantityReader>, edit: ProfileEdit, rewrite: (formula: string, missing: () => void) => string) {
    const holder = slot.holder!, previous = graph.materialize(slot), offset = graph.offset(slot);
    const curve = translateCurve({ ...shape, nodes: shape.nodes.map(withoutProfile) }, offset);
    const quantities = nodeQuantities(holder.kind), ease = holder.kind === "line" ? !!graph.holder(holder).value.ease : true;
    const indices = new Map(previous.nodes.map((n, i) => [n.id, i]));
    for (const q of quantities) {
        let profile: ReturnType<typeof lineProfile> | undefined;
        const current = (i: number) => read(slot, i, previous.nodes[i].id, q);
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
                const value = previous.nodes[edit.extendFrom][q]!;
                node[q] = typeof value === "string" ? rewrite(value, () => {}) : value;
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
        return prior === undefined ? 0 : read(slot, prior, previous.nodes[prior].id, q);
    });
    return curve;
}

function sameNodes(a: Curve, b: Curve) {
    return a.closed === b.closed && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => n.id === b.nodes[i].id);
}

export function editCurve<T>(d: Design, selection: Selection, index: number, change: (curve: Curve, local: (p: Point) => Point) => T, edit?: ProfileEdit) {
    const slot = geometrySlot(d, selection.id, index, selection.kind === "curve");
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

    const placements = placementsOf(graph, source.slot);
    const owners = placements.filter(p => p.holder && !isHolderRef(p.holder.value) && nodeQuantities(p.holder.kind).length);
    if (edit.redraw && owners.length) for (const [i, node] of next.nodes.entries()) node.id = source.curve.nodes[i]?.id ?? node.id;
    const { uses, edits, rewrite } = addressEdits(d, graph, placements, source.curve, next);
    requireUnusedNodes(uses);

    if (owners.length) {
        const read = quantityReader(d, graph), tolerance = d.grid.step / 8;
        const profiles = owners.map(owner => [owner, updateProfile(graph, owner, next, tolerance, read, edit, rewrite)] as const);
        for (const [owner, profile] of profiles) {
            const input = graph.value(owner), quantities = nodeQuantities(owner.holder!.kind);
            if (isCurveRef(input)) writeCurveProfile(input, profile, quantities);
            else for (const [i, node] of next.nodes.entries()) {
                const values = profile.nodes[i];
                for (const q of quantities) node[q] = values[q];
                if (values.interpolate) node.interpolate = values.interpolate;
                else delete node.interpolate;
            }
        }
    }

    writeAt(d, source.slot.path, next);
    for (const { path, before, after } of edits) if (readAt(d, path) === before) writeAt(d, path, after);
    return result;
}

export function setCurveOverride(d: Design, key: string, index: number, q: NodeQuantity, override: boolean) {
    const graph = curveGraph(d), slot = graph.slots.get(key);
    if (!slot?.holder) return;
    const owned = graph.ofHolder(graph.holder(slot.holder)), value = graph.value(owned), curve = structuredClone(graph.shape(owned));
    const node = curve.nodes[index];
    if (!node || needsNodeValue(curve, index) || !nodeQuantities(slot.holder.kind).includes(q)) return;
    node[q] ??= quantityReader(d, graph)(owned, index, node.id, q);
    setNodeInterpolation(node, q, !override);
    if (isCurveRef(value)) writeCurveProfile(value, curve, nodeQuantities(slot.holder.kind));
    else writeAt(d, owned.path, curve);
}

export function setCurveReference(d: Design, key: string, target?: string) {
    const graph = curveGraph(d), slot = graph.slots.get(key), holder = slot?.holder;
    if (!slot || !holder) return;
    const owned = graph.holder(holder), previous = graph.source(slot).curve;
    const places = [...graph.slots.values()].filter(s => graph.reaches(s, key));
    const same = new Set(places.filter(s => s === slot || s.holder && graph.holder(s.holder) === owned));
    const quantities = nodeQuantities(holder.kind), oldShape = graph.shape(slot);
    let value: typeof holder.value, next = previous, referenced = isCurveRef(graph.value(slot)), discard: Address | undefined;
    if (target) {
        const other = graph.holders.get(target);
        if (other) {
            if (!graph.canUseHolder(slot, other)) throw Error("不能引用“" + other.label + "”");
            const candidate = graph.ofHolder(other);
            next = graph.source(candidate).curve;
            referenced = isCurveRef(graph.value(candidate));
            value = { ref: "{" + target + "}" };
            discard = holder.path;
        }
        else {
            const candidate = graph.slots.get(target);
            if (!candidate || !graph.canUse(slot, candidate)) throw Error("不能引用这条曲线");
            next = graph.source(candidate).curve;
            const offset = graph.offset(candidate), ref = { ref: "{" + target + "}" }, ease = owned.value.ease;
            value = { curve: ref, ...(offset.some(Boolean) && { offset: [...offset] }), ...(ease && { ease }) };
            referenced = true;
            if (quantities.length) {
                const curve = copyCurveValues(d, graph, slot, oldShape, next, true);
                writeCurveProfile(ref, curve, quantities);
            }
            discard = slot.path;
        }
    }
    else if (isHolderRef(holder.value)) value = structuredClone(owned.value);
    else if (referenced) {
        value = { ...owned.value, curve: oldShape };
        referenced = false;
    }
    else return;
    const { uses, edits, rewrite } = addressEdits(d, graph, places, previous, next, { placements: same, referenced, discard });
    requireUnusedNodes(uses);
    const dependents = places.flatMap(place => {
        if (same.has(place) || !place.holder || isHolderRef(place.holder.value) || !nodeQuantities(place.holder.kind).length) return [];
        const input = graph.value(place);
        return isCurveRef(input) ? [{ input, curve: copyCurveValues(d, graph, place, graph.shape(place), next, false), quantities: nodeQuantities(place.holder.kind) }] : [];
    });
    for (const { input, curve, quantities } of dependents) writeCurveProfile(input, curve, quantities);
    if (!isHolderRef(value) && isCurveRef(value.curve)) for (const q of quantities) {
        const values = value.curve[q];
        for (const [id, formula] of Object.entries(values ?? {})) if (typeof formula === "string")
            values![id] = rewrite(formula, () => {});
    }
    writeAt(d, holder.path, value);
    for (const { path, before, after } of edits) if (readAt(d, path) === before) writeAt(d, path, after);
}

function copyCurveValues(d: Design, graph: Graph, slot: CurveSlot, previous: Curve, shape: Curve, keepEndpoints: boolean) {
    const curve = { ...shape, nodes: shape.nodes.map(withoutProfile) };
    const kind = slot.holder!.kind, quantities = nodeQuantities(kind), read = quantityReader(d, graph);
    const indices = new Map(previous.nodes.map((node, i) => [node.id, i]));
    for (const [i, node] of curve.nodes.entries()) {
        const required = needsNodeValue(curve, i);
        const j = indices.get(node.id) ?? (keepEndpoints && required ? (i === 0 ? 0 : previous.nodes.length - 1) : undefined);
        if (j === undefined) {
            if (keepEndpoints && !required) for (const q of quantities) setNodeInterpolation(node, q, true);
            continue;
        }
        const old = previous.nodes[j];
        for (const q of quantities) {
            const output = interpolates(old, q);
            node[q] = old[q] === undefined || output && required || node.id !== old.id && typeof old[q] === "string"
                ? read(slot, j, old.id, q) : old[q];
            setNodeInterpolation(node, q, output && !required);
        }
    }
    return seedProfile(curve, quantities, d.grid.step / 8, kind !== "line" || !!graph.holder(slot.holder!).value.ease, () => 0,
        (i, q) => {
            const j = indices.get(curve.nodes[i].id);
            return j === undefined ? 0 : read(slot, j, previous.nodes[j].id, q);
        });
}