import { readAt, writeAt, type Address } from "./address.ts";
import { expandKeys, functionParameterKeys, functionParameters, functionTable, markParameters, matchesKey, parameterDefault, stripWidths, type NumericParameter } from "./functionTable.ts";
import { curveGraph, curveParameterName, isCurveRef, resolvedCurvePath, type HolderSlot } from "./curveReferences.ts";
import { lineProfile } from "./polyline.ts";
import { evaluate, fieldValue, references, type Value } from "./expression.ts";
import { check, DesignError, quotedLocation, type DesignProblem, type Location } from "./problems.ts";
import { type Design, type Expression, type GeoNode, type ResolvedDesign } from "./v5.ts";

export { readAt, writeAt, type Address } from "./address.ts";
export type Owner = "input" | "geo" | "mark";
export type Slot = { key: string; owner: Owner; id: string; name: string; label: string; field: boolean; type: NumericParameter["type"];
    path: Address; resolvedPath: Address; aliases?: Address[]; location: Location; value: Expression; virtual?: boolean; spec?: NumericParameter };

export function geoParameter(node: GeoNode, path: Address) {
    const [group, ...key] = path;
    const c = node.construction;
    if (group === "construction" && c.type === "strip") return stripWidths(c.of?.length === 2).find(p => matchesKey(p.key, key));
    if (group === "function" && Object.hasOwn(functionTable, node.function.type))
        return functionParameters(node.function).find(p => matchesKey(p.key, key));
}

export function geoParameterName(d: Design, node: GeoNode, path: Address, context = true): string | undefined {
    const curve = curveParameterName(path);
    if (curve) return curve;
    const spec = geoParameter(node, path);
    if (!spec) return;
    const c = node.construction;
    if (path[0] === "construction" && c.type === "strip" && c.of?.length === 2 && typeof path[2] === "number") {
        const id = c.of[path[2]];
        const label = d.geoNodes.find(n => n.id === id)?.label ?? id;
        return (context ? label : "“" + label + "”") + "一侧";
    }
    const prefix: string[] = [];
    for (const [key, label] of [["ridges", "山脊"], ["peaks", "山峰"], ["nodes", "节点"]] as const) {
        const i = path.indexOf(key);
        if (i !== -1 && context && typeof path[i + 1] === "number")
            prefix.push(label + " " + (Number(path[i + 1]) + 1));
    }
    return [...prefix, spec.label].join(path.includes("nodes") ? "." : " ");
}

