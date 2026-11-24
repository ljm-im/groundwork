import { defaultFollow, type Design } from "./v5.ts";
import { defaultInputRange, seedId, seedLabel } from "./defaults.ts";
import { constructionCenter, rasterRegion, shapeLayout } from "./regions.ts";
import { distance } from "../math/geometry.ts";
import { check, point, positive, validateGeo } from "./validateGeo.ts";
import { literalPattern } from "./expression.ts";
import { parameters, resolveDesign, writeAt } from "./parameters.ts";

export function parseDesign(text: unknown, allowBrokenReferences = false): Design {
    const d: Design = typeof text === "string" ? JSON.parse(text) : structuredClone(text);
    check(d && typeof d === "object", "不支持的版本");
    check(d.version === 5, "不支持的版本");
    function rejectRetired(value: object, path: string, names: string[]) {
        for (const name of names) check(!Object.hasOwn(value, name), path + name + " 已从 v5 移除");
    }
    rejectRetired(d, "", ["levels", "levelControls", "coast", "ridges", "peaks", "zones", "erosion", "yards", "seed", "variables", "labels",
        "buildings", "nodes", "edges", "roadClasses", "routing", "vegetation"]);
    if (d.grid && d.grid.step === undefined) d.grid.step = 1;
    check(positive(d.grid?.step), "网格参数无效");
    rejectRetired(d.grid, "grid.", ["xMin", "xMax", "yMin", "yMax"]);

    function validateLabel(item: object, path: string) {
        rejectRetired(item, path + ".", ["name"]);
        check(typeof Reflect.get(item, "label") === "string", path + ".label 无效");
        check(!Object.hasOwn(item, "showLabel") || typeof Reflect.get(item, "showLabel") === "boolean", path + ".showLabel 无效");
    }
    for (const key of ["geoNodes", "sections", "marks"] as const) {
        const list = d[key];
        check(Array.isArray(list), key + " 缺失");
        const seen = new Set<string>();
        list.forEach((item, i) => {
            const path = key + "[" + i + "]";
            check(item && typeof item.id === "string" && item.id && !seen.has(item.id), path + ".id 缺失或重复");
            validateLabel(item, path);
            seen.add(item.id);
        });
    }
    for (const [i, mark] of d.marks.entries()) {
        const pos = "marks[" + i + "]";
        check(point(mark.point), pos + ".point 只能填写数字坐标");
        check(mark.kind === "text" || mark.kind === "scale", pos + ".kind 无效");
        if (mark.follow === undefined) mark.follow = defaultFollow(mark.kind);
        check(mark.follow === "screen" || mark.follow === "map", pos + ".follow 无效");
        if (mark.kind === "text") {
            rejectRetired(mark, pos + ".", ["level", "var", "building", "offset", "spot", "minZoom", "titleOnly"]);
            check(mark.showElevation === undefined || typeof mark.showElevation === "boolean", pos + ".showElevation 无效");
        }
    }
    check(d.inputs && typeof d.inputs === "object" && !Array.isArray(d.inputs), "inputs 缺失");
    check(d.fields && typeof d.fields === "object" && !Array.isArray(d.fields), "fields 缺失");
    if (!Object.hasOwn(d.inputs, seedId)) d.inputs[seedId] = { label: seedLabel, value: 1, range: defaultInputRange(seedId) };
    for (const [id, input] of Object.entries(d.inputs)) {
        check(input && typeof input === "object" && !Array.isArray(input), "inputs." + id + " 无效");
        if (input.range === undefined) input.range = defaultInputRange(id);
    }

    const implicitHarbors: number[] = [];
    for (const [i, node] of d.geoNodes.entries()) {
        const f = node.function;
        if (f?.type === "coast") {
            if (f.harbor === undefined) {
                f.harbor = { center: [0, 0], radius: 0, span: 3 };
                implicitHarbors.push(i);
            }
            else {
                check(f.harbor && point(f.harbor.center), "geoNodes[" + i + "].function.harbor.center 无效");
                if (f.harbor.radius === undefined) f.harbor.radius = 0;
                if (f.harbor.span === undefined) f.harbor.span = 3;
            }
        }
        if (f?.type === "flat") rejectRetired(f, "geoNodes[" + i + "].function.", ["value"]);
        if (f?.type === "slope" && f.kind === "path" && f.line)
            check(!Object.hasOwn(f.line, "heightStops"), "geoNodes[" + i + "].function.line.heightStops 是计算结果");
    }
    const slots = parameters(d);
    for (const slot of slots.values()) {
        if (typeof slot.value === "string" && literalPattern.test(slot.value.trim())) {
            slot.value = Number(slot.value);
            writeAt(d, slot.path, slot.value);
        }
    }
    const numeric = resolveDesign(d, slots);
    validateGeo(numeric, allowBrokenReferences);
    for (const [i, mark] of numeric.marks.entries())
        if (mark.kind === "scale") check(positive(mark.length), "marks[" + i + "].length 无效");
    let layout: ReturnType<typeof shapeLayout> | undefined;
    for (const i of implicitHarbors) {
        const { construction, id } = numeric.geoNodes[i], f = d.geoNodes[i].function;
        if (f.type !== "coast") continue;
        if (construction.type === "free" && construction.paths.length === 1)
            f.harbor.center = constructionCenter(construction, d.grid.step);
        else {
            const { grid, shapes } = layout ??= shapeLayout(numeric);
            f.harbor.center = constructionCenter(construction, d.grid.step, grid, rasterRegion(grid, shapes.get(id)!));
        }
    }
    for (const object of [d, ...d.geoNodes, ...d.sections]) {
        check(!Object.hasOwn(object, "prompt") || typeof object.prompt === "string", "描述必须是字符串");
        if (object.prompt === "") delete object.prompt;
    }
    const validPoints = (list: unknown) => Array.isArray(list) && list.length === 2 && list.every(point);
    for (const [i, s] of d.sections.entries()) {
        check(validPoints(s.points) && distance(...s.points) > 0, "剖面线长度无效");
        const marks = Reflect.get(s, "marks");
        check(marks === undefined || Array.isArray(marks) && !marks.length, "sections[" + i + "].marks 已从 v5 移除");
        Reflect.deleteProperty(s, "marks");
    }
    return d;
}
export function serializeDesign(d: Design | null) {
    const terrain = new Set<object>(d?.geoNodes);
    const marks = new Map<object, Design["marks"][number]["kind"]>(d?.marks.map(mark => [mark, mark.kind]));
    const ranges = new Map<object, number[]>(Object.entries(d?.inputs ?? {}).map(([id, input]) => [input, defaultInputRange(id)]));
    const coasts = new Set<object>(d?.geoNodes.flatMap(node => node.function.type === "coast" ? [node.function] : []));
    return JSON.stringify(d, function (this: object, key: string, value: unknown) {
        if (key === "prompt" && value === "" || key === "disabled" && value === false ||
            key === "showLabel" && value === !terrain.has(this)) return undefined;
        const kind = marks.get(this);
        if (key === "follow" && kind && value === defaultFollow(kind)) return undefined;
        const range = ranges.get(this);
        if (key === "range" && range && Array.isArray(value) && value.length === range.length && range.every((v, i) => v === value[i])) return undefined;
        if (key === "harbor" && coasts.has(this) && (value as { radius: unknown } | undefined)?.radius === 0) return undefined;
        return value;
    }, 2);
}