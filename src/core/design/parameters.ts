import { functionDefaults, ridgeNoiseDefaults, routingDefaults } from "./defaults.ts";
import { lineProfile } from "./polyline.ts";
import { radians } from "../math/geometry.ts";
import { evaluate, fieldValue, references, type Value } from "./expression.ts";
import { type Design, type Expression, type GeoNode, type ResolvedDesign } from "./v5.ts";

export type Address = (string | number)[];
export type Owner = "var" | "geo" | "edge" | "node" | "building" | "setting";
interface DerivedDefault { keys: string[]; compute: (...values: number[]) => number }
export type Slot = { key: string; owner: Owner; id: string; name: string; label: string; field: boolean; path: Address; location: string; value: Expression; derived?: DerivedDefault; interpolated?: boolean };
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
    if (group === "widthNoise" || group === "heightNoise") name = (group === "widthNoise" ? "宽度" : "高度") + "起伏" + (last === "amount" ? "幅度" : "波长");
    if (parts.includes("harbor")) prefix.push("港湾");
    return [...prefix, name].join(" · ");
}
export function parameters(d: Design) {
    const slots = new Map<string, Slot>();
    function owner(kind: Owner, id: string, name: string, root: Address, node?: GeoNode) {
        return (relative: Address, property = relative, field = false, fallback?: Expression | DerivedDefault, interpolated = false) => {
            const path = [...root, ...relative], input = readAt(d, path);
            const derived = input === undefined && typeof fallback === "object" ? fallback : undefined;
            const value = input === undefined ? derived ? 0 : fallback : input;
            if (value === undefined) return;
            const key = kind + ":" + id + (property.length ? "." + property.join(".") : "");
            slots.set(key, { key, owner: kind, id, name, label: parameterLabel(property, node), location: location(path), path, field, derived, interpolated, value: value as Expression });
        };
    }
    for (const [id, v] of Object.entries(d.variables)) owner("var", id, v?.label ?? id, ["variables", id])(["value"], [], false, 0);
    for (const [id, f] of Object.entries(d.fields)) owner("setting", "field." + id, f?.label ?? id, ["fields", id])(["default"], ["default"], false, 0);
    if (d.routing) for (const [key, value] of Object.entries({ ...routingDefaults, ...d.routing }))
        owner("setting", "routing", "选线参数", ["routing"])([key], [key], false, value);
    d.geoNodes.forEach((n, i) => {
        const add = owner("geo", n.id, n.name, ["geoNodes", i], n), f = n.function;
        if (!f) throw Error("geoNodes[" + i + "].function 缺失");
        const fn = (p: Address, fallback?: Expression, field = false, interpolated = false) => add(["function", ...p], p, field, fallback, interpolated);
        if (f.type !== "slope" || f.kind === "radial")
            for (const [k, value] of Object.entries(functionDefaults[f.type] ?? {})) fn([k], value, fieldKeys.includes(k));
        if (randomFunctions.includes(f.type)) fn(["seed"], 0);
        if (f.type === "coast" && f.harbor) {
            fn(["harbor", "radius"], 4); fn(["harbor", "span"], 3);
        }
        if (f.type === "slope" && f.kind === "path" && Array.isArray(f.line?.points)) {
            const points = f.line.points;
            const profile = points.some(v => v?.h === undefined) && points.every(v => Array.isArray(v?.p)) ? lineProfile(f.line) : undefined;
            points.forEach((v, j) => {
                const span = profile?.span(profile.vertexStation(j), f.ease);
                const ref = (i: number) => "{geo:" + n.id + ".line.points." + i + ".h}";
                const fallback = span ? ref(span.a.index) + " * " + (1 - span.t) + " + " + ref(span.b.index) + " * " + span.t : 0;
                fn(["line", "points", j, "h"], fallback, false, v?.h === undefined && !!span);
            });
        }
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
                if (Array.isArray(ridge.line?.points)) ridge.line.points.forEach((_, t) => fn(["ridges", j, "line", "points", t, "h"], 0));
            });
            if (Array.isArray(f.peaks)) f.peaks.forEach((_, j) => {
                for (const [k, value] of Object.entries({ radius: 5, noise: 0, scale: 12 })) fn(["peaks", j, k], value);
                fn(["peaks", j, "at", "h"], 0);
            });
        }
        if (n.construction?.type === "strip" && Array.isArray(n.construction.widths)) n.construction.widths.forEach((_, j) => add(["construction", "widths", j]));
    });
    d.buildings.forEach((b, i) => {
        const add = owner("building", b.id, b.name, ["buildings", i]);
        for (const k of ["height", "radius", "inner"]) add([k]);
        const prefix = "building:" + b.id + ".", rect = b.shape === "rect";
        add(["angle"], ["angle"], false, 0);
        add(["blockMargin"], ["blockMargin"], false, 0);
        add(["pad"], ["pad"], false, rect ? 1.3 : "{" + prefix + "radius} + 1.3");
        add(["treeRadius"], ["treeRadius"], false, {
            keys: (rect ? ["size.0", "size.1", "angle"] : ["radius"]).map(k => prefix + k),
            compute: (w, h, angle) => {
                if (!rect) return Math.SQRT2 * w + 1.5;
                const c = Math.abs(Math.cos(angle * radians)), s = Math.abs(Math.sin(angle * radians));
                return Math.hypot(w * c + h * s, w * s + h * c) / 2 + 1.5;
            }
        });
        if (Array.isArray(b.size)) b.size.forEach((_, j) => add(["size", j]));
        if (Array.isArray(b.doors)) b.doors.forEach((_, j) => {
            for (const k of ["angle", "wall", "t"]) add(["doors", j, k]);
        });
    });
    d.nodes.forEach((n, i) => owner("node", n.id, n.name, ["nodes", i])(["direction"], ["direction"], false, 0));
    d.edges.forEach((e, i) => {
        const add = owner("edge", e.id, e.name, ["edges", i]);
        for (const k of ["width", "comfort", "maxGrade", "corridor"] as const) add([k], [k], false, d.roadClasses?.[e.grade]?.[k]);
        add(["stairUntil"], ["stairUntil"], false, 0);
    });
    return slots;
}
const dependencies = (s: Slot) => s.derived?.keys ?? references(s.value);
export const slotName = (s: Slot) => "“" + s.name + "”" + (s.owner === "var" ? "" : "." + s.label);
export function canReference(slots: Map<string, Slot>, from: string | undefined, to: string) {
    const seen = new Set<string>();
    function reaches(key: string): boolean {
        if (key === from) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        const slot = slots.get(key);
        return !!slot && dependencies(slot).some(reaches);
    }
    return !from || !reaches(to);
}
export function referenceUses(d: Design, kind: Owner | "field", id: string) {
    const slots = parameters(d);
    return [...slots.values()].filter(s => readAt(d, s.path) !== undefined && references(s.value).some(k => {
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
            let value = s.derived ? s.derived.compute(...s.derived.keys.map(key => get(key) as number)) : evaluate(s.value, get);
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
            // Slope profiles interpolate across authored height stops, including smoothstep over the whole span.
            const authored = readAt(source, s.path);
            // Building footprints share the editable object when their existing geometry defaults apply.
            const footprintDefault = s.owner === "building" && authored === undefined &&
                (s.path.at(-1) !== "angle" || source.buildings[Number(s.path[1])].shape !== "rect");
            if (!s.interpolated && !footprintDefault && result !== authored) replace(s.path, result);
        }
        catch (error) {
            errors.add(s.location + " " + (error as Error).message);
        }
    }
    source.nodes.forEach((n, i) => {
        if (n.direction === undefined && n.directionMode === undefined) replace(["nodes", i, "directionMode"], "auto");
    });
    for (const [id, rule] of Object.entries(source.roadClasses ?? {}))
        if (rule.rampLimit == null) replace(["roadClasses", id, "rampLimit"], 1000);
    source.labels.forEach((l, i) => {
        if (l.var !== undefined && !Object.hasOwn(source.variables, l.var)) errors.add("labels[" + i + "].var 找不到变量“" + l.var + "”");
    });
    if (errors.size) throw Error([...errors].join("\n"));
    return design as ResolvedDesign;
}