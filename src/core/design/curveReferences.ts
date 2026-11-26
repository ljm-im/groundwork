import { type Address } from "./address.ts";
import { check, quotedLocation, type Location } from "./problems.ts";
import { type Curve, type CurveRef, type CurveValue, type Design, type GeoNode, type Point } from "./v5.ts";

export interface CurveSlot {
    key: string;
    name: string;
    label?: string;
    path: Address;
    location: Location;
    value: CurveValue;
    closed: boolean;
    height: boolean;
}

export const isCurveRef = <N>(value: Curve<N> | CurveRef<N>): value is CurveRef<N> => Object.hasOwn(value, "ref");
export const curveKey = (id: string) => "curve:" + id;
export const refKey = (ref: string) => /^\{((?:curve|geo):[^{}]+)\}$/.exec(ref)?.[1];
export const curveSlotName = (slot: CurveSlot) => slot.label ? slot.name + "." + slot.label : slot.name;
const quotedSlot = (slot: CurveSlot) => quotedLocation(slot.name, slot.label);

export function curveParameterName(path: Address) {
    const [group, name, index, property] = path;
    if (group === "construction" && name === "outlines" && typeof index === "number" && path.length === 3)
        return "轮廓 " + (index + 1);
    if (group !== "function") return;
    if (name === "line" && path.length === 2) return "坡线";
    if (name === "shore" && path.length === 2) return "海岸线";
    if (name === "ridges" && typeof index === "number" && property === "line" && path.length === 4)
        return "山脊 " + (index + 1) + " 山脊线";
}

export function geoCurveSlots(n: GeoNode, index: number): CurveSlot[] {
    const slots: CurveSlot[] = [], c = n.construction, f = n.function;
    function add(path: Address, value: CurveValue, closed: boolean) {
        const property = path[0] === "function" ? path.slice(1) : path;
        slots.push({ key: "geo:" + n.id + "." + property.join("."), name: n.label, label: curveParameterName(path),
            path: ["geoNodes", index, ...path], location: { kind: "geo", id: n.id, index, path }, value, closed, height: !closed });
    }
    if (c?.type === "outline") c.outlines.forEach((value, i) => add(["construction", "outlines", i], value, true));
    if (f?.type === "coast") add(["function", "shore"], f.shore, true);
    if (f?.type === "mountain") f.ridges?.forEach((r, i) => add(["function", "ridges", i, "line"], r.line, false));
    if (f?.type === "slope" && f.kind === "path") add(["function", "line"], f.line, false);
    return slots;
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
    return geoCurveSlots(d.geoNodes[at], at).find(slot => geometryIndex(slot) === index);
}

export function geometryIndex(slot: CurveSlot) {
    const { path } = slot.location;
    if (path[0] === "construction") return Number(path[2]);
    if (path[1] === "ridges") return -1 - Number(path[2]);
    return -1;
}

export function curveGraph(d: Design) {
    const slots = new Map<string, CurveSlot>();
    for (const id of Object.keys(d.curves ?? {})) slots.set(curveKey(id), sharedCurveSlot(d, id)!);
    d.geoNodes.forEach((n, index) => {
        for (const slot of geoCurveSlots(n, index)) slots.set(slot.key, slot);
    });
    type Source = { slot: CurveSlot; curve: Curve; offset: Point };
    const sources = new Map<string, Source>(), visiting: CurveSlot[] = [];
    function source(slot: CurveSlot): Source {
        const existing = sources.get(slot.key);
        if (existing) return existing;
        const { value, location } = slot;
        if (!isCurveRef(value)) return { slot, curve: value, offset: [0, 0] };
        const refAt = { ...location, path: [...location.path, "ref"] };
        const target = slots.get(refKey(value.ref) ?? "");
        check(target, "找不到曲线“" + value.ref + "”", refAt);
        const cycle = visiting.indexOf(slot);
        check(cycle < 0, "引用成环：" + [...visiting.slice(cycle), slot].map(quotedSlot).join(" → "), refAt);
        visiting.push(slot);
        try {
            const resolved = source(target);
            check(!slot.closed || resolved.curve.closed, "需要闭合曲线", refAt);
            if (value.h) {
                const ids = new Set(resolved.curve.nodes.map(n => n.id));
                for (const id of Object.keys(value.h))
                    check(ids.has(id), "找不到节点“" + id + "”", { ...location, path: [...location.path, "h", id] });
            }
            const [x, y] = value.offset ?? [0, 0];
            const offset: Point = [resolved.offset[0] + x, resolved.offset[1] + y];
            check(offset.every(Number.isFinite), "平移量必须是有限数", { ...location, path: [...location.path, "offset"] });
            const found = { ...resolved, offset };
            sources.set(slot.key, found);
            return found;
        }
        finally {
            visiting.pop();
        }
    }

    function materialize(slot: CurveSlot): Curve {
        const { value } = slot;
        if (!isCurveRef(value)) return value;
        const { curve, offset: [x, y] } = source(slot);
        const copy = structuredClone(curve);
        for (const n of copy.nodes) {
            if (x || y) n.p = [x ? n.p[0] + x : n.p[0], y ? n.p[1] + y : n.p[1]];
            if (value.h && Object.hasOwn(value.h, n.id)) n.h = value.h[n.id];
            else delete n.h;
        }
        return copy;
    }

    function reaches(candidate: CurveSlot, key: string) {
        const seen = new Set<string>();
        for (let slot: CurveSlot | undefined = candidate; slot; slot = isCurveRef(slot.value) ? slots.get(refKey(slot.value.ref) ?? "") : undefined) {
            if (slot.key === key) return true;
            if (seen.has(slot.key)) return false;
            seen.add(slot.key);
        }
        return false;
    }
    function canUse(from: CurveSlot, candidate: CurveSlot) {
        return !reaches(candidate, from.key) && (!from.closed || source(candidate).curve.closed);
    }

    return { slots, source, materialize, canUse, reaches };
}