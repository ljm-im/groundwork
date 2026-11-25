import { type ClosedCurve, type Curve, type GeoNode, type Point, type ResolvedDesign } from "./v5.ts";
import { defaultFieldPrecision, isBuiltin, reserved, seedId, heightId } from "./defaults.ts";
import { canWrite, expandKeys, functionParameterKeys, functionParameters, functionTable, numericValid } from "./functionTable.ts";
import { readAt, type Address } from "./address.ts";
import { check, DesignError, rejectRetired, type DesignProblem, type Location } from "./problems.ts";
import { hasHandleSide, neighbor } from "./path.ts";

export const point = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
export const record = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

export const validInputRange = (range: unknown) =>
    Array.isArray(range) && range.length === 3 && range.every(Number.isFinite) && range[0] < range[1] && range[2] > 0;
export const validFieldPrecision = (precision: unknown) => precision === undefined || typeof precision === "number" && Number.isFinite(precision) && precision > 0;
export const validStripWidths = (widths: unknown) => point(widths) && widths.every(w => w >= 0) && widths.some(w => w > 0);

export function validateCurves(n: GeoNode, index: number) {
    const at = (path: Address): Location => ({ kind: "geo", id: n.id, index, path });
    const ids = new Set<string>();
    function curve(value: unknown, key: Address, closed: boolean) {
        check(record(value), "无效", at(key));
        const p = value as Curve;
        rejectRetired(p, ["points", "smooth"], at(key));
        check(typeof p.closed === "boolean" && (!closed || p.closed), "无效", at([...key, "closed"]));
        const nodesAt = [...key, "nodes"];
        check(Array.isArray(p.nodes), "无效", at(nodesAt));
        check(p.nodes.length >= (p.closed ? 3 : 2), p.closed ? "闭合曲线至少需要三个节点" : "曲线至少需要两个节点", at(nodesAt));
        for (const [i, node] of p.nodes.entries()) {
            const pos = [...nodesAt, i], field = (name: string) => at([...pos, name]);
            check(record(node), "无效", at(pos));
            rejectRetired(node, ["next"], at(pos));
            check(typeof node.id === "string" && node.id, "无效", field("id"));
            check(!ids.has(node.id), "重复“" + node.id + "”", field("id"));
            ids.add(node.id);
            check(point(node.p), "无效", field("p"));
            check(node.mode === "corner" || node.mode === "auto" || node.mode === "manual", "无效", field("mode"));
            if (!p.closed && i === 0) check(!Object.hasOwn(node, "in"), "开放曲线的首节点没有前一段", field("in"));
            if (!p.closed && i === p.nodes.length - 1) for (const name of ["out", "bulge"])
                check(!Object.hasOwn(node, name), "开放曲线的末节点没有后一段", field(name));
            if (closed) check(!Object.hasOwn(node, "h"), "这里的节点不能有高度", field("h"));
            if (node.bulge !== undefined) check(Number.isFinite(node.bulge) && node.bulge !== 0, "无效", field("bulge"));
        }
        for (const [i, node] of p.nodes.entries()) {
            const field = (name: string) => at([...nodesAt, i, name]);
            if (node.mode === "manual") check(node.bulge === undefined && p.nodes[neighbor(p, i, -1) ?? -1]?.bulge === undefined,
                "手动平滑节点不能和圆弧相邻", field("mode"));
            for (const side of ["in", "out"] as const) {
                if (Object.hasOwn(node, side)) {
                    check(hasHandleSide(p, i, side), "和圆弧相邻的一侧不能有控制柄", field(side));
                    check(node.mode !== "auto", "自动平滑节点不存储控制柄", field(side));
                    check(point(node[side]), "无效", field(side));
                }
                else check(node.mode !== "manual", "手动平滑节点需要两侧控制柄", field(side));
            }
            if (node.mode === "manual") {
                const [ix, iy] = node.in!, [ox, oy] = node.out!;
                const a = Math.hypot(ix, iy) || 1, b = Math.hypot(ox, oy) || 1;
                check(Math.abs(ix / a * (oy / b) - iy / a * (ox / b)) < 1e-8 &&
                    ix / a * (ox / b) + iy / a * (oy / b) <= 0, "无效", field("mode"));
            }
        }
    }
    const c = n.construction;
    if (c?.type === "free" && Array.isArray(c.paths)) c.paths.forEach((p, i) => curve(p, ["construction", "paths", i], true));
    const f = n.function;
    if (f?.type === "coast") curve(f.shore, ["function", "shore"], true);
    if (f?.type === "slope" && f.kind === "path") curve(f.line, ["function", "line"], false);
    if (f?.type === "mountain" && Array.isArray(f.ridges)) f.ridges.forEach((r, i) => curve(r?.line, ["function", "ridges", i, "line"], false));
}

export function validateGeo(d: ResolvedDesign, allowBrokenReferences = false) {
    for (const [id, v] of Object.entries(d.inputs)) {
        const at = (path: Address) => ({ kind: "input" as const, id, path }), r = v?.range;
        check(id && Number.isFinite(v?.value), "无效", at(["value"]));
        check(v.label === undefined || typeof v.label === "string", "无效", at(["label"]));
        check(validInputRange(r), "无效", at(["range"]));
        if (isBuiltin("input", id)) check(v.label === reserved.input[seedId].label, "必须是“" + reserved.input[seedId].label + "”", at(["label"]));
    }
    for (const [id, field] of Object.entries(d.fields)) {
        const at = (path: Address) => ({ kind: "field" as const, id, path });
        check(id && record(field), "无效", at([]));
        check(!Object.hasOwn(field, "default"), "已从 v5 移除", at(["default"]));
        check(typeof field.label === "string", "无效", at(["label"]));
        check(field.unit === undefined || typeof field.unit === "string", "无效", at(["unit"]));
        const { precision } = field;
        check(validFieldPrecision(precision), "必须是正的有限数", at(["precision"]));
        if (isBuiltin("field", id)) {
            const builtin = reserved.field[heightId];
            check(field.label === builtin.label, "必须是“" + builtin.label + "”", at(["label"]));
            check(field.unit === builtin.unit, "必须是“" + builtin.unit + "”", at(["unit"]));
            check(precision === undefined || precision === defaultFieldPrecision, "必须是 " + defaultFieldPrecision, at(["precision"]));
        }
    }
    const problems: DesignProblem[] = [];
    const upperPaths = new Map<string, ClosedCurve[]>();
    for (const [index, n] of d.geoNodes.entries()) {
        const at = (path: Address) => ({ kind: "geo" as const, id: n.id, index, path });
        const valid = (ok: unknown, path: Address) => check(ok, "无效", at(path));
        const missing = (path: Address, message: string) => {
            if (!n.disabled) problems.push({ location: at(path), message });
        };
        valid(!Object.hasOwn(n, "disabled") || n.disabled === true, ["disabled"]);
        validateCurves(n, index);
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
        }
        else {
            valid(Array.isArray(c.of) && [1, 2].includes(c.of.length) && c.of.every(id => typeof id === "string") && new Set(c.of).size === c.of.length, ["construction", "of"]);
            for (const ref of c.of) if (!upperPaths.has(ref)) missing(["construction", "of"], "找不到下方地件“" + ref + "”");
            valid(validStripWidths(c.widths), ["construction", "widths"]);
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
            for (const key of functionParameterKeys(f, p)) {
                const value = readAt(f, key), pos = fn(key);
                if (p.type !== "geometry") {
                    if (value === undefined && p.profile) continue;
                    valid(numericValid(p, value), pos);
                    continue;
                }
                switch (p.default) {
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