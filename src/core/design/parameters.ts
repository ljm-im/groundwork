import { readAt, type Address } from "./address.ts";
import { expandKeys, functionParameters, functionTable, markParameters, matchesKey, stripWidths, type NumericParameter } from "./functionTable.ts";
import { lineProfile } from "./polyline.ts";
import { evaluate, fieldValue, references, type Value } from "./expression.ts";
import { check, DesignError, quotedLocation, type DesignProblem, type Location } from "./problems.ts";
import { type Design, type Expression, type GeoNode, type Polyline, type ResolvedDesign } from "./v5.ts";

export { readAt, writeAt, type Address } from "./address.ts";
export type Owner = "input" | "geo" | "mark";
export type Slot = { key: string; owner: Owner; id: string; name: string; label: string; field: boolean; type: NumericParameter["type"];
    path: Address; location: Location; value: Expression; virtual?: boolean };

export function geoParameter(node: GeoNode, path: Address) {
    const [group, ...key] = path;
    const c = node.construction;
    if (group === "construction" && c.type === "strip") return stripWidths(c.of?.length === 2).find(p => matchesKey(p.key, key));
    if (group === "function" && Object.hasOwn(functionTable, node.function.type))
        return functionParameters(node.function).find(p => matchesKey(p.key, key));
}

export function geoParameterName(d: Design, node: GeoNode, path: Address, context = true): string | undefined {
    const spec = geoParameter(node, path);
    if (!spec) return;
    const c = node.construction;
    if (path[0] === "construction" && c.type === "strip" && c.of?.length === 2 && typeof path[2] === "number") {
        const id = c.of[path[2]];
        return (d.geoNodes.find(n => n.id === id)?.label ?? id) + "一侧";
    }
    const prefix: string[] = [];
    for (const [key, label] of [["ridges", "山脊"], ["peaks", "山峰"], ["points", "顶点"]] as const) {
        const i = path.indexOf(key);
        if (i !== -1 && (context || key === "points") && typeof path[i + 1] === "number")
            prefix.push(label + " " + (Number(path[i + 1]) + 1));
    }
    return [...prefix, spec.label].join(" ");
}

