import { readAt, writeAt, type Address } from "../design/address.ts";
import { curveGraph, geometrySlot, isCurveRef, isHolderRef, type CurveSlot } from "../design/curveReferences.ts";
import { parameters, slotName } from "../design/parameters.ts";
import { type Curve, type Design, type Point } from "../design/v5.ts";
import { type Selection } from "./types.ts";

type HeightAddress = { key: string; path: Address };

function heightAddress(slot: CurveSlot, index: number, id: string, referenced: boolean): HeightAddress {
    const suffix = referenced ? ["h", id] : ["nodes", index, "h"];
    return { key: slot.key + "." + suffix.join("."), path: [...slot.path, ...suffix] };
}

function heightEdits(d: Design, graph: ReturnType<typeof curveGraph>, placements: CurveSlot[], previous: Curve, next: Curve,
    change?: { placements: Set<CurveSlot>; referenced: boolean; discard?: Address }) {
    const positions = new Map(next.nodes.map((n, i) => [n.id, i]));
    const mapping = new Map<string, HeightAddress | undefined>();
    for (const slot of placements) if (slot.height) {
        const referenced = isCurveRef(graph.value(slot));
        for (const [i, node] of previous.nodes.entries()) {
            const until = positions.get(node.id);
            const before = heightAddress(slot, i, node.id, referenced);
            const after = until === undefined ? undefined : heightAddress(slot, until, node.id, change?.placements.has(slot) ? change.referenced : referenced);
            if (before.key !== after?.key) mapping.set(before.key, after);
        }
    }
    if (!mapping.size) return [];
    const uses: string[] = [], edits: [Address, string][] = [];
    for (const s of parameters(d, undefined, graph).values()) {
        if (change?.discard?.every((part, i) => part === s.path[i])) continue;
        if (mapping.has(s.key) && !mapping.get(s.key)) continue;
        const formula = readAt(d, s.path);
        if (typeof formula !== "string") continue;
        const rewritten = formula.replace(/\{([^{}]+)\}/g, (text, key: string) => {
            if (!mapping.has(key)) return text;
            const after = mapping.get(key);
            if (!after) {
                uses.push(slotName(s));
                return text;
            }
            return "{" + after.key + "}";
        });
        if (formula !== rewritten) edits.push([mapping.get(s.key)?.path ?? s.path, rewritten]);
    }
    if (uses.length) throw Error("仍被引用：\n" + [...new Set(uses)].join("\n"));
    return edits;
}

function sameNodes(a: Curve, b: Curve) {
    return a.nodes.length === b.nodes.length && a.nodes.every((n, i) => n.id === b.nodes[i].id);
}

export function editCurve<T>(d: Design, selection: Selection, index: number, change: (curve: Curve, local: (p: Point) => Point) => T) {
    const slot = geometrySlot(d, selection.id, index, selection.kind === "curve");
    if (slot) return editCurveSource(d, slot.key, change);
}

export function localPoint([x, y]: Point, p: Point): Point {
    return x || y ? [p[0] - x, p[1] - y] : p;
}

export function editCurveSource<T>(d: Design, key: string, change: (curve: Curve, local: (p: Point) => Point) => T) {
    const graph = curveGraph(d), slot = graph.slots.get(key);
    if (!slot) return;
    const source = graph.source(slot), offset = graph.offset(slot), next = structuredClone(source.curve);
    const result = change(next, p => localPoint(offset, p));
    if (!next.closed && source.curve.closed && graph.needsClosed(source.slot)) throw Error("需要闭合曲线");
    const edits: [Address, string][] = [];
    if (!sameNodes(source.curve, next)) {
        const surviving = new Set(next.nodes.map(n => n.id));
        const placements = [...graph.slots.values()].filter(s => graph.source(s).slot === source.slot);
        edits.push(...heightEdits(d, graph, placements, source.curve, next));
        for (const placement of placements) removeUnusedHeights(placement, surviving);
    }
    writeAt(d, source.slot.path, next);
    for (const [path, value] of edits) writeAt(d, path, value);
    return result;
}

function removeUnusedHeights(slot: CurveSlot, surviving: Set<string>) {
    const holder = slot.holder?.value;
    if (!holder || isHolderRef(holder) || !isCurveRef(holder.curve) || !holder.curve.h) return;
    const value = holder.curve;
    for (const id of Object.keys(value.h!)) if (!surviving.has(id)) delete value.h![id];
    if (!Object.keys(value.h!).length) delete value.h;
}

export function setCurveReference(d: Design, key: string, target?: string) {
    const graph = curveGraph(d), slot = graph.slots.get(key), holder = slot?.holder;
    if (!slot || !holder) return;
    const owned = graph.holder(holder), previous = graph.source(slot).curve;
    let value: typeof holder.value, next = previous, referenced = isCurveRef(graph.value(slot)), discard: Address | undefined;
    if (target) {
        const same = graph.holders.get(target);
        if (same) {
            if (!graph.canUseHolder(slot, same)) throw Error("不能引用“" + same.label + "”");
            const candidate = graph.ofHolder(same);
            next = graph.source(candidate).curve;
            referenced = isCurveRef(graph.value(candidate));
            value = { ref: "{" + target + "}" };
            discard = holder.path;
        }
        else {
            const candidate = graph.slots.get(target);
            if (!candidate || !graph.canUse(slot, candidate)) throw Error("不能引用这条曲线");
            next = graph.source(candidate).curve;
            referenced = true;
            const offset = graph.offset(candidate);
            value = { curve: { ref: "{" + target + "}" }, ...(offset.some(Boolean) && { offset: [...offset] }),
                ...(holder.kind === "ridge" && { slope: owned.value.slope }) };
            discard = slot.path;
        }
    }
    else if (isHolderRef(holder.value)) value = structuredClone(owned.value);
    else if (referenced) {
        value = { ...owned.value, curve: graph.shape(slot) };
        referenced = false;
    }
    else return;
    const placements = [...graph.slots.values()].filter(s => graph.reaches(s, key));
    const same = new Set(placements.filter(s => s.holder && graph.holder(s.holder) === owned));
    const edits = heightEdits(d, graph, placements, previous, next, { placements: same, referenced, discard });
    const surviving = new Set(next.nodes.map(n => n.id));
    for (const placement of placements) if (!same.has(placement)) removeUnusedHeights(placement, surviving);
    writeAt(d, holder.path, value);
    for (const [path, formula] of edits) writeAt(d, path, formula);
}