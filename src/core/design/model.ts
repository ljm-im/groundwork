import { type Design, type Edge, type RoadNode, type RoadMode, type RoadPair } from "./v5.ts";
import { distance, radians } from "../math/geometry.ts";
import { doorPose } from "./shapes.ts";
import { simpleBoundary } from "../math/polygon.ts";
import { check, point, positive, validateGeo } from "./validateGeo.ts";

export { corners, buildingShape, moveDoorOrPoint as moveNode } from "./shapes.ts";
export function nodePose(design: Pick<Design, "nodes" | "buildings">, node: Pick<RoadNode, "point" | "type" | "building" | "door" | "direction"> | string) {
    if (typeof node === "string") node = design.nodes.find(n => n.id === node)!;
    const pose = doorPose(design, node);
    if (node.type === "door") pose.normal = pose.angle;
    if (node.direction != null) pose.angle = node.direction * radians;
    return pose;
}

export function parseDesign(text: unknown): Design {
    const d: Design = typeof text === "string" ? JSON.parse(text) : structuredClone(text);
    check(d && typeof d === "object", "不支持的版本");
    check(![1, 2, 3, 4].includes(d.version), "暂不支持 v4 设计，等待迁移");
    check(d.version === 5, "不支持的版本");
    function rejectRetired(value: object, path: string, names: string[]) {
        for (const name of names) check(!Object.hasOwn(value, name), path + name + " 已从 v5 移除");
    }
    rejectRetired(d, "", ["levels", "levelControls", "coast", "ridges", "peaks", "zones", "erosion", "yards"]);
    check(positive(d.grid?.step), "网格参数无效");
    rejectRetired(d.grid, "grid.", ["xMin", "xMax", "yMin", "yMax"]);
    check(Number.isSafeInteger(d.seed), "种子无效");
    for (const key of ["geoNodes", "buildings", "nodes", "edges", "sections"] as const) {
        const list = d[key];
        check(Array.isArray(list), key + " 缺失");
        const seen = new Set<string>();
        list.forEach((item, i) => {
            check(item && typeof item.id === "string" && item.id && typeof item.name === "string" && !seen.has(item.id), key + "[" + i + "].id 缺失或重复");
            seen.add(item.id);
        });
    }
    check(Array.isArray(d.labels), "labels 缺失");
    for (const [i, label] of d.labels.entries()) rejectRetired(label, "labels[" + i + "].", ["level"]);
    for (const [i, b] of d.buildings.entries()) rejectRetired(b, "buildings[" + i + "].", ["zone"]);
    for (const [i, n] of d.nodes.entries()) rejectRetired(n, "nodes[" + i + "].", ["yard", "at"]);
    validateGeo(d);
    const routing = d.routing;
    check(routing && (["sampleStep", "gradeWindow", "overlapLength"] as const).every(k => positive(routing[k])) &&
    (["landing", "clearLead", "viaTolerance"] as const).every(k => routing[k] == null || Number.isFinite(routing[k]) && routing[k] >= 0) &&
    (["profilePasses", "profileRadius", "relaxPasses"] as const).every(k => Number.isSafeInteger(routing[k]) && routing[k] >= 0), "道路采样、平滑或转角参数无效");
    for (const grade of ["street", "path", "stair"]) {
        const rule = d.roadClasses?.[grade];
        check(rule && positive(rule.minRadius) && positive(rule.cornerRadius), grade + " 的道路半径无效");
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
        check(typeof (a.natural ?? false) === "boolean" && Number.isFinite(a.feather ?? 0) && (a.feather ?? 0) >= 0, a.name + " 的地形或种植区域无效");
        check(validPoints(a.points, 3) && simpleBoundary(a.points) && fraction(a.density) && fraction(a.clump) && point(a.size) && positive(a.size[0]) && a.size[1] >= a.size[0] &&
      ["mixed", "avenue", "small", "shrub", "forest"].includes(a.species) && typeof a.rows === "boolean" && positive(a.spacing), a.name + " 的绿化设置无效");
    }
    for (const c of v.clearings) {
        const shape = c.shape;
        check(shape, c.name + " 的空地位置无效");
        if (shape.type !== "polygon") check(Number.isSafeInteger(shape.samples) && shape.samples >= 3, c.name + " 的边界采样数无效");
        check(shape.type === "polygon" ? validPoints(shape.points, 3) && simpleBoundary(shape.points) : point(shape.center) &&
      (shape.type === "ellipse" ? point(shape.radii) && shape.radii.every(positive) : shape.type === "sector" && Number.isFinite(shape.inner) && shape.inner >= 0 && shape.outer > shape.inner && positive(shape.outer) && Number.isFinite(shape.start) && Number.isFinite(shape.end) && shape.end > shape.start && shape.end - shape.start <= 360), c.name + " 的空地边界无效");
    }
    for (const b of d.buildings) {
        check(["rect", "ring", "circle"].includes(b.shape) && point(b.center) && (b.shape === "rect" ?
            point(b.size) && b.size.every(positive) && Number.isFinite(b.angle) : positive(b.radius)), b.name + " 的占地无效");
        check(typeof b.name === "string" && positive(b.height) && (b.titleOffset == null || point(b.titleOffset)) &&
      (b.showTitle == null || typeof b.showTitle === "boolean") && (b.angle == null || Number.isFinite(b.angle)), b.name + " 的建筑属性无效");
        check(Array.isArray(b.doors) && new Set(b.doors.map(door => door.id)).size === b.doors.length, b.name + " 的门列表无效");
        if (b.shape === "ring") check(b.inner! > 0 && b.inner! < b.radius!, b.name + " 的回廊半径无效");
        for (const door of b.doors) check(b.shape === "rect" ? Number.isInteger(door.wall) && door.wall! >= 0 && door.wall! < 4 &&
      Number.isFinite(door.t) && door.t! >= 0 && door.t! <= 1 : Number.isFinite(door.angle), b.name + " 的门位无效");
    }
    for (const n of d.nodes) {
        check(["door", "junction", "endpoint", "viewpoint"].includes(n.type) && (n.direction == null || Number.isFinite(n.direction)), n.name + " 的节点类型或朝向无效");
        for (const pair of [n.through, ...(n.otherThrough ?? [])].filter((pair): pair is RoadPair => !!pair)) {
            const [before, after] = pair;
            check(n.type === "junction" && Array.isArray(pair) && pair.length === 2 && before !== after &&
        d.edges.some(e => e.id === before && e.to === n.id) && d.edges.some(e => e.id === after && e.from === n.id), n.name + " 的直通记录无效");
        }
        try {
            check(point(nodePose(d, n).point), "坐标无效");
        }
        catch {
            throw new Error(n.name + " 的坐标或入口引用无效");
        }
    }
    for (const e of d.edges) {
        check((e.mode == null || roadModes.includes(e.mode)) && (e.segments == null || Array.isArray(e.segments) && e.segments.length === e.via.length + 1 && e.segments.every(seg => seg == null || typeof seg === "object" && (seg.mode == null || roadModes.includes(seg.mode)) && (seg.exactEnd == null || typeof seg.exactEnd === "boolean"))), e.name + " 的分段设置无效");
        check(e.from !== e.to && [e.from, e.to].every(id => d.nodes.some(n => n.id === id)), e.name + " 的端点无效");
        check(d.roadClasses![e.grade] && [e.width, e.comfort, e.maxGrade, e.corridor].every(v => Number.isFinite(v) && v > 0) && validPoints(e.via, 0), e.name + " 的选线参数无效");
    }
    for (const s of d.sections) check(validPoints(s.points) && s.points.length === 2 && distance(...s.points) > 0, "剖面线长度无效");
    return d;
}
export const roadModes: RoadMode[] = ["route", "smooth", "straight"];
export const segmentMode = (edge: Edge, i: number) => edge.segments?.[i]?.mode ?? edge.mode ?? "route";
export const throughPairs = (node: Pick<RoadNode, "through" | "otherThrough">) => [node.through, ...(node.otherThrough ?? [])].filter((pair): pair is RoadPair => !!pair);
export const serializeDesign = (d: unknown) => JSON.stringify(d, (key, value: unknown) => key === "prompt" && value === "" ? undefined : value, 2);