export function parameters(d: Design) {
    const slots = new Map<string, Slot>();
    function add(location: Location & { kind: Owner; id: string }, name: string, root: Address, property: Address, label: string,
        type: NumericParameter["type"], fallback: Expression, virtual = false) {
        const path = [...root, ...location.path], input = readAt(d, path);
        const { kind: owner, id } = location;
        const key = owner + ":" + id + (property.length ? "." + property.join(".") : "");
        slots.set(key, { key, owner, id, name, label, field: type === "field", type, location, path,
            value: (input === undefined ? fallback : input) as Expression, virtual });
    }
    for (const [id, v] of Object.entries(d.inputs)) add({ kind: "input", id, path: ["value"] }, v?.label ?? id, ["inputs", id], [], "当前值", "number", 0);
    d.geoNodes.forEach((n, index) => {
        const f = n.function, c = n.construction;
        const at = (path: Address): Location & { kind: "geo" } => ({ kind: "geo", id: n.id, index, path });
        check(f && Object.hasOwn(functionTable, f.type), "无效", at(["function", "type"]));
        const addGeo = (path: Address, property: Address, p: NumericParameter, fallback = p.default, virtual = false) => {
            add(at(path), n.label, ["geoNodes", index], property, geoParameterName(d, n, path) ?? p.label, p.type, fallback, virtual);
        };
        const profiles = new Map<Polyline, ReturnType<typeof lineProfile>>();
        for (const p of functionParameters(f)) {
            if (p.type === "geometry") continue;
            for (const key of expandKeys(f, p.key)) {
                let fallback = p.default, virtual = false;
                if (p.profile && readAt(f, key) === undefined) {
                    const lineKey = key.slice(0, -3), line = readAt(f, lineKey) as Polyline;
                    const vertex = Number(key.at(-2)), ease = f.type === "slope" && f.kind === "path" && f.ease;
                    if (line.points.every(v => Array.isArray(v?.p))) {
                        if (!profiles.has(line)) profiles.set(line, lineProfile(line));
                        const profile = profiles.get(line)!;
                        const span = profile.span(profile.vertexStation(vertex), ease);
                        const ref = (j: number) => "{geo:" + n.id + "." + [...lineKey, "points", j, "h"].join(".") + "}";
                        if (span) fallback = span.a === span.b ? ref(span.a.index) : ref(span.a.index) + " * " + (1 - span.t) + " + " + ref(span.b.index) + " * " + span.t;
                        // Keep authored stops sparse so easing is applied across the whole span in the evaluator.
                        virtual = !!ease && !!span;
                    }
                }
                addGeo(["function", ...key], key, p, fallback, virtual);
            }
        }
        if (c?.type === "strip") for (const p of stripWidths(c.of?.length === 2)) {
            const path = ["construction", ...p.key];
            addGeo(path, path, p);
        }
    });
    d.marks.forEach((m, index) => {
        const p = markParameters[m.kind];
        add({ kind: "mark", id: m.id, index, path: p.key }, m.label, ["marks", index], p.key, p.label, p.type, p.default);
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
    const slots = parameters(d);
    return [...slots.values()].filter(s => readAt(d, s.path) !== undefined && references(s.value).some(k => {
        if (kind === "field") return k === "field:" + id;
        const target = slots.get(k);
        return target?.owner === kind && target.id === id;
    }));
}

export function expressionGraph(d: Design, slots = parameters(d)) {
    const values = new Map<string, Value>(), visiting: string[] = [];
    function get(key: string): Value {
        if (key.startsWith("field:")) {
            const id = key.slice("field:".length);
            if (!Object.hasOwn(d.fields, id)) throw Error("找不到场“" + id + "”");
            return fieldValue(id);
        }
        const s = slots.get(key);
        if (!s) throw Error((key.startsWith("input:") ? "找不到自定义输入“" : "找不到数类型属性“") + key.slice(key.indexOf(":") + 1) + "”");
        if (s.field && visiting.length) throw Error(slotName(s) + " 是场类型参数，不能引用");
        const found = values.get(key);
        if (found !== undefined) return found;
        const cycle = visiting.indexOf(key);
        if (cycle >= 0) throw Error("引用成环：" + [...visiting.slice(cycle), key].map(k => slotName(slots.get(k)!)).join(" → "));
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
    return { slots, get };
}


export function resolveDesign(source: Design, slots = parameters(source)): ResolvedDesign {
    const { get } = expressionGraph(source, slots), design = { ...source };
    // Unchanged branches retain identity for geometry caches and direct map edits.
    function replace(path: Address, value: unknown) {
        let original: object | undefined = source, target: object = design;
        for (const [i, part] of path.slice(0, -1).entries()) {
            original = original && readAt(original, [part]) as object | undefined;
            let child = readAt(target, [part]) as object;
            if (child === original) {
                child = Array.isArray(original) ? original.slice() : original === undefined && typeof path[i + 1] === "number" ? [] : { ...original };
                Reflect.set(target, part, child);
            }
            target = child;
        }
        Reflect.set(target, path.at(-1)!, value);
    }
    const errors: DesignProblem[] = [];
    for (const s of slots.values()) {
        try {
            const value = get(s.key);
            // Keep field references for the layer's input grid. All scalar references are now constants.
            const result = typeof value === "number" ? value : String(s.value).replace(/\{([^{}]+)\}/g, (text, key: string) => key.startsWith("field:") ? text : "(" + get(key) + ")");
            if (!s.virtual && result !== readAt(source, s.path)) replace(s.path, result);
        }
        catch (error) {
            errors.push({ location: s.location, message: (error as Error).message });
        }
    }
    if (errors.length) throw new DesignError(errors);
    return design as ResolvedDesign;
}