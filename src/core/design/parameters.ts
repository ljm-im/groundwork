import { evaluate, fieldValue, references, type Value } from "./expression.ts";
import { type Design, type Expression, type GeoNode, type ResolvedDesign } from "./v5.ts";

export type Address = (string | number)[];
export type Owner = "var" | "geo" | "edge" | "node" | "building" | "setting";
export type Slot = { key: string; owner: Owner; id: string; name: string; label: string; field: boolean; path: Address; location: string; value: Expression };
export const randomFunctions = ["coast", "mountain", "cliff", "erosion", "islets", "noise"];
const keys: Record<string, string> = {
    value: "数值", amount: "增量", roughness: "海岸粗糙度", span: "过渡宽度", radius: "半径", floor: "作用下限",
    factor: "悬崖系数", seaLevel: "海平面", strength: "侵蚀强度", reach: "离岸距离", density: "礁石密度", threshold: "密度阈值",
    rate: "径向变化率", amplitude: "振幅", scale: "噪声尺度", octaves: "倍频数", feather: "羽化宽度", grade: "放坡坡度", seed: "种子",
    droplets: "水滴数", inertia: "惯性", capacity: "携沙能力", minCapacity: "最小携沙量", deposition: "沉积率", erosion: "侵蚀率",
    evaporation: "蒸发率", gravity: "重力", lifetime: "寿命", noise: "半径起伏", h: "高度", width: "路面宽度", comfort: "舒适坡度",
    maxGrade: "最大坡度", corridor: "走廊半宽", stairUntil: "强制台阶终点", direction: "手动朝向", height: "高度", angle: "转角",
    inner: "内半径", pad: "台基范围", blockMargin: "避让距离", treeRadius: "避树半径", wall: "墙面编号", t: "门的位置"
};
const byFunction: Record<string, string[]> = {
    ground: ["value"], flat: ["value"], coast: ["roughness"], mountain: ["floor"], cliff: ["factor", "seaLevel"],
    erosion: ["strength", "floor", "droplets", "inertia", "capacity", "minCapacity", "deposition", "erosion", "evaporation", "gravity", "lifetime", "radius"],
    islets: ["density", "reach", "threshold", "seaLevel"], slope: ["value", "rate", "radius"], add: ["amount", "feather"],
    noise: ["amplitude", "scale", "octaves", "feather"], batter: ["grade"]
};
const fieldKeys = ["amplitude", "roughness", "factor", "strength", "density"];
export function readAt(root: object, path: Address): unknown {
    return path.reduce<unknown>((v, k) => v && typeof v === "object" && Object.hasOwn(v, k) ? Reflect.get(v, k) : undefined, root);
}
export function writeAt(root: object, path: Address, value: unknown) {
    const parent = readAt(root, path.slice(0, -1)) as object, key = path.at(-1)!;
    if (value === undefined) Reflect.deleteProperty(parent, key);
    else Reflect.set(parent, key, value);
}
function location(path: Address) {
    return path.map((k, i) => typeof k === "number" ? "[" + k + "]" : (i ? "." : "") + k).join("");
}
export function parameterLabel(path: Address, node?: GeoNode): string {
    if (!path.length) return "数值";
    const parts = path.map(String), last = parts.at(-1)!, index = Number(last);
    const prefix: string[] = [];
    for (const [key, name] of [["ridges", "山脊"], ["peaks", "山峰"], ["points", "顶点"], ["doors", "门"]]) {
        const at = parts.indexOf(key);
        if (at >= 0) prefix.push(name + " " + (Number(parts[at + 1]) + 1));
    }
    const group = parts.at(-2);
    let name = keys[last] ?? last;
    if (node?.function.type === "slope" && last === "value") name = "基准值";
    if (node?.function.type === "erosion" && last === "radius") name = "笔刷半径";
    if (parts.includes("peaks") && last === "h") name = "峰顶高度";
    if (parts.includes("doors") && last === "angle") name = "门的转角";
    if (group === "size") name = ["长", "宽"][index];
    if (group === "widths") {
        const strip = node?.construction.type === "strip" && parts.includes("construction") ? node.construction : undefined;
        const sides = strip ? ["第一侧宽度", "第二侧宽度"] : ["左侧宽度", "右侧宽度"];
        name = (strip?.of.length === 1 ? ["向内宽度", "向外宽度"] : sides)[index];
    }
    if (group === "widthNoise" || group === "heightNoise") name = (group === "widthNoise" ? "宽度" : "高度") + ["振幅", "频率", "相位"][index];
    if (parts.includes("harbor")) prefix.push("港湾");
    return [...prefix, name].join(" · ");
}
export function parameters(d: Design) {
    const slots = new Map<string, Slot>();
    function owner(kind: Owner, id: string, name: string, root: Address, node?: GeoNode) {
        return (relative: Address, property = relative, field = false) => {
            const path = [...root, ...relative], value = readAt(d, path);
            if (value === undefined) return;
            const key = kind + ":" + id + (property.length ? "." + property.join(".") : "");
            slots.set(key, { key, owner: kind, id, name, label: parameterLabel(property, node), location: location(path), path, field, value: value as Expression });
        };
    }
    for (const [id, v] of Object.entries(d.variables)) owner("var", id, v?.label ?? id, ["variables", id])(["value"], []);
    for (const [id, f] of Object.entries(d.fields)) owner("setting", "field." + id, f?.label ?? id, ["fields", id])(["default"]);
    if (d.routing) for (const key of Object.keys(d.routing)) owner("setting", "routing", "选线参数", ["routing"])([key]);
    d.geoNodes.forEach((n, i) => {
        const add = owner("geo", n.id, n.name, ["geoNodes", i], n), f = n.function;
        if (!f) throw Error("geoNodes[" + i + "].function 缺失");
        const fn = (p: Address, field = false) => add(["function", ...p], p, field);
        for (const k of byFunction[f.type] ?? []) fn([k], fieldKeys.includes(k));
        if (randomFunctions.includes(f.type)) fn(["seed"]);
        if (f.type === "coast" && f.harbor) for (const k of ["radius", "span"]) fn(["harbor", k]);
        if (f.type === "slope" && f.kind === "path" && Array.isArray(f.line?.points)) f.line.points.forEach((_, j) => fn(["line", "points", j, "h"]));
        if (f.type === "mountain") {
            if (Array.isArray(f.ridges)) f.ridges.forEach((ridge, j) => {
                for (const k of ["widths", "widthNoise", "heightNoise"] as const) if (Array.isArray(ridge?.[k])) ridge[k].forEach((_, t) => fn(["ridges", j, k, t]));
                if (Array.isArray(ridge?.line?.points)) ridge.line.points.forEach((_, t) => fn(["ridges", j, "line", "points", t, "h"]));
            });
            if (Array.isArray(f.peaks)) f.peaks.forEach((_, j) => {
                for (const k of ["radius", "noise", "scale"]) fn(["peaks", j, k]);
                fn(["peaks", j, "at", "h"]);
            });
        }
        if (n.construction?.type === "strip" && Array.isArray(n.construction.widths)) n.construction.widths.forEach((_, j) => add(["construction", "widths", j]));
    });
    d.buildings.forEach((b, i) => {
        const add = owner("building", b.id, b.name, ["buildings", i]);
        for (const k of ["height", "angle", "radius", "inner", "pad", "blockMargin", "treeRadius"]) add([k]);
        if (Array.isArray(b.size)) b.size.forEach((_, j) => add(["size", j]));
        if (Array.isArray(b.doors)) b.doors.forEach((_, j) => {
            for (const k of ["angle", "wall", "t"]) add(["doors", j, k]);
        });
    });
    d.nodes.forEach((n, i) => owner("node", n.id, n.name, ["nodes", i])(["direction"]));
    d.edges.forEach((e, i) => {
        const add = owner("edge", e.id, e.name, ["edges", i]);
        for (const k of ["width", "comfort", "maxGrade", "corridor", "stairUntil"]) add([k]);
    });
    return slots;
}
export const slotName = (s: Slot) => "“" + s.name + "”" + (s.owner === "var" ? "" : "." + s.label);
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
export function referenceUses(d: Design, kind: Owner | "field", id: string) {
    const slots = parameters(d);
    return [...slots.values()].filter(s => references(s.value).some(k => {
        if (kind === "field") return k === "field:" + id;
        const target = slots.get(k);
        return target?.owner === kind && target.id === id;
    }))
        .map(s => slotName(s) + " · " + s.location);
}

