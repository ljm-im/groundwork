import { type Design, type FieldInput, type Height, type Path, type Point, type Polyline } from "./v5.ts";

export function check(ok: unknown, message: string): asserts ok {
    if (!ok) throw new Error(message);
}
export const point = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
export const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const record = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = Number.isFinite;

export function validateGeo(d: Design) {
    check(record(d.variables), "variables 缺失");
    check(record(d.fields) && !Object.hasOwn(d.fields, "height"), "fields 无效，高度场是内置场");
    for (const [key, variable] of Object.entries(d.variables)) {
        const r = variable?.range;
        check(key && finite(variable?.value) && (variable.label == null || typeof variable.label === "string") &&
            (r == null || Array.isArray(r) && r.length === 3 && r.every(finite) && r[0] < r[1] && positive(r[2])), "variables." + key + " 无效");
    }
    for (const [key, f] of Object.entries(d.fields))
        check(key && finite(f?.default) && (f.label == null || typeof f.label === "string"), "fields." + key + " 无效");
    const field = (name: string) => name === "height" || Object.hasOwn(d.fields, name);
    const missingVariables: string[] = [];
    const upperPaths = new Map<string, Path[]>();
    for (const [i, n] of d.geoNodes.entries()) {
        const at = "geoNodes[" + i + "]";
        const valid = (ok: unknown, path: string) => check(ok, at + "." + path + " 无效");
        const ids = new Set<string>();
        function path(p: Path, key: string) {
            valid(p?.closed === true && Array.isArray(p.nodes) && p.nodes.length >= 2, key);
            for (const [j, v] of p.nodes.entries()) {
                const pos = key + ".nodes[" + j + "]";
                valid(v && typeof v.id === "string" && v.id && point(v.p), pos);
                check(!ids.has(v.id), at + "." + pos + ".id 重复 " + v.id);
                ids.add(v.id);
                valid(["auto", "corner", "manual"].includes(v.mode) && ["curve", "arc", "line"].includes(v.next ?? "curve"), pos);
                valid([v.in, v.out].every(h => h === undefined || point(h)) && (v.mode !== "auto" || !v.in && !v.out), pos + ".mode");
                if (v.mode === "manual") valid(v.in && v.out && Math.abs(v.in[0] * v.out[1] - v.in[1] * v.out[0]) < 1e-8, pos + ".manual");
                if (v.next === "arc") valid(finite(v.bulge) && v.bulge !== 0, pos + ".bulge");
            }
        }
        function height(h: Height, key: string) {
            if (typeof h === "number") valid(finite(h), key);
            else {
                valid(h && typeof h.var === "string", key);
                if (!Object.hasOwn(d.variables, h.var)) missingVariables.push(at + "." + key + " 找不到变量 " + h.var);
                valid(finite(h.offset ?? 0), key + ".offset");
            }
        }
        function input(v: FieldInput, key: string) {
            if (typeof v === "number") valid(finite(v), key);
            else {
                check(v && field(v.field), at + "." + key + " 找不到场 " + v?.field);
                valid(finite(v.scale ?? 1) && finite(v.offset ?? 0), key);
            }
        }
        function line(l: Polyline, key: string, all: boolean) {
            valid(l && Array.isArray(l.points) && l.points.length >= 2 && l.points.some(v => v?.h !== undefined), key);
            for (const [j, v] of l.points.entries()) {
                valid(v && point(v.p), key + ".points[" + j + "].p");
                if (all || v.h !== undefined) height(v.h!, key + ".points[" + j + "].h");
            }
        }
        const c = n.construction, f = n.function;
        valid(c && ["free", "strip"].includes(c.type), "construction");
        valid(f && typeof f.type === "string" && Number.isSafeInteger(f.seed ?? 0), "function");
        if (c.type === "free") {
            valid(Array.isArray(c.paths) && c.paths.length > 0, "construction.paths");
            c.paths.forEach((p, j) => path(p, "construction.paths[" + j + "]"));
        }
        else {
            valid(Array.isArray(c.of) && [1, 2].includes(c.of.length) && new Set(c.of).size === c.of.length, "construction.of");
            for (const ref of c.of) check(upperPaths.has(ref), at + ".construction.of 找不到下方地件 " + ref);
            valid(point(c.widths) && c.widths.every(w => w >= 0) && c.widths.some(positive), "construction.widths");
            if (c.range) {
                const upper = [...upperPaths.keys()].reverse().find(id => c.of.some(ref => ref === id))!;
                const { from, to } = c.range;
                check(upperPaths.get(upper)!.some(p => [from, to].every(id => p.nodes.some(v => v.id === id))),
                    at + ".construction.range 在同一路径上找不到 " + from + "、" + to);
            }
        }
        upperPaths.set(n.id, c.type === "free" ? c.paths : []);
        check(field(n.field ?? "height"), at + ".field 找不到场 " + n.field);
        valid(!n.field || n.field === "height" || ["flat", "slope", "add", "blend", "split"].includes(f.type), "field");
        if (["blend", "split", "batter"].includes(f.type)) valid(c.type === "strip", "construction.type");
        if ("noise" in f && f.noise) valid(finite(f.noise.amplitude) && positive(f.noise.scale ?? 1), "function.noise");
        if ("floor" in f && f.floor !== undefined) height(f.floor, "function.floor");
        if ("seaLevel" in f && f.seaLevel !== undefined) height(f.seaLevel, "function.seaLevel");
        switch (f.type) {
            case "flat": case "ground": height(f.value, "function.value"); break;
            case "coast":
                path(f.shore, "function.shore");
                input(f.roughness, "function.roughness");
                if (f.harbor) valid(point(f.harbor.center) && f.harbor.radius >= 0 && positive(f.harbor.span), "function.harbor");
                break;
            case "mountain":
                valid(Array.isArray(f.ridges) && Array.isArray(f.peaks), "function");
                f.ridges.forEach((r, j) => {
                    const key = "function.ridges[" + j + "]";
                    line(r.line, key + ".line", true);
                    valid(point(r.widths) && r.widths.every(positive) && [r.widthNoise, r.heightNoise].every(a => a?.length === 3 && a.every(finite)), key);
                });
                f.peaks.forEach((p, j) => {
                    const key = "function.peaks[" + j + "]";
                    valid(point(p.at?.p) && positive(p.radius) && finite(p.noise) && positive(p.scale), key);
                    height(p.at.h, key + ".at.h");
                });
                break;
            case "cliff": input(f.factor, "function.factor"); break;
            case "erosion":
                valid(Number.isSafeInteger(f.droplets) && f.droplets >= 0 && positive(f.radius) && positive(f.lifetime) &&
                    [f.inertia, f.capacity, f.minCapacity, f.deposition, f.erosion, f.evaporation, f.gravity].every(v => finite(v) && v >= 0), "function.erosion");
                input(f.strength ?? 1, "function.strength");
                break;
            case "islets":
                valid(finite(f.reach) && f.reach >= 0 && finite(f.threshold ?? .45), "function.reach");
                input(f.density, "function.density"); break;
            case "slope":
                if (f.kind === "path") line(f.line, "function.line", false);
                else {
                    valid(f.kind === "radial" && point(f.center) && finite(f.radius) && finite(f.rate), "function.kind");
                    height(f.value, "function.value");
                }
                break;
            case "add": height(f.amount, "function.amount"); valid(finite(f.feather) && f.feather >= 0, "function.feather"); break;
            case "batter": valid(positive(f.grade), "function.grade"); break;
            case "blend": case "split": break;
            default: valid(false, "function.type");
        }
    }
    check(d.geoNodes.some(n => n.function.type === "ground"), "geoNodes 缺少确定画布的 ground");
    for (const [i, label] of d.labels.entries())
        if (label.var !== undefined && !Object.hasOwn(d.variables, label.var)) missingVariables.push("labels[" + i + "].var 找不到变量 " + label.var);
    check(!missingVariables.length, missingVariables.join("\n"));
}