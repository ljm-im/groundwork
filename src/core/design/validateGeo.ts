import { type ClosedCurve, type GeoNode, type Point, type ResolvedDesign, type ResolvedGeoNode, type Design, type NodeQuantity, type ProfileCurve, type NodeRecords, type PointHolder } from "./v5.ts";
import { defaultFieldPrecision, isBuiltin, reserved, seedId, heightId } from "./defaults.ts";
import { canWrite, expandKeys, functionParameters, functionTable, numericValid } from "./functionTable.ts";
import { readAt, type Address } from "./address.ts";
import { check, DesignError, type DesignProblem, type Location } from "./problems.ts";
import { hasHandleSide, neighbor } from "./path.ts";
import { curveGraph, nodeQuantities, nodeQuantityPath, profileGroups, type ProfileGroup } from "./curveReferences.ts";
import { interpolates, needsNodeValue } from "./polyline.ts";

export const point = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
export const record = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

export const validInputRange = (range: unknown) =>
    Array.isArray(range) && range.length === 3 && range.every(Number.isFinite) && range[0] < range[1] && range[2] > 0;
export const validFieldPrecision = (precision: unknown) => precision === undefined || typeof precision === "number" && Number.isFinite(precision) && precision > 0;
export const validStripWidths = (widths: unknown) => point(widths) && widths.every(w => w >= 0) && widths.some(w => w > 0);

const quantities = ["h", "slope"] as const;

function authoredNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) || typeof value === "string";
}

function validInterpolation(value: unknown, allowed: readonly NodeQuantity[]) {
    return Array.isArray(value) && new Set(value).size === value.length && value.every(k => allowed.includes(k));
}

