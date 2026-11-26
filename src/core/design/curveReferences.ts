import { type Address } from "./address.ts";
import { check, quotedLocation, type Location } from "./problems.ts";
import { type Curve, type CurveHolder, type CurveRef, type CurveValue, type Design, type Expression, type GeoNode, type Held, type HolderRef, type Point } from "./v5.ts";

const holderLabels = { outline: "轮廓", ridge: "山脊", shore: "海岸线", line: "坡线" } as const;
type HolderKind = keyof typeof holderLabels;
type HolderValue = Held<CurveValue, { slope?: Expression }>;

interface ReferenceSlot {
    key: string;
    name: string;
    label?: string;
    path: Address;
    location: Location;
}
export interface HolderSlot extends ReferenceSlot {
    kind: HolderKind;
    location: { kind: "geo"; id: string; index: number; path: Address };
    value: HolderValue;
}
type OwnedSlot = HolderSlot & { value: CurveHolder<CurveValue, { slope?: Expression }> };
export type CurveSlot = ReferenceSlot & { closed: boolean; height: boolean } &
    ({ holder: HolderSlot } | { holder?: undefined; value: Curve<never> });

export const isHolderRef = (value: HolderValue): value is HolderRef => "ref" in value;
export const isCurveRef = <N>(value: Curve<N> | CurveRef<N>): value is CurveRef<N> => "ref" in value;
export const curveKey = (id: string) => "curve:" + id;
export const refKey = (ref: string) => /^\{((?:curve|geo):[^{}]+)\}$/.exec(ref)?.[1];
export const curveSlotName = (slot: ReferenceSlot) => slot.label ? slot.name + "." + slot.label : slot.name;
export const holderLabel = (slot: HolderSlot) => holderLabels[slot.kind];
const quotedSlot = (slot: ReferenceSlot) => quotedLocation(slot.name, slot.label);

export function curveParameterName(path: Address) {
    const [group, name, index] = path;
    const curve = path.at(-1) === "curve";
    const holder = curve ? path.slice(0, -1) : path;
    let label: string | undefined;
    if (group === "construction" && name === "outlines" && typeof index === "number" && holder.length === 3)
        label = "轮廓 " + (index + 1);
    if (group === "function") {
        if ((name === "line" || name === "shore") && holder.length === 2) label = holderLabels[name];
        if (name === "ridges" && typeof index === "number" && holder.length === 3) label = "山脊 " + (index + 1);
    }
    return label && (curve ? label + (name === "ridges" ? ".山脊线" : ".曲线") : label);
}

export function geoHolderSlots(n: GeoNode, index: number): HolderSlot[] {
    const slots: HolderSlot[] = [], c = n.construction, f = n.function;
    function add(kind: HolderKind, path: Address, value: HolderValue) {
        const property = path[0] === "function" ? path.slice(1) : path;
        slots.push({ kind, key: "geo:" + n.id + "." + property.join("."), name: n.label, label: curveParameterName(path),
            path: ["geoNodes", index, ...path], location: { kind: "geo", id: n.id, index, path }, value });
    }
    if (c?.type === "outline") c.outlines.forEach((value, i) => add("outline", ["construction", "outlines", i], value));
    if (f?.type === "coast") add("shore", ["function", "shore"], f.shore);
    if (f?.type === "mountain") f.ridges?.forEach((value, i) => add("ridge", ["function", "ridges", i], value));
    if (f?.type === "slope" && f.kind === "path") add("line", ["function", "line"], f.line);
    return slots;
}

function heldCurveSlot(holder: HolderSlot): CurveSlot {
    const path = [...holder.location.path, "curve"], closed = holder.kind === "outline" || holder.kind === "shore";
    return { holder, key: holder.key + ".curve", name: holder.name, label: curveParameterName(path), path: [...holder.path, "curve"],
        location: { ...holder.location, path }, closed, height: !closed };
}

