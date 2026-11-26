import { defaultFollow, type Design } from "./v5.ts";
import { defaultFieldPrecision, defaultInputRange, heightId, reserved, seedId } from "./defaults.ts";
import { distance } from "../math/geometry.ts";
import { point, record, validateCurves, validateGeo, validateGeometry, validatePointHolder, validateProfileEndpoints } from "./validateGeo.ts";
import { check, type Location } from "./problems.ts";
import { fillFunctionParameters, gridStep, markParameters, numericValid } from "./functionTable.ts";
import { curveGraph, geometryUsers } from "./curveReferences.ts";
import { literalPattern, tokens } from "./expression.ts";
import { parameters, resolveDesign, writeAt } from "./parameters.ts";

export function parseDesign(text: unknown, allowBrokenReferences = false): Design {
    const d: Design = typeof text === "string" ? JSON.parse(text) : structuredClone(text);
    check(d && typeof d === "object", "不支持的版本");
    check(d.version === 5, "不支持的版本");
    validateGeometry(d);
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
        validatePointHolder(mark.point, at(["point"]));
        check(point(mark.screen), "只能填写数字坐标", at(["screen"]));
        check(mark.kind === "text" || mark.kind === "scale", "无效", at(["kind"]));
        if (mark.follow === undefined) mark.follow = defaultFollow(mark.kind);
        check(mark.follow === "screen" || mark.follow === "map", "无效", at(["follow"]));
        if (mark.kind === "text") {
            check(mark.showElevation === undefined || typeof mark.showElevation === "boolean", "无效", at(["showElevation"]));
            if (mark.elevation === undefined) mark.elevation = markParameters.text.default;
        }
        else {
            if (mark.length === undefined) mark.length = markParameters.scale.default;
            if (mark.follow === "screen") {
                if (typeof mark.length === "string" && !literalPattern.test(mark.length.trim())) tokens(mark.length);
                else check(numericValid(markParameters.scale, Number(mark.length)) &&
                    (typeof mark.length === "number" || typeof mark.length === "string"), "无效", at(["length"]));
            }
        }
    }
    check(record(d.inputs), "缺少输入声明");
    check(record(d.fields), "缺少场声明");
    if (!Object.hasOwn(d.inputs, seedId)) d.inputs[seedId] = structuredClone(reserved.input[seedId]);
    if (!Object.hasOwn(d.fields, heightId)) d.fields = { ...structuredClone(reserved.field), ...d.fields };
    for (const [id, input] of Object.entries(d.inputs)) {
        check(record(input), "无效", { kind: "input", id, path: [] });
        if (input.range === undefined) input.range = defaultInputRange(id);
    }

    for (const [index, node] of d.geoNodes.entries()) {
        const at = (path: (string | number)[]): Location => ({ kind: "geo", id: node.id, index, path });
        if (node.field === undefined) node.field = heightId;
        const f = node.function;
        if (f?.type === "coast") {
            check(record(f.harbor), "无效", at(["function", "harbor"]));
            validatePointHolder(f.harbor.center, at(["function", "harbor", "center"]));
            fillFunctionParameters(f, ["harbor"]);
        }
        if (f?.type === "mountain") {
            check(Array.isArray(f.peaks), "无效", at(["function", "peaks"]));
            f.peaks.forEach((peak, j) => {
                check(record(peak), "无效", at(["function", "peaks", j]));
                validatePointHolder(peak.at, at(["function", "peaks", j, "at"]));
            });
        }
        if (f?.type === "erosion") check(f.spacing !== undefined, "缺少计算间距", at(["function", "spacing"]));
        validateCurves(node, index);
    }
    for (const [index, section] of d.sections.entries()) {
        const at = (path: (string | number)[]): Location => ({ kind: "section", id: section.id, index, path });
        check(Array.isArray(section.points) && section.points.length === 2, "长度无效", at(["points"]));
        section.points.forEach((p, i) => validatePointHolder(p, at(["points", i])));
    }
    const curves = curveGraph(d);
    validateProfileEndpoints(curves);
    const slots = parameters(d, undefined, curves);
    for (const slot of slots.values()) {
        if (!slot.output && typeof slot.value === "string" && literalPattern.test(slot.value.trim())) {
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
    for (const object of [d, ...d.geoNodes, ...d.sections]) {
        check(!Object.hasOwn(object, "prompt") || typeof object.prompt === "string", "描述必须是字符串");
        if (object.prompt === "") delete object.prompt;
    }
    for (const [i, s] of numeric.sections.entries()) {
        const at = (path: string[]): Location => ({ kind: "section", id: s.id, index: i, path });
        check(distance(...s.points) > 0, "长度无效", at(["points"]));
    }
    return d;
}
export function serializeDesign(d: Design | null) {
    const holders = new Set<object>(d ? [...geometryUsers(d).values()].flat().map(slot => slot.value) : []);
    const terrain = new Set<object>(d?.geoNodes);
    const sections = new Set<object>(d?.sections);
    const fields = new Set<object>(Object.values(d?.fields ?? {}));
    const marks = new Map<object, Design["marks"][number]["kind"]>(d?.marks.map(mark => [mark, mark.kind]));
    const ranges = new Map<object, number[]>(Object.entries(d?.inputs ?? {}).map(([id, input]) => [input, defaultInputRange(id)]));
    const lines = new Set<object>(d?.geoNodes.flatMap(node => node.function.type === "slope" ? node.function.lines : []));
    return JSON.stringify(d, function (this: object, key: string, value: unknown) {
        if (key === "prompt" && value === "" || key === "disabled" && value === false ||
            key === "showLabel" && value === !terrain.has(this)) return undefined;
        if (key === "offset" && holders.has(this) && point(value) && !value.some(Boolean)) return undefined;
        if (key === "field" && terrain.has(this) && value === heightId) return undefined;
        if (key === "labelOffset" && (terrain.has(this) || sections.has(this)) && point(value) && value[0] === 0 && value[1] === 0) return undefined;
        if (key === "precision" && fields.has(this) && value === defaultFieldPrecision) return undefined;
        const kind = marks.get(this);
        if (key === "follow" && kind && value === defaultFollow(kind)) return undefined;
        const range = ranges.get(this);
        if (key === "range" && range && Array.isArray(value) && value.length === range.length && range.every((v, i) => v === value[i])) return undefined;
        if (key === "ease" && lines.has(this) && value === false) return undefined;
        if (key === "interpolate") {
            if (value && typeof value === "object") {
                const entries = Object.entries(value).filter(([, flags]) => flags.length);
                return entries.length ? Object.fromEntries(entries) : undefined;
            }
        }
        return value;
    }, 2);
}