export function parameters(d: Design, geoIndex?: number, curves = curveGraph(d)) {
    const slots = new Map<string, Slot>();
    function add(location: Location & { kind: Owner; id: string }, name: string, root: Address, property: Address, label: string,
        type: NumericParameter["type"], fallback: Expression, virtual = false, spec?: NumericParameter, resolvedAt = location.path, aliases?: Address[]) {
        const path = [...root, ...location.path], input = readAt(d, path);
        const { kind: owner, id } = location;
        const key = owner + ":" + id + (property.length ? "." + property.join(".") : "");
        slots.set(key, { key, owner, id, name, label, field: type === "field", type, location, path, resolvedPath: [...root, ...resolvedAt],
            value: (input === undefined ? fallback : input) as Expression, virtual, spec, aliases });
    }
    if (geoIndex === undefined)
        for (const [id, v] of Object.entries(d.inputs)) add({ kind: "input", id, path: ["value"] }, v?.label ?? id, ["inputs", id], [], "当前值", "number", 0);
    const nodes: Iterable<[number, GeoNode]> = geoIndex === undefined ? d.geoNodes.entries() : [[geoIndex, d.geoNodes[geoIndex]]];
    for (const [index, n] of nodes) {
        const f = n.function, c = n.construction;
        const at = (path: Address): Location & { kind: "geo" } => ({ kind: "geo", id: n.id, index, path });
        check(f && Object.hasOwn(functionTable, f.type), "无效", at(["function", "type"]));
        const addGeo = (path: Address, property: Address, p: NumericParameter, fallback = parameterDefault(p, n.id), virtual = false, resolvedAt = path, holder?: HolderSlot, labelAt = path) => {
            const aliases = holder && curves.holderPlacements(holder).filter(item => item !== holder)
                .map(item => [...item.path, ...resolvedAt.slice(holder.location.path.length)]);
            const name = geoParameterName(d, n, labelAt) ?? p.label;
            add(at(path), n.label, ["geoNodes", index], property, name, p.type, fallback, virtual, p, resolvedAt, aliases);
        };
        for (const p of functionParameters(f)) {
            if (p.type === "geometry") continue;
            if (!p.profile) {
                for (const key of functionParameterKeys(f, p)) {
                    const path = ["function", ...key];
                    const holder = key[0] === "ridges" ? curves.holders.get("geo:" + n.id + "." + key.slice(0, 2).join(".")) : undefined;
                    if (!holder || curves.holder(holder) === holder) addGeo(path, key, p, undefined, false, path, holder);
                }
                continue;
            }
            const ease = f.type === "mountain" || f.type === "slope" && f.kind === "path" && f.ease;
            for (const lineKey of expandKeys(f, p.key.slice(0, -3))) {
                const slot = curves.slots.get("geo:" + n.id + "." + lineKey.join("."));
                if (!slot?.holder || curves.holder(slot.holder) !== slot.holder) continue;
                const referenced = isCurveRef(curves.value(slot)), line = curves.materialize(slot);
                const heightKey = (j: number): Address => referenced ? [...lineKey, "h", line.nodes[j].id] : [...lineKey, "nodes", j, "h"];
                let profile: ReturnType<typeof lineProfile> | undefined;
                for (const [j, v] of line.nodes.entries()) {
                    const key = heightKey(j), resolvedAt = [...resolvedCurvePath(slot).slice(2), "nodes", j, "h"];
                    let fallback = parameterDefault(p, n.id), virtual = false;
                    if (v.h === undefined) {
                        profile ??= lineProfile(line, d.grid.step / 8);
                        const span = profile.span(profile.nodeStation(j), ease);
                        const ref = (k: number) => "{geo:" + n.id + "." + heightKey(k).join(".") + "}";
                        if (span) {
                            fallback = span.a === span.b ? ref(span.a.index) : ref(span.a.index) + " * " + (1 - span.t) + " + " + ref(span.b.index) + " * " + span.t;
                            // Keep authored stops sparse so easing is applied across the whole span in the evaluator.
                            virtual = !!ease;
                        }
                    }
                    addGeo(["function", ...key], key, p, fallback, virtual, resolvedAt, slot.holder, ["function", ...lineKey, "nodes", j, "h"]);
                }
            }
        }
        if (c?.type === "strip") for (const p of stripWidths(c.of?.length === 2)) {
            const path = ["construction", ...p.key];
            addGeo(path, path, p);
        }
    }
    if (geoIndex === undefined) d.marks.forEach((m, index) => {
        const p = markParameters[m.kind];
        add({ kind: "mark", id: m.id, index, path: p.key }, m.label, ["marks", index], p.key, p.label, p.type, p.default, false, p);
    });
    return slots;
}

export const slotName = (s: Slot) => quotedLocation(s.name, s.owner === "input" ? undefined : s.label);
export function canReference(slots: Map<string, Slot>, from: string | undefined, to: string) {
    const seen = new Set<string>();
    function reaches(key: string): boolean {
        if (key === from) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        const slot = slots.get(key);
        return !!slot && references(slot.value).some(reaches);
    }
    return !from || !reaches(to);
}
export function referenceSlots(d: Design, kind: Owner | "field", id: string) {
    const { slots, key } = expressionGraph(d);
    return [...slots.values()].filter(s => readAt(d, s.path) !== undefined && references(s.value).some(k => {
        if (kind === "field") return k === "field:" + id;
        const target = slots.get(key(k));
        return target?.owner === kind && (target.id === id || kind === "geo" && k.startsWith("geo:" + id + ".") && key(k) !== k);
    }));
}

