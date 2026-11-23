import { type Design, type Expression, type ResolvedDesign, type Edge, type RoadNode, type RoadMode, type RoadPair } from "./v5.ts";
import { distance, radians } from "../math/geometry.ts";
import { doorPose } from "./shapes.ts";
import { simpleBoundary } from "../math/polygon.ts";
import { check, point, positive, validateGeo } from "./validateGeo.ts";

import { literalPattern } from "./expression.ts";
import { parameters, resolveDesign, writeAt } from "./parameters.ts";

export { corners, buildingShape, moveDoorOrPoint as moveNode } from "./shapes.ts";
export function nodePose(design: Pick<ResolvedDesign, "nodes" | "buildings">, node: Pick<RoadNode<Expression>, "point" | "type" | "building" | "door" | "direction" | "directionMode"> | string) {
    if (typeof node === "string") node = design.nodes.find(n => n.id === node)!;
    const pose = doorPose(design, node);
    if (node.type === "door") pose.normal = pose.angle;
    if (node.directionMode === "manual" || node.directionMode !== "auto" && node.direction != null) pose.angle = Number(node.direction ?? 0) * radians;
    return pose;
}

export function parseDesign(text: unknown, allowBrokenReferences = false): Design {
    const d: Design = typeof text === "string" ? JSON.parse(text) : structuredClone(text);
    check(d && typeof d === "object", "不支持的版本");
    check(![1, 2, 3, 4].includes(d.version), "暂不支持 v4 设计，等待迁移");
    check(d.version === 5, "不支持的版本");
    function rejectRetired(value: object, path: string, names: string[]) {
        for (const name of names) check(!Object.hasOwn(value, name), path + name + " 已从 v5 移除");
    }
    rejectRetired(d, "", ["levels", "levelControls", "coast", "ridges", "peaks", "zones", "erosion", "yards", "seed", "variables", "labels"]);
    if (d.grid && d.grid.step === undefined) d.grid.step = 1;
    check(positive(d.grid?.step), "网格参数无效");
    rejectRetired(d.grid, "grid.", ["xMin", "xMax", "yMin", "yMax"]);

    function validateLabel(item: object, path: string, optional = false) {
        rejectRetired(item, path + ".", ["name"]);
        check(typeof Reflect.get(item, "label") === "string" || optional && !Object.hasOwn(item, "label"), path + ".label 无效");
        check(!Object.hasOwn(item, "showLabel") || typeof Reflect.get(item, "showLabel") === "boolean", path + ".showLabel 无效");
    }
    for (const key of ["geoNodes", "buildings", "nodes", "edges", "sections", "marks"] as const) {
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
        if (mark.kind === "text") {
            rejectRetired(mark, pos + ".", ["level", "var"]);
            check(mark.building === undefined || typeof mark.building === "string", pos + ".building 无效");
            check(mark.offset === undefined || point(mark.offset), pos + ".offset 只能填写数字坐标");
            check(mark.minZoom === undefined || Number.isFinite(mark.minZoom), pos + ".minZoom 无效");
            for (const key of ["showElevation", "spot", "titleOnly"] as const)
                check(mark[key] === undefined || typeof mark[key] === "boolean", pos + "." + key + " 无效");
        }
    }
    for (const [i, b] of d.buildings.entries()) {
        const pos = "buildings[" + i + "]";
        rejectRetired(b, pos + ".", ["zone", "showTitle"]);
        check(Array.isArray(b.doors) && b.doors.every(door => door && typeof door.id === "string") && new Set(b.doors.map(door => door.id)).size === b.doors.length,
            pos + " “" + b.label + "”的门列表无效");
        b.doors.forEach((door, j) => validateLabel(door, pos + ".doors[" + j + "]", true));
    }
    for (const [i, n] of d.nodes.entries()) rejectRetired(n, "nodes[" + i + "].", ["yard", "at"]);
    check(d.inputs && typeof d.inputs === "object" && !Array.isArray(d.inputs), "inputs 缺失");
    check(d.fields && typeof d.fields === "object" && !Array.isArray(d.fields), "fields 缺失");
    for (const [i, node] of d.geoNodes.entries()) {
        const f = node.function;
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
    const routing = numeric.routing;
    check(routing && (["sampleStep", "gradeWindow", "overlapLength"] as const).every(k => positive(routing[k])) &&
    (["landing", "clearLead", "viaTolerance"] as const).every(k => routing[k] == null || Number.isFinite(routing[k]) && routing[k] >= 0) &&
    (["profilePasses", "profileRadius", "relaxPasses"] as const).every(k => Number.isSafeInteger(routing[k]) && routing[k] >= 0), "道路采样、平滑或转角参数无效");
    for (const grade of ["street", "path", "stair"]) {
        const rule = d.roadClasses?.[grade];
        check(rule && positive(rule.minRadius) && positive(rule.cornerRadius), "“" + grade + "”的道路半径无效");
    }
    for (const object of [d, ...d.buildings, ...d.edges, ...d.nodes, ...d.geoNodes]) {
        check(!Object.hasOwn(object, "prompt") || typeof object.prompt === "string", "描述必须是字符串");
        if (object.prompt === "") delete object.prompt;
    }
    const validPoints = (list: unknown, min = 2) => Array.isArray(list) && list.length >= min && list.every(point);
    const v = d.vegetation, fraction = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
    check(v && v.density && fraction(v.density.natural) && Object.keys(v.density).length === 1, "vegetation.density 无效");
    check(Array.isArray(v.rooms) && [...v.rooms, v.yardTree].every(disk => disk && point(disk.center) && Number.isFinite(disk.radius) && disk.radius >= 0), "vegetation 圆形范围无效");
    for (const list of [v.plantings, v.clearings]) check(Array.isArray(list) && list.every(a => a.id && typeof a.name === "string") && new Set(list.map(a => a.id)).size === list.length, "植被区域 ID 或名称无效");
    for (const [i, a] of v.plantings.entries()) rejectRetired(a, "vegetation.plantings[" + i + "].", ["zones"]);
    for (const [i, c] of v.clearings.entries()) rejectRetired(c, "vegetation.clearings[" + i + "].", ["zone"]);
    for (const a of v.plantings) {
        check(typeof (a.natural ?? false) === "boolean" && Number.isFinite(a.feather ?? 0) && (a.feather ?? 0) >= 0, "“" + a.name + "”的地形或种植区域无效");
        check(validPoints(a.points, 3) && simpleBoundary(a.points) && fraction(a.density) && fraction(a.clump) && point(a.size) && positive(a.size[0]) && a.size[1] >= a.size[0] &&
      ["mixed", "avenue", "small", "shrub", "forest"].includes(a.species) && typeof a.rows === "boolean" && positive(a.spacing), "“" + a.name + "”的绿化设置无效");
    }
    for (const c of v.clearings) {
        const shape = c.shape;
        check(shape, "“" + c.name + "”的空地位置无效");
        if (shape.type !== "polygon") check(Number.isSafeInteger(shape.samples) && shape.samples >= 3, "“" + c.name + "”的边界采样数无效");
        check(shape.type === "polygon" ? validPoints(shape.points, 3) && simpleBoundary(shape.points) : point(shape.center) &&
      (shape.type === "ellipse" ? point(shape.radii) && shape.radii.every(positive) : shape.type === "sector" && Number.isFinite(shape.inner) && shape.inner >= 0 && shape.outer > shape.inner && positive(shape.outer) && Number.isFinite(shape.start) && Number.isFinite(shape.end) && shape.end > shape.start && shape.end - shape.start <= 360), "“" + c.name + "”的空地边界无效");
    }
    for (const [i, b] of numeric.buildings.entries()) {
        const pos = "buildings[" + i + "]";
        check(point(b.center), pos + ".center 只能填写数字坐标");
        check(b.titleOffset == null || point(b.titleOffset), pos + ".titleOffset 只能填写数字坐标");
        check(["rect", "ring", "circle"].includes(b.shape) && (b.shape === "rect" ?
            point(b.size) && b.size.every(positive) && Number.isFinite(b.angle) : positive(b.radius)), pos + " “" + b.label + "”的占地无效");
        check(positive(b.height) && (b.angle == null || Number.isFinite(b.angle)), pos + " “" + b.label + "”的建筑属性无效");
        if (b.shape === "ring") check(b.inner! > 0 && b.inner! < b.radius!, pos + " “" + b.label + "”的回廊半径无效");
        for (const door of b.doors) check(b.shape === "rect" ? Number.isInteger(door.wall) && door.wall! >= 0 && door.wall! < 4 &&
      Number.isFinite(door.t) && door.t! >= 0 && door.t! <= 1 : Number.isFinite(door.angle), pos + " “" + b.label + "”的门位无效");
    }
    for (const [i, n] of numeric.nodes.entries()) {
        const pos = "nodes[" + i + "]";
        if (n.point !== undefined) check(point(n.point), pos + ".point 只能填写数字坐标");
        check(["door", "junction", "endpoint", "viewpoint"].includes(n.type) && (n.directionMode === undefined || ["manual", "auto"].includes(n.directionMode)) && Number.isFinite(n.direction), pos + " “" + n.label + "”的节点类型或朝向无效");
        for (const pair of [n.through, ...(n.otherThrough ?? [])].filter((pair): pair is RoadPair => !!pair)) {
            const [before, after] = pair;
            check(n.type === "junction" && Array.isArray(pair) && pair.length === 2 && before !== after &&
        d.edges.some(e => e.id === before && e.to === n.id) && d.edges.some(e => e.id === after && e.from === n.id), pos + " “" + n.label + "”的直通记录无效");
        }
        try {
            check(point(nodePose(numeric, n).point), "坐标无效");
        }
        catch {
            throw new Error(pos + " “" + n.label + "”的坐标或入口引用无效");
        }
    }
    for (const [i, e] of numeric.edges.entries()) {
        const pos = "edges[" + i + "]";
        check(validPoints(e.via, 0), pos + ".via 只能填写数字坐标");
        check((e.mode == null || roadModes.includes(e.mode)) && (e.segments == null || Array.isArray(e.segments) && e.segments.length === e.via.length + 1 && e.segments.every(seg => seg == null || typeof seg === "object" && (seg.mode == null || roadModes.includes(seg.mode)) && (seg.exactEnd == null || typeof seg.exactEnd === "boolean"))), pos + " “" + e.label + "”的分段设置无效");
        check(e.from !== e.to && [e.from, e.to].every(id => d.nodes.some(n => n.id === id)), pos + " “" + e.label + "”的端点无效");
        check(d.roadClasses![e.grade] && [e.width, e.comfort, e.maxGrade, e.corridor].every(v => Number.isFinite(v) && v > 0) && validPoints(e.via, 0), pos + " “" + e.label + "”的选线参数无效");
    }
    for (const s of d.sections) check(validPoints(s.points) && s.points.length === 2 && distance(...s.points) > 0, "剖面线长度无效");
    return d;
}
export const roadModes: RoadMode[] = ["route", "smooth", "straight"];
export const segmentMode = (edge: Pick<Edge, "segments" | "mode">, i: number) => edge.segments?.[i]?.mode ?? edge.mode ?? "route";
export const throughPairs = (node: Pick<RoadNode, "through" | "otherThrough">) => [node.through, ...(node.otherThrough ?? [])].filter((pair): pair is RoadPair => !!pair);
export function serializeDesign(d: Design | null) {
    const terrain = new Set<object>(d?.geoNodes);
    return JSON.stringify(d, function (this: object, key: string, value: unknown) {
        if (key === "prompt" && value === "" || key === "disabled" && value === false ||
            key === "showLabel" && value === !terrain.has(this)) return undefined;
        return value;
    }, 2);
}