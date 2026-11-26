import { defaultFollow, type Design } from "./v5.ts";
import { defaultFieldPrecision, defaultInputRange, heightId, reserved, seedId } from "./defaults.ts";
import { constructionCenter, rasterRegion, shapeLayout } from "./regions.ts";
import { distance } from "../math/geometry.ts";
import { type WorkPool } from "../math/work.ts";
import { point, record, validateCurves, validateGeo, validateSharedCurves } from "./validateGeo.ts";
import { check, type Location } from "./problems.ts";
import { fillFunctionParameters, gridStep, markParameters, numericValid } from "./functionTable.ts";
import { curveGraph, isCurveRef } from "./curveReferences.ts";
import { literalPattern } from "./expression.ts";
import { parameters, resolveDesign, writeAt } from "./parameters.ts";

export function parseDesign(text: unknown, allowBrokenReferences = false, pool?: WorkPool): Design {
    const d: Design = typeof text === "string" ? JSON.parse(text) : structuredClone(text);
    check(d && typeof d === "object", "不支持的版本");
    check(d.version === 5, "不支持的版本");
    if (d.grid && d.grid.step === undefined) d.grid.step = gridStep.default as number;
    check(numericValid(gridStep, d.grid?.step), "无效", { kind: "project", path: gridStep.key });

    for (const [key, kind, label] of [["geoNodes", "geo", "地件"], ["sections", "section", "剖面线"], ["marks", "mark", "标记"]] as const) {
        const list = d[key];
        check(Array.isArray(list), "缺少" + label + "列表");
        const seen = new Set<string>();
        list.forEach((item, index) => {
            const at: Location = { kind, id: item?.id, index, path: [] };
            check(item && typeof item.id === "string" && item.id && !seen.has(item.id), "缺失或重复", { ...at, path: ["id"] });
            check(typeof item.label === "string", "无效", { ...at, path: ["label"] });
            check(!Object.hasOwn(item, "showLabel") || typeof item.showLabel === "boolean", "无效", { ...at, path: ["showLabel"] });
            if (key !== "marks" && "labelOffset" in item)
                check(Array.isArray(item.labelOffset) && item.labelOffset.length === 2 &&
                    Number.isFinite(item.labelOffset[0]) && Number.isFinite(item.labelOffset[1]), "只能填写两个有限数", { ...at, path: ["labelOffset"] });
            seen.add(item.id);
        });
    }
    for (const [index, mark] of d.marks.entries()) {
        const at = (path: string[]): Location => ({ kind: "mark", id: mark.id, index, path });
        check(point(mark.point), "只能填写数字坐标", at(["point"]));
        check(mark.kind === "text" || mark.kind === "scale", "无效", at(["kind"]));
        if (mark.follow === undefined) mark.follow = defaultFollow(mark.kind);
        check(mark.follow === "screen" || mark.follow === "map", "无效", at(["follow"]));
        if (mark.kind === "text") check(mark.showElevation === undefined || typeof mark.showElevation === "boolean", "无效", at(["showElevation"]));
    }
    check(record(d.inputs), "缺少输入声明");
    check(record(d.fields), "缺少场声明");
    if (!Object.hasOwn(d.inputs, seedId)) d.inputs[seedId] = structuredClone(reserved.input[seedId]);
    if (!Object.hasOwn(d.fields, heightId)) d.fields = { ...structuredClone(reserved.field), ...d.fields };
    for (const [id, input] of Object.entries(d.inputs)) {
        check(record(input), "无效", { kind: "input", id, path: [] });
        if (input.range === undefined) input.range = defaultInputRange(id);
    }

    if (d.curves === undefined) d.curves = {};
    validateSharedCurves(d);
    const implicitHarbors: number[] = [];
    for (const [index, node] of d.geoNodes.entries()) {
        const at = (path: (string | number)[]): Location => ({ kind: "geo", id: node.id, index, path });
        if (node.field === undefined) node.field = heightId;
        const f = node.function;
        if (f?.type === "coast") {
            if (f.harbor === undefined) {
                f.harbor = { center: [0, 0] } as typeof f.harbor;
                implicitHarbors.push(index);
            }
            else check(f.harbor && point(f.harbor.center), "无效", at(["function", "harbor", "center"]));
            fillFunctionParameters(f, ["harbor"]);
        }
        if (f?.type === "mountain") {
            if (Array.isArray(f.ridges)) f.ridges.forEach((ridge, j) => check(record(ridge), "无效", at(["function", "ridges", j])));
            if (Array.isArray(f.peaks)) f.peaks.forEach((peak, j) => check(record(peak), "无效", at(["function", "peaks", j])));
        }
        validateCurves(node, index);
    }
    const curves = curveGraph(d), slots = parameters(d, undefined, curves);
    for (const slot of slots.values()) {
        if (typeof slot.value === "string" && literalPattern.test(slot.value.trim())) {
            slot.value = Number(slot.value);
            writeAt(d, slot.path, slot.value);
        }
    }
    const numeric = resolveDesign(d, slots, curves);
    validateGeo(numeric, allowBrokenReferences);
    for (const [index, mark] of numeric.marks.entries()) {
        const spec = markParameters[mark.kind];
        check(numericValid(spec, mark.kind === "scale" ? mark.length : mark.elevation), "无效", { kind: "mark", id: mark.id, index, path: spec.key });
    }
    let layout: ReturnType<typeof shapeLayout> | undefined;
    for (const i of implicitHarbors) {
        const { construction, id } = numeric.geoNodes[i], f = d.geoNodes[i].function;
        if (f.type !== "coast") continue;
        if (construction.type === "outline" && construction.outlines.length === 1)
            f.harbor.center = constructionCenter(construction, d.grid.step);
        else {
            const { grid, shapes } = layout ??= shapeLayout(numeric, pool);
            f.harbor.center = constructionCenter(construction, d.grid.step, grid, rasterRegion(grid, shapes.get(id)!, pool));
        }
    }
    for (const object of [d, ...d.geoNodes, ...d.sections]) {
        check(!Object.hasOwn(object, "prompt") || typeof object.prompt === "string", "描述必须是字符串");
        if (object.prompt === "") delete object.prompt;
    }
    const validPoints = (list: unknown) => Array.isArray(list) && list.length === 2 && list.every(point);
    for (const [i, s] of d.sections.entries()) {
        const at = (path: string[]): Location => ({ kind: "section", id: s.id, index: i, path });
        check(validPoints(s.points) && distance(...s.points) > 0, "长度无效", at(["points"]));
    }
    return d;
}
export function serializeDesign(d: Design | null) {
    const refs = new Set<object>(d ? [...curveGraph(d).slots.values()].map(slot => slot.value).filter(isCurveRef) : []);
    const terrain = new Set<object>(d?.geoNodes);
    const sections = new Set<object>(d?.sections);
    const fields = new Set<object>(Object.values(d?.fields ?? {}));
    const marks = new Map<object, Design["marks"][number]["kind"]>(d?.marks.map(mark => [mark, mark.kind]));
    const ranges = new Map<object, number[]>(Object.entries(d?.inputs ?? {}).map(([id, input]) => [input, defaultInputRange(id)]));
    const coasts = new Set<object>(d?.geoNodes.flatMap(node => node.function.type === "coast" ? [node.function] : []));
    return JSON.stringify(d, function (this: object, key: string, value: unknown) {
        if (key === "prompt" && value === "" || key === "disabled" && value === false ||
            key === "showLabel" && value === !terrain.has(this)) return undefined;
        if (key === "curves" && this === d && !Object.keys(d.curves).length) return undefined;
        if (key === "offset" && refs.has(this) && point(value) && !value.some(Boolean)) return undefined;
        if (key === "field" && terrain.has(this) && value === heightId) return undefined;
        if (key === "labelOffset" && (terrain.has(this) || sections.has(this)) && point(value) && value[0] === 0 && value[1] === 0) return undefined;
        if (key === "precision" && fields.has(this) && value === defaultFieldPrecision) return undefined;
        const kind = marks.get(this);
        if (key === "follow" && kind && value === defaultFollow(kind)) return undefined;
        const range = ranges.get(this);
        if (key === "range" && range && Array.isArray(value) && value.length === range.length && range.every((v, i) => v === value[i])) return undefined;
        if (key === "harbor" && coasts.has(this) && (value as { radius?: unknown } | undefined)?.radius === 0) return undefined;
        return value;
    }, 2);
}