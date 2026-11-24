import { functionDefaults, ridgeNoiseDefaults } from "./defaults.ts";
import { lineProfile } from "./polyline.ts";
import { evaluate, fieldValue, references, type Value } from "./expression.ts";
import { type Design, type Expression, type GeoNode, type Polyline, type ResolvedDesign } from "./v5.ts";

export type Address = (string | number)[];
export type Owner = "input" | "geo" | "mark" | "setting";
export type Slot = { key: string; owner: Owner; id: string; name: string; label: string; field: boolean; path: Address; location: string; value: Expression };
export const randomFunctions = ["coast", "mountain", "cliff", "erosion", "islets", "noise"];
const keys: Record<string, string> = {
    value: "数值", default: "默认值", amount: "增量", roughness: "海岸粗糙度", span: "过渡宽度", radius: "半径", floor: "作用下限",
    factor: "悬崖系数", seaLevel: "海平面", strength: "侵蚀强度", reach: "离岸距离", density: "礁石密度", threshold: "密度阈值",
    rate: "径向变化率", amplitude: "振幅", scale: "噪声尺度", octaves: "倍频数", feather: "羽化宽度", grade: "放坡坡度", seed: "种子",
    droplets: "水滴数", inertia: "惯性", capacity: "携沙能力", minCapacity: "最小携沙量", deposition: "沉积率", erosion: "侵蚀率",

    evaporation: "蒸发率", gravity: "重力", lifetime: "寿命", noise: "半径起伏", h: "高度", length: "长度", elevation: "高度"
};
const fieldKeys = ["amplitude", "roughness", "factor", "strength", "density"];
export function readAt(root: object, path: Address): unknown {
    return path.reduce<unknown>((v, k) => v && typeof v === "object" && Object.hasOwn(v, k) ? Reflect.get(v, k) : undefined, root);
}
export function writeAt(root: object, path: Address, value: unknown) {
    let parent = root;
    for (const [i, part] of path.slice(0, -1).entries()) {
        if (Reflect.get(parent, part) === undefined) Reflect.set(parent, part, typeof path[i + 1] === "number" ? [] : {});
        parent = Reflect.get(parent, part);
    }
    const key = path.at(-1)!;
    if (value === undefined) Reflect.deleteProperty(parent, key);
    else Reflect.set(parent, key, value);
}
function location(path: Address) {
    return path.map((k, i) => typeof k === "number" ? "[" + k + "]" : (i ? "." : "") + k).join("");
}
function parameterLabel(path: Address, node?: GeoNode): string {
    if (!path.length) return "数值";
    const parts = path.map(String), last = parts.at(-1)!, index = Number(last);
    const prefix: string[] = [];
    for (const [key, name] of [["ridges", "山脊"], ["peaks", "山峰"], ["points", "顶点"]]) {
        const at = parts.indexOf(key);
        if (at >= 0) prefix.push(name + " " + (Number(parts[at + 1]) + 1));
    }
    const group = parts.at(-2);
    let name = keys[last] ?? last;
    if (node?.function.type === "slope" && last === "value") name = "增量";
    if (node?.function.type === "slope" && last === "h") name = "增量";
    if (node?.function.type === "erosion" && last === "radius") name = "笔刷半径";
    if (parts.includes("peaks") && last === "h") name = "峰顶高度";
    if (group === "widths") {
        const strip = node?.construction.type === "strip" && parts.includes("construction") ? node.construction : undefined;
        const sides = strip ? ["第一侧宽度", "第二侧宽度"] : ["左侧宽度", "右侧宽度"];
        name = (strip?.of.length === 1 ? ["向内宽度", "向外宽度"] : sides)[index];
    }
    if (group === "widthNoise" || group === "heightNoise") name = (group === "widthNoise" ? "宽度" : "高度") + "起伏" + (last === "amount" ? "幅度" : "波长");
    if (parts.includes("harbor")) prefix.push("港湾");
    return [...prefix, name].join(" ");
}
export function parameters(d: Design) {
    const slots = new Map<string, Slot>();
    function owner(kind: Owner, id: string, name: string, root: Address, node?: GeoNode) {
        return (relative: Address, property = relative, field = false, fallback?: Expression) => {
            const path = [...root, ...relative], input = readAt(d, path);
            const value = input === undefined ? fallback : input;
            if (value === undefined) return;
            const key = kind + ":" + id + (property.length ? "." + property.join(".") : "");
            slots.set(key, { key, owner: kind, id, name, label: parameterLabel(property, node), location: location(path), path, field, value: value as Expression });
        };
    }
    for (const [id, v] of Object.entries(d.inputs)) owner("input", id, v?.label ?? id, ["inputs", id])(["value"], [], false, 0);
    for (const [id, f] of Object.entries(d.fields)) owner("setting", "field." + id, f?.label ?? id, ["fields", id])(["default"], ["default"], false, 0);
    d.geoNodes.forEach((n, i) => {
        const add = owner("geo", n.id, n.label, ["geoNodes", i], n), f = n.function;
        if (!f) throw Error("geoNodes[" + i + "].function 缺失");
        const fn = (p: Address, fallback?: Expression, field = false) => add(["function", ...p], p, field, fallback);
        if (f.type !== "slope" || f.kind === "radial")
            for (const [k, value] of Object.entries(functionDefaults[f.type] ?? {})) fn([k], value, fieldKeys.includes(k));
        if (randomFunctions.includes(f.type)) fn(["seed"], 0);
        if (f.type === "coast") {
            fn(["harbor", "radius"], 0); fn(["harbor", "span"], 3);
        }
        function lineHeights(line: Polyline, root: Address, ease = false) {
            if (!Array.isArray(line?.points)) return;
            const points = line.points;
            const profile = points.some(v => v?.h === undefined) && points.every(v => Array.isArray(v?.p)) ? lineProfile(line) : undefined;
            const ref = (i: number) => "{geo:" + n.id + "." + root.join(".") + "." + i + ".h}";
            points.forEach((v, j) => {
                const span = v?.h === undefined ? profile?.span(profile.vertexStation(j), ease) : undefined;
                let fallback: Expression = 0;
                if (span) fallback = span.a === span.b ? ref(span.a.index) : ref(span.a.index) + " * " + (1 - span.t) + " + " + ref(span.b.index) + " * " + span.t;
                fn([...root, j, "h"], fallback);
            });
        }
        if (f.type === "slope" && f.kind === "path") lineHeights(f.line, ["line", "points"], f.ease);
        if (f.type === "mountain") {
            if (Array.isArray(f.ridges)) f.ridges.forEach((ridge, j) => {
                if (!ridge) throw Error("geoNodes[" + i + "].function.ridges[" + j + "] 无效");
                for (const side of [0, 1]) fn(["ridges", j, "widths", side], 5);
                for (const key of ["widthNoise", "heightNoise"] as const) {
                    const setting = ridge[key];
                    if (setting !== undefined && (!setting || typeof setting !== "object" || Array.isArray(setting)))
                        throw Error("geoNodes[" + i + "].function.ridges[" + j + "]." + key + " 需要 { amount, wavelength }");
                    for (const [k, value] of Object.entries(ridgeNoiseDefaults)) fn(["ridges", j, key, k], value);
                }
                lineHeights(ridge.line, ["ridges", j, "line", "points"]);
            });
            if (Array.isArray(f.peaks)) f.peaks.forEach((_, j) => {
                for (const [k, value] of Object.entries({ radius: 5, noise: 0, scale: 12 })) fn(["peaks", j, k], value);
                fn(["peaks", j, "at", "h"], 0);
            });
        }
        if (n.construction?.type === "strip") {
            const widths = n.construction.of?.length === 1 ? [0, 6] : [1, 1];
            widths.forEach((v, j) => add(["construction", "widths", j], ["construction", "widths", j], false, v));
        }
    });
    d.marks.forEach((m, i) => {
        const add = owner("mark", m.id, m.label, ["marks", i]);
        if (m.kind === "text") add(["elevation"], ["elevation"], false, 0);
        else add(["length"], ["length"], false, 10);
    });
    return slots;
}
export const slotName = (s: Slot) => "“" + s.name + "”" + (s.owner === "input" ? "" : "." + s.label);
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