function validateCurve(value: unknown, at: (path: Address) => Location, key: Address, closed: boolean,
    allowed?: readonly NodeQuantity[]) {
    check(record(value), "无效", at(key));
    const p = value as ProfileCurve, ids = new Set<string>();
    check(typeof p.closed === "boolean" && (!closed || p.closed), "无效", at([...key, "closed"]));
    const nodesAt = [...key, "nodes"];
    check(Array.isArray(p.nodes), "无效", at(nodesAt));
    check(p.nodes.length >= (p.closed ? 3 : 2), p.closed ? "闭合曲线至少需要三个节点" : "曲线至少需要两个节点", at(nodesAt));
    for (const [i, node] of p.nodes.entries()) {
        const pos = [...nodesAt, i], field = (name: string) => at([...pos, name]);
        check(record(node), "无效", at(pos));
        check(typeof node.id === "string" && node.id, "无效", field("id"));
        check(!ids.has(node.id), "重复“" + node.id + "”", field("id"));
        ids.add(node.id);
        check(point(node.p), "无效", field("p"));
        check(node.mode === "corner" || node.mode === "auto" || node.mode === "manual", "无效", field("mode"));
        if (!p.closed && i === 0) check(!Object.hasOwn(node, "in"), "开放曲线的首节点没有前一段", field("in"));
        if (!p.closed && i === p.nodes.length - 1) for (const name of ["out", "bulge"])
            check(!Object.hasOwn(node, name), "开放曲线的末节点没有后一段", field(name));
        for (const q of quantities) if (Object.hasOwn(node, q)) {
            check(allowed, "退役键", field(q));
            check(allowed.includes(q), q === "h" ? "这里的节点不能有高度" : "这里的节点不能有坡度", field(q));
            check(node[q] === undefined || authoredNumber(node[q]), "无效", field(q));
        }
        if (Object.hasOwn(node, "interpolate")) {
            check(allowed, "退役键", field("interpolate"));
            check(allowed.length && validInterpolation(node.interpolate, allowed), "无效", field("interpolate"));
        }
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

export function validateGeometry(d: Design) {
    check(!Object.hasOwn(d, "curves"), "退役键", { kind: "project", path: ["curves"] });
    check(record(d.geometry), "无效", { kind: "project", path: ["geometry"] });
    for (const [id, entry] of Object.entries(d.geometry)) {
        const at = (path: Address): Location => ({ kind: "geometry", id, path });
        check(id && record(entry), "无效", at([]));
        check(typeof entry.label === "string", "无效", at(["label"]));
        check(!Object.hasOwn(entry, "listed"), "退役键", at(["listed"]));
        check(entry.independent === undefined || entry.independent === true, "无效", at(["independent"]));
        check(Object.hasOwn(entry, "point") !== Object.hasOwn(entry, "curve"), "需要点或曲线", at([]));
        for (const key of ["showLabel", "labelOffset"]) check(!Object.hasOwn(entry, key), "无效", at([key]));
        if ("point" in entry) check(point(entry.point), "只能填写数字坐标", at(["point"]));
        else validateCurve(entry.curve, at, ["curve"], false);
    }
}

export function validatePointHolder(value: unknown, at: Location): asserts value is PointHolder {
    check(record(value), "需要点的持有者", at);
    const holder = value as Record<string, unknown>;
    const usesNode = Object.hasOwn(holder, "curve") || Object.hasOwn(holder, "node");
    if (usesNode) check(!Object.hasOwn(holder, "point"), "无效", at);
    for (const key of usesNode ? ["curve", "node"] : ["point"])
        check(typeof holder[key] === "string" && holder[key], "无效", { ...at, path: [...at.path, key] });
    if (Object.hasOwn(holder, "offset")) check(point(holder.offset), "只能填写两个有限数", { ...at, path: [...at.path, "offset"] });
}

export function validateCurves(n: GeoNode | ResolvedGeoNode, index: number, resolved = false) {
    const at = (path: Address): Location => ({ kind: "geo", id: n.id, index, path });
    function held(value: unknown, key: Address, group?: ProfileGroup) {
        const allowed = group ? nodeQuantities(profileGroups[group].kind) : [];
        const curveAt = [...key, ...(!resolved || group ? ["curve"] : [])];
        if (resolved) {
            validateCurve(group ? readAt(value as object, ["curve"]) : value, at, curveAt, !group, allowed);
            return;
        }
        check(record(value), "无效", at(key));
        const holder = value as Record<string, unknown>;
        if (Object.hasOwn(holder, "ref")) {
            check(Object.keys(holder).length === 1 && typeof holder.ref === "string", "无效", at(key));
            return;
        }
        if (Object.hasOwn(holder, "offset")) check(point(holder.offset), "只能填写两个有限数", at([...key, "offset"]));
        if (group === "lines") check(holder.ease === undefined || typeof holder.ease === "boolean", "无效", at([...key, "ease"]));
        check(!record(holder.curve), "退役的曲线格式", at(curveAt));
        check(typeof holder.curve === "string" && holder.curve, "无效", at(curveAt));
        const values = holder as NodeRecords;
        for (const q of quantities) if (Object.hasOwn(values, q)) {
            check(allowed.includes(q), q === "h" ? "这里的节点不能有高度" : "这里的节点不能有坡度", at([...key, q]));
            check(record(values[q]) && Object.values(values[q]!).every(authoredNumber), "无效", at([...key, q]));
        }
        if (Object.hasOwn(values, "interpolate"))
            check(allowed.length && record(values.interpolate) && Object.values(values.interpolate!).every(v => validInterpolation(v, allowed)), "无效", at([...key, "interpolate"]));
    }
    const c = n.construction;
    check(c?.type === "outline" || c?.type === "strip", "是未知取值", at(["construction", "type"]));
    if (c.type === "outline") {
        check(Array.isArray(c.outlines) && c.outlines.length, "无效", at(["construction", "outlines"]));
        c.outlines.forEach((value, i) => held(value, ["construction", "outlines", i]));
    }
    const f = n.function;
    if (f?.type === "coast") held(f.shore, ["function", "shore"]);
    if (f?.type === "slope") {
        for (const key of ["line", "ease"])
            check(!Object.hasOwn(f, key), "请在 lines 中写入坡线及其设置", at(["function", key]));
        const center = at(["function", "center"]);
        if (resolved) check(point(f.center), "只能填写数字坐标", center);
        else validatePointHolder(f.center, center);
        for (const key of ["radius", "value", "rate"] as const)
            check(authoredNumber(f[key]), "无效", at(["function", key]));
        check(Array.isArray(f.lines), "无效", at(["function", "lines"]));
        f.lines.forEach((value, i) => held(value, ["function", "lines", i], "lines"));
    }
    if (f?.type === "mountain") for (const group of ["ridges", "valleys"] as const) {
        check(Array.isArray(f[group]), "无效", at(["function", group]));
        f[group].forEach((value, i) => held(value, ["function", group, i], group));
    }
}

export function validateProfileEndpoints(graph: ReturnType<typeof curveGraph>) {
    for (const holder of graph.holders.values()) {
        const slot = graph.ofHolder(holder), curve = graph.shape(slot);
        for (const q of nodeQuantities(holder.kind)) for (const [i, node] of curve.nodes.entries()) {
            if (!needsNodeValue(curve, i)) continue;
            const label = q === "slope" ? "坡度" : holder.kind === "line" ? "增量" : "高度";
            const path = [...holder.location.path, ...nodeQuantityPath(node.id, q)];
            check(!interpolates(node, q), (curve.closed ? "第一个节点" : "首尾节点") + "必须写明" + label, { ...slot.location, path });
        }
    }
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
        validateCurves(n, index, true);
        const c = n.construction, f = n.function, spec = functionTable[f.type];
        const fn = (key: Address) => ["function", ...key];
        valid(c && ["outline", "strip"].includes(c.type), ["construction"]);
        valid(typeof n.field === "string" && n.field.length, ["field"]);
        if (!Object.hasOwn(d.fields, n.field)) missing(["field"], "找不到场“" + n.field + "”");
        valid(canWrite(f.type, n.field), ["field"]);
        valid(!spec.construction || c.type === spec.construction, ["construction", "type"]);
        const ps = functionParameters(f);
        if (!ps.some(p => p.type === "seed")) valid(!Object.hasOwn(f, "seed"), fn(["seed"]));
        if (c.type === "outline") {
            valid(Array.isArray(c.outlines) && c.outlines.length > 0, ["construction", "outlines"]);
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
        upperPaths.set(n.id, c.type === "outline" ? c.outlines : []);
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
                    case "center": case "draw-point": valid(point(value), pos); break;
                    case "empty": valid(Array.isArray(value), pos); break;
                }
            }
        }
    }
    if (!d.geoNodes.some(n => functionTable[n.function.type].initial)) problems.push({ message: "缺少确定画布的初始地件" });
    if (!allowBrokenReferences && problems.length) throw new DesignError(problems);
    return problems;
}