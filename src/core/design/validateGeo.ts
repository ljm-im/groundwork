import { type ResolvedDesign, type Path, type Point, type Polyline } from "./v5.ts";
import { defaultFieldPrecision, isBuiltin, reserved, seedId, heightId } from "./defaults.ts";
import { canWrite, expandKeys, functionParameters, functionTable, numericValid } from "./functionTable.ts";
import { readAt, type Address } from "./address.ts";
import { check, DesignError, type DesignProblem } from "./problems.ts";

export const point = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
export const record = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

export function validateGeo(d: ResolvedDesign, allowBrokenReferences = false) {
    for (const [id, v] of Object.entries(d.inputs)) {
        const at = (path: Address) => ({ kind: "input" as const, id, path }), r = v?.range;
        check(id && Number.isFinite(v?.value), "无效", at(["value"]));
        check(v.label === undefined || typeof v.label === "string", "无效", at(["label"]));
        check(Array.isArray(r) && r.length === 3 && r.every(Number.isFinite) && r[0] < r[1] && r[2] > 0, "无效", at(["range"]));
        if (isBuiltin("input", id)) check(v.label === reserved.input[seedId].label, "必须是“" + reserved.input[seedId].label + "”", at(["label"]));
    }
    for (const [id, field] of Object.entries(d.fields)) {
        const at = (path: Address) => ({ kind: "field" as const, id, path });
        check(id && record(field), "无效", at([]));
        check(!Object.hasOwn(field, "default"), "已从 v5 移除", at(["default"]));
        check(typeof field.label === "string", "无效", at(["label"]));
        check(field.unit === undefined || typeof field.unit === "string", "无效", at(["unit"]));
        const { precision } = field;
        check(precision === undefined || Number.isFinite(precision) && precision > 0, "必须是正的有限数", at(["precision"]));
        if (isBuiltin("field", id)) {
            const builtin = reserved.field[heightId];
            check(field.label === builtin.label, "必须是“" + builtin.label + "”", at(["label"]));
            check(field.unit === builtin.unit, "必须是“" + builtin.unit + "”", at(["unit"]));
            check(precision === undefined || precision === defaultFieldPrecision, "必须是 " + defaultFieldPrecision, at(["precision"]));
        }
    }
    const problems: DesignProblem[] = [];
    const upperPaths = new Map<string, Path[]>();
    for (const [index, n] of d.geoNodes.entries()) {
        const at = (path: Address) => ({ kind: "geo" as const, id: n.id, index, path });
        const valid = (ok: unknown, path: Address) => check(ok, "无效", at(path));
        const missing = (path: Address, message: string) => {
            if (!n.disabled) problems.push({ location: at(path), message });
        };
        valid(!Object.hasOwn(n, "disabled") || n.disabled === true, ["disabled"]);
        const ids = new Set<string>();
        function path(p: Path, key: Address) {
            valid(p?.closed === true && Array.isArray(p.nodes) && p.nodes.length >= 2, key);
            for (const [j, v] of p.nodes.entries()) {
                const pos = [...key, "nodes", j];
                valid(v && typeof v.id === "string" && v.id && point(v.p), pos);
                check(!ids.has(v.id), "重复“" + v.id + "”", at([...pos, "id"]));
                ids.add(v.id);
                valid(["auto", "corner", "manual"].includes(v.mode) && ["curve", "arc", "line"].includes(v.next ?? "curve"), pos);
                valid([v.in, v.out].every(h => h === undefined || point(h)) && (v.mode !== "auto" || !v.in && !v.out), [...pos, "mode"]);
                if (v.mode === "manual") valid(v.in && v.out && Math.abs(v.in[0] * v.out[1] - v.in[1] * v.out[0]) < 1e-8, [...pos, "manual"]);
                if (v.next === "arc" && v.bulge !== undefined) valid(Number.isFinite(v.bulge) && v.bulge !== 0, [...pos, "bulge"]);
            }
        }
        function line(l: Polyline<number>, key: Address) {
            valid(l && Array.isArray(l.points) && l.points.length >= 2 && l.points.some(v => v?.h !== undefined), key);
            for (const [j, v] of l.points.entries()) valid(v && point(v.p), [...key, "points", j, "p"]);
        }
        const c = n.construction, f = n.function, spec = functionTable[f.type];
        const fn = (key: Address) => ["function", ...key];
        valid(c && ["free", "strip"].includes(c.type), ["construction"]);
        valid(typeof n.field === "string" && n.field.length, ["field"]);
        if (!Object.hasOwn(d.fields, n.field)) missing(["field"], "找不到场“" + n.field + "”");
        valid(canWrite(f.type, n.field), ["field"]);
        valid(!spec.construction || c.type === spec.construction, ["construction", "type"]);
        const ps = functionParameters(f);
        if (!ps.some(p => p.type === "seed")) valid(!Object.hasOwn(f, "seed"), fn(["seed"]));
        check(!Object.hasOwn(f, "noise"), "是未知字段", at(fn(["noise"])));
        if (c.type === "free") {
            valid(Array.isArray(c.paths) && c.paths.length > 0, ["construction", "paths"]);
            c.paths.forEach((p, j) => path(p, ["construction", "paths", j]));
        }
        else {
            valid(Array.isArray(c.of) && [1, 2].includes(c.of.length) && c.of.every(id => typeof id === "string") && new Set(c.of).size === c.of.length, ["construction", "of"]);
            for (const ref of c.of) if (!upperPaths.has(ref)) missing(["construction", "of"], "找不到下方地件“" + ref + "”");
            valid(point(c.widths) && c.widths.every(w => w >= 0) && c.widths.some(w => w > 0), ["construction", "widths"]);
            if (c.range) {
                const upper = [...upperPaths.keys()].reverse().find(id => c.of.some(ref => ref === id))!;
                const { from, to } = c.range;
                if (!upperPaths.get(upper)?.some(p => [from, to].every(id => p.nodes.some(v => v.id === id))))
                    missing(["construction", "range"], "在同一路径上找不到“" + from + "”、“" + to + "”");
            }
        }
        upperPaths.set(n.id, c.type === "free" ? c.paths : []);
        if (f.type === "slope") valid(f.kind === "path" || f.kind === "radial", fn(["kind"]));
        for (const p of ps) {
            for (const key of expandKeys(f, p.key)) {
                const value = readAt(f, key), pos = fn(key);
                if (p.type !== "geometry") {
                    if (value === undefined && p.profile) continue;
                    valid(numericValid(p, value), pos);
                    continue;
                }
                switch (p.default) {
                    case "boundary": path(value as Path, pos); break;
                    case "draw-line": case "axis": line(value as Polyline<number>, pos); break;
                    case "center": case "draw-point": valid(point(value), pos); break;
                    case "empty": valid(Array.isArray(value), pos); break;
                }
            }
        }
        for (const toggle of spec.toggles ?? []) for (const key of expandKeys(f, toggle.key)) {
            const value = readAt(f, key);
            valid(value === undefined || typeof value === "boolean", fn(key));
        }
    }
    if (!d.geoNodes.some(n => functionTable[n.function.type].initial)) problems.push({ message: "缺少确定画布的初始地件" });
    if (!allowBrokenReferences && problems.length) throw new DesignError(problems);
    return problems;
}