export function sharedCurveSlot(d: Design, id: string): CurveSlot | undefined {
    if (!d.curves || !Object.hasOwn(d.curves, id)) return;
    const { label, curve } = d.curves[id];
    return { key: curveKey(id), name: label, path: ["curves", id, "curve"],
        location: { kind: "curve", id, path: ["curve"] }, value: curve, closed: false, height: false };
}

export function geometrySlot(d: Design, id: string, index: number, shared = false): CurveSlot | undefined {
    if (shared) return sharedCurveSlot(d, id);
    const at = d.geoNodes.findIndex(n => n.id === id);
    if (at < 0) return;
    const holder = geoHolderSlots(d.geoNodes[at], at).find(slot => geometryIndex(slot) === index);
    return holder && heldCurveSlot(holder);
}

export function geometryIndex(slot: HolderSlot | CurveSlot) {
    const { path } = slot.location;
    if (path[0] === "construction") return Number(path[2]);
    if (path[1] === "ridges") return -1 - Number(path[2]);
    return -1;
}

export function resolvedCurvePath(slot: CurveSlot): Address {
    return slot.holder && slot.holder.kind !== "ridge" ? slot.holder.path : slot.path;
}

export const referenceAt = (slot: ReferenceSlot) => ({ ...slot.location, path: [...slot.location.path, "ref"] });

export function translateCurve(curve: Curve, [x, y]: Point): Curve {
    return x || y ? { ...curve, nodes: curve.nodes.map(n => ({ ...n, p: [x ? n.p[0] + x : n.p[0], y ? n.p[1] + y : n.p[1]] })) } : curve;
}

