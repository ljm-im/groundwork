import { readAt, writeAt, type Address } from "../design/address.ts";
import { curveGraph, geometrySlot, isCurveRef, type CurveSlot } from "../design/curveReferences.ts";
import { parameters, slotName } from "../design/parameters.ts";
import { type Curve, type CurveValue, type Design, type Point } from "../design/v5.ts";
import { type Selection } from "./types.ts";

type SlotCurve = { slot: CurveSlot; curve: Curve };
type HeightAddress = { key: string; path: Address };

function heightAddress(slot: CurveSlot, index: number, id: string, referenced = isCurveRef(slot.value)): HeightAddress {
    const suffix = referenced ? ["h", id] : ["nodes", index, "h"];
    return { key: slot.key + "." + suffix.join("."), path: [...slot.path, ...suffix] };
}

function heightEdits(d: Design, graph: ReturnType<typeof curveGraph>, placements: SlotCurve[], next: Curve, referenceChange?: { slot: CurveSlot; attach: boolean; discardHeights: boolean }) {
    const positions = new Map(next.nodes.map((n, i) => [n.id, i]));
    const mapping = new Map<string, HeightAddress | undefined>();
    for (const { slot, curve } of placements) if (slot.height) {
        for (const [i, node] of curve.nodes.entries()) {
            const until = positions.get(node.id);
            const before = heightAddress(slot, i, node.id);
            const after = until === undefined ? undefined : heightAddress(slot, until, node.id, referenceChange?.slot === slot ? referenceChange.attach : undefined);
            if (before.key !== after?.key) mapping.set(before.key, after);
        }
    }
    if (!mapping.size) return [];
    const uses: string[] = [], edits: [Address, string][] = [];
    for (const s of parameters(d, undefined, graph).values()) {
        if (referenceChange?.discardHeights && referenceChange.slot.path.every((part, i) => part === s.path[i])) continue;
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
    if (!slot) return;
    return editCurveSource(d, slot.key, change);
}

export function editCurveSource<T>(d: Design, key: string, change: (curve: Curve, local: (p: Point) => Point) => T) {
    const graph = curveGraph(d), slot = graph.slots.get(key);
    if (!slot) return;
    const source = graph.source(slot), next = structuredClone(source.curve);
    const [x, y] = source.offset, result = change(next, p => x || y ? [p[0] - x, p[1] - y] : p);
    const edits: [Address, string][] = [];
    if (!sameNodes(source.curve, next)) {
        const surviving = new Set(next.nodes.map(n => n.id)), removed = new Set(source.curve.nodes.filter(n => !surviving.has(n.id)).map(n => n.id));
        const aliases = removed.size ? [...graph.slots.values()].filter(s => isCurveRef(s.value) && graph.source(s).slot.key === source.slot.key) : [];
        edits.push(...heightEdits(d, graph, [source.slot, ...aliases].map(slot => ({ slot, curve: source.curve })), next));
        for (const alias of aliases) removeUnusedHeights(alias, surviving);
    }
    writeAt(d, source.slot.path, next);
    for (const [path, value] of edits) writeAt(d, path, value);
    return result;
}

function removeUnusedHeights(slot: CurveSlot, surviving: Set<string>) {
    const { value } = slot;
    if (!isCurveRef(value) || !value.h) return;
    for (const id of Object.keys(value.h)) if (!surviving.has(id)) delete value.h[id];
    if (!Object.keys(value.h).length) delete value.h;
}

export function setCurveReference(d: Design, key: string, target?: string) {
    const graph = curveGraph(d), slot = graph.slots.get(key);
    if (!slot || slot.location.kind !== "geo") return;
    const previous = graph.materialize(slot);
    const wasReference = isCurveRef(slot.value);
    let value: CurveValue, next: Curve;
    if (target) {
        const candidate = graph.slots.get(target);
        if (!candidate || !graph.canUse(slot, candidate)) throw Error("不能引用这条曲线");
        next = graph.source(candidate).curve;
        const ids = new Set(next.nodes.map(node => node.id));
        const heights = isCurveRef(slot.value) && slot.value.h ? Object.entries(slot.value.h).filter(([id]) => ids.has(id)) : [];
        value = { ref: "{" + target + "}", ...(heights.length && { h: Object.fromEntries(heights) }) };
    }
    else {
        if (!isCurveRef(slot.value)) return;
        value = next = previous;
    }
    const aliases = [...graph.slots.values()].filter(s => s !== slot && graph.reaches(s, key));
    const placements = [slot, ...aliases].map(slot => ({ slot, curve: previous }));
    const edits = heightEdits(d, graph, placements, next, { slot, attach: !!target, discardHeights: !!target && !wasReference });
    const surviving = new Set(next.nodes.map(n => n.id));
    for (const alias of aliases) removeUnusedHeights(alias, surviving);
    writeAt(d, slot.path, value);
    for (const [path, formula] of edits) writeAt(d, path, formula);
}