export function referenceUses(d: Design, kind: Owner | "field", id: string) {
    return referenceSlots(d, kind, id).map(s => slotName(s) + "（" + s.location + "）");
}

export function expressionGraph(d: Design, slots = parameters(d)) {
    const values = new Map<string, Value>(), visiting: string[] = [];
    function get(key: string): Value {
        if (key.startsWith("field:")) {
            const id = key.slice("field:".length);
            if (id !== "height" && !Object.hasOwn(d.fields, id)) throw Error("找不到场“" + id + "”");
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
            if (s.owner === "geo" && s.path.at(-1) === "seed") value = Math.round(value as number);
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
            original = original && Reflect.get(original, part);
            let child = Reflect.get(target, part);
            if (child === original) {
                child = Array.isArray(original) ? original.slice() : original === undefined && typeof path[i + 1] === "number" ? [] : { ...original };
                Reflect.set(target, part, child);
            }
            target = child;
        }
        Reflect.set(target, path.at(-1)!, value);
    }
    const errors = new Set<string>();
    for (const s of slots.values()) {
        try {
            const value = get(s.key);
            // Keep field references for the layer's input grid. All scalar references are now constants.
            const result = typeof value === "number" ? value : String(s.value).replace(/\{([^{}]+)\}/g, (text, key: string) => key.startsWith("field:") ? text : "(" + get(key) + ")");
            if (result !== readAt(source, s.path)) replace(s.path, result);
        }
        catch (error) {
            errors.add(s.location + " " + (error as Error).message);
        }
    }
    source.geoNodes.forEach(({ function: f }, i) => {
        if (f.type !== "slope" || f.kind !== "path" || !f.ease || !Array.isArray(f.line?.points)) return;
        const stops = f.line.points.flatMap((v, j) => v.h === undefined ? [] : [j]);
        if (stops.length && stops.length < f.line.points.length) replace(["geoNodes", i, "function", "line", "heightStops"], stops);
    });
    if (errors.size) throw Error([...errors].join("\n"));
    return design as ResolvedDesign;
}