export function expressionGraph(d: Design, slots = parameters(d)) {
    const values = new Map<string, Value>(), visiting: string[] = [];
    function get(key: string): Value {
        if (key.startsWith("field:")) {
            const id = key.slice(6);
            if (id !== "height" && !Object.hasOwn(d.fields, id)) throw Error("找不到场“" + id + "”");
            return fieldValue(id);
        }
        const s = slots.get(key);
        if (!s) throw Error((key.startsWith("var:") ? "找不到变量“" : "找不到数类型属性“") + key.slice(key.indexOf(":") + 1) + "”");
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
    function replace(path: Address, value: Expression) {
        let original: object = source, target: object = design;
        for (const part of path.slice(0, -1)) {
            original = Reflect.get(original, part);
            let child = Reflect.get(target, part);
            if (child === original) {
                child = Array.isArray(original) ? original.slice() : { ...original };
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
            if (result !== s.value) replace(s.path, result);
        }
        catch (error) {
            errors.add(s.location + " " + (error as Error).message);
        }
    }
    source.labels.forEach((l, i) => {
        if (l.var !== undefined && !Object.hasOwn(source.variables, l.var)) errors.add("labels[" + i + "].var 找不到变量“" + l.var + "”");
    });
    if (errors.size) throw Error([...errors].join("\n"));
    return design as ResolvedDesign;
}