export function expressionLookup(d: Design, slot: (key: string) => Slot | undefined, unchanged?: (key: string) => Value | undefined, canonical = (key: string) => key) {
    const values = new Map<string, Value>(), visiting: string[] = [];
    function get(key: string): Value {
        if (key.startsWith("field:")) {
            const id = key.slice("field:".length);
            if (!Object.hasOwn(d.fields, id)) throw Error("找不到场“" + id + "”");
            return fieldValue(id);
        }
        const inputKey = key;
        key = canonical(key);
        const s = slot(key);
        if (!s) throw Error((key.startsWith("input:") ? "找不到自定义输入“" : "找不到数类型属性“") + inputKey.slice(inputKey.indexOf(":") + 1) + "”");
        if (s.field && visiting.length) throw Error(slotName(s) + " 是场类型参数，不能引用");
        const found = values.get(key) ?? unchanged?.(key);
        if (found !== undefined) return found;
        const cycle = visiting.indexOf(key);
        if (cycle >= 0) throw Error("引用成环：" + [...visiting.slice(cycle), key].map(k => slotName(slot(k)!)).join(" → "));
        visiting.push(key);
        try {
            let value = evaluate(s.value, get);
            if (!s.field && typeof value !== "number") throw Error("这里不能用场");
            if (s.type === "seed") value = Math.round(value as number);
            values.set(key, value);
            return value;
        }
        finally {
            visiting.pop();
        }
    }
    return get;
}

export function expressionGraph(d: Design, slots?: Map<string, Slot>, curves = curveGraph(d)) {
    const all = slots ?? parameters(d, undefined, curves), key = curves.parameterKey;
    return { slots: all, key, get: expressionLookup(d, id => all.get(id), undefined, key) };
}

export const resolvedPaths = (slot: Slot) => [slot.resolvedPath, ...slot.aliases ?? []];

export function resolveParameterValues(slots: Iterable<Slot>, get: (key: string) => Value) {
    const values = new Map<Slot, Expression>(), errors: DesignProblem[] = [];
    for (const slot of slots) {
        try {
            const value = get(slot.key);
            // Field references stay in the expression for evaluation on the layer's input grid.
            const result = typeof value === "number" ? value : String(slot.value).replace(/\{([^{}]+)\}/g,
                (text, key: string) => key.startsWith("field:") ? text : "(" + get(key) + ")");
            if (!slot.virtual) values.set(slot, result);
        }
        catch (error) {
            errors.push({ location: slot.location, message: (error as Error).message });
        }
    }
    if (errors.length) throw new DesignError(errors);
    return values;
}

export function resolveDesign(source: Design, slots?: Map<string, Slot>, curves = curveGraph(source)): ResolvedDesign {
    const { get, slots: all } = expressionGraph(source, slots, curves), design = { ...source };
    // A placed curve can still share nodes with its authored shape. Copy each branch before writing.
    const copied = new WeakSet<object>([design]);
    function replace(path: Address, value: unknown) {
        let parent: object = design;
        for (const [i, part] of path.slice(0, -1).entries()) {
            let child = readAt(parent, [part]) as object | undefined;
            if (!child || !copied.has(child)) {
                child = Array.isArray(child) ? child.slice() : child === undefined && typeof path[i + 1] === "number" ? [] : { ...child };
                copied.add(child);
                writeAt(parent, [part], child);
            }
            parent = child;
        }
        writeAt(parent, [path.at(-1)!], value);
    }
    for (const holder of curves.holders.values()) {
        const curve = curves.materialize(curves.ofHolder(holder));
        replace(holder.path, holder.kind === "ridge" ? { curve, slope: curves.holder(holder).value.slope } : curve);
    }
    for (const [slot, result] of resolveParameterValues(all.values(), get)) for (const path of resolvedPaths(slot))
        if (result !== readAt(design, path)) replace(path, result);
    return design as ResolvedDesign;
}