export function curveGraph(d: Design) {
    const slots = new Map<string, CurveSlot>(), holders = new Map<string, HolderSlot>();
    for (const id of Object.keys(d.curves ?? {})) slots.set(curveKey(id), sharedCurveSlot(d, id)!);
    d.geoNodes.forEach((n, index) => {
        for (const holder of geoHolderSlots(n, index)) {
            const slot = heldCurveSlot(holder);
            holders.set(holder.key, holder);
            slots.set(slot.key, slot);
        }
    });
    const owned = new Map<string, OwnedSlot>(), holderStack: HolderSlot[] = [];
    const sources = new Map<string, { slot: CurveSlot; curve: Curve }>(), curveStack: CurveSlot[] = [];
    const ofHolder = (slot: HolderSlot) => slots.get(slot.key + ".curve")!;
    function holderTarget(slot: HolderSlot) {
        if (!isHolderRef(slot.value)) return;
        const { ref } = slot.value, key = refKey(ref) ?? "", target = holders.get(key), at = referenceAt(slot);
        check(!slots.has(key), "无效", at);
        check(target, "找不到" + holderLabel(slot) + "“" + ref + "”", at);
        check(slot.kind === target.kind, "只能引用同类" + holderLabel(slot), at);
        return target;
    }
    function visit<S extends ReferenceSlot, T>(slot: S, stack: S[], resolve: () => T): T {
        const cycle = stack.indexOf(slot);
        check(cycle < 0, "引用成环：" + [...stack.slice(cycle), slot].map(quotedSlot).join(" → "), referenceAt(slot));
        stack.push(slot);
        try {
            return resolve();
        }
        finally {
            stack.pop();
        }
    }
    function holder(slot: HolderSlot): OwnedSlot {
        slot = holders.get(slot.key)!;
        const known = owned.get(slot.key);
        if (known) return known;
        const target = holderTarget(slot);
        const result = target ? visit(slot, holderStack, () => holder(target)) : slot as OwnedSlot;
        owned.set(slot.key, result);
        return result;
    }
    const value = (slot: CurveSlot) => slot.holder ? holder(slot.holder).value.curve : slot.value;
    const offset = (slot: CurveSlot): Point => slot.holder ? holder(slot.holder).value.offset ?? [0, 0] : [0, 0];
    function curveTarget(slot: CurveSlot) {
        if (!slot.holder) return;
        const alias = holderTarget(slot.holder);
        if (alias) return ofHolder(alias);
        const curve = value(slot);
        if (!isCurveRef(curve)) return;
        const key = refKey(curve.ref) ?? "", target = slots.get(key), at = referenceAt(slot);
        check(!holders.has(key), "需要引用曲线", at);
        check(target, "找不到曲线“" + curve.ref + "”", at);
        return target;
    }
    function source(slot: CurveSlot): { slot: CurveSlot; curve: Curve } {
        slot = slots.get(slot.key)!;
        const known = sources.get(slot.key);
        if (known) return known;
        const target = curveTarget(slot);
        const result = target ? visit(slot, curveStack, () => source(target)) : { slot, curve: value(slot) as Curve };
        check(!slot.closed || result.curve.closed, "需要闭合曲线", referenceAt(slot));
        const curve = value(slot);
        if (isCurveRef(curve) && curve.h && slot.holder && !isHolderRef(slot.holder.value)) {
            const ids = new Set(result.curve.nodes.map(n => n.id));
            for (const id of Object.keys(curve.h)) check(ids.has(id), "找不到节点“" + id + "”", { ...slot.location, path: [...slot.location.path, "h", id] });
        }
        sources.set(slot.key, result);
        return result;
    }
    function shape(slot: CurveSlot): Curve {
        const { curve } = source(slot), input = value(slot);
        if (!isCurveRef(input)) return slot.holder && isHolderRef(slot.holder.value) ? structuredClone(curve) : curve;
        const copy = structuredClone(curve);
        for (const n of copy.nodes) {
            if (input.h && Object.hasOwn(input.h, n.id)) n.h = input.h[n.id];
            else delete n.h;
        }
        return copy;
    }
    const materialize = (slot: CurveSlot) => translateCurve(shape(slot), offset(slot));

    function reaches(candidate: CurveSlot, key: string) {
        const seen = new Set<string>();
        for (let slot: CurveSlot | undefined = candidate; slot; slot = curveTarget(slot)) {
            if (slot.key === key) return true;
            if (seen.has(slot.key)) return false;
            seen.add(slot.key);
        }
        return false;
    }
    const closedRequirements = new Map<string, boolean>();
    function needsClosed(slot: CurveSlot) {
        const known = closedRequirements.get(slot.key);
        if (known !== undefined) return known;
        const required = slot.closed || [...slots.values()].some(candidate => candidate.closed && reaches(candidate, slot.key));
        closedRequirements.set(slot.key, required);
        return required;
    }
    function canUse(from: CurveSlot, candidate: CurveSlot) {
        return !reaches(candidate, from.key) && (!needsClosed(from) || source(candidate).curve.closed);
    }
    function canUseHolder(from: CurveSlot, candidate: HolderSlot) {
        return from.holder?.kind === candidate.kind && canUse(from, ofHolder(candidate));
    }
    let placements: Map<string, HolderSlot[]> | undefined;
    function holderPlacements(slot: HolderSlot) {
        if (!placements) {
            placements = new Map();
            for (const item of holders.values()) {
                const key = holder(item).key, items = placements.get(key);
                if (items) items.push(item);
                else placements.set(key, [item]);
            }
        }
        return placements.get(holder(slot).key)!;
    }
    function parameterKey(key: string) {
        if (!key.startsWith("geo:")) return key;
        for (let i = key.lastIndexOf("."); i !== -1; i = key.lastIndexOf(".", i - 1)) {
            const slot = holders.get(key.slice(0, i));
            if (slot) return holder(slot).key + key.slice(i);
        }
        return key;
    }
    function* references() {
        for (const slot of holders.values()) {
            const target = holderTarget(slot);
            if (target) yield { slot, target };
        }
        for (const slot of slots.values()) {
            if (!slot.holder || isHolderRef(slot.holder.value)) continue;
            const target = curveTarget(slot);
            if (target) yield { slot, target };
        }
    }
    return { slots, holders, holder, ofHolder, value, offset, source, shape, materialize, canUse, canUseHolder, reaches, needsClosed,
        holderPlacements, parameterKey, references };
}