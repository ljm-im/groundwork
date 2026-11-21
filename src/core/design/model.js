import { bearing, bounds, distance, radians } from "../math/geometry.js";
import { migrateDesign } from "./migrations/v1ToV2.js";
import { upgradeWoodlands } from "./migrations/v3ToV4.js";
import { areaBoundary, clearingShape, nodePose, zonePolygon } from "./shapes.js";
import { simpleBoundary } from "../edit/yards.js";

export { zoneNoise, elevation, zonePolygon, corners, buildingShape, areaBoundary, nodePose, moveNode, clearingShape } from "./shapes.js";

// Older terrain files kept the opening in the grove relative to a particular door.
function upgradeLandscape(d) {
    if (d?.version !== 2)
        return d;
    const rules = d.vegetation, view = rules.view;
    for (const [i, peak] of d.peaks.entries()) {
        peak.id ??= "peak-" + (i + 1);
        peak.name ??= peak.id;
    }
    for (const ridge of d.ridges)
        ridge.name ??= ridge.id;
    for (const [i, clearing] of rules.clearings.entries()) {
        clearing.id ??= "clearing-" + (i + 1);
        clearing.name ??= (d.zones.find(z => z.id === clearing.zone)?.name ?? "") + "空地";
    }
    if (view) {
        const origin = d.nodes.find(n => n.id === view.from) ??
      (d.buildings.some(b => b.id === view.building && b.doors.some(door => door.id === view.door))
          ? { type: "door", building: view.building, door: view.door } : null);
        const target = d.zones.find(z => z.id === view.targetZone)?.shape;
        if (origin && target && rules.grove) {
            const center = nodePose(d, origin).point.slice(), box = bounds(zonePolygon(target));
            const angle = bearing(center, target.center ?? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]) / radians;
            const home = d.zones.find(z => z.id === rules.grove.zone).shape.center;
            const radius = Math.max(view.length, distance(home, center) + rules.grove.radius[1]);
            let id = "grove-opening";
            while (rules.clearings.some(c => c.id === id))
                id += "-1";
            rules.clearings.push({ id, name: "家旁林间空地", cover: "ambient", shape: {
                type: "sector", center, outer: radius, inner: 0, start: angle - view.halfAngle, end: angle + view.halfAngle, samples: 24
            } });
        }
        d.labels = d.labels.filter(label => label.building || label.name !== "家的视线");
        delete rules.view;
    }
    rules.plantings ??= [];
    d.version = 3;
    return d;
}

export function parseDesign(text) {
    const d = upgradeLandscape(migrateDesign(JSON.parse(text)));
    const check = (ok, message) => {
        if (!ok) throw new Error(message);
    };
    const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
    const positive = n => Number.isFinite(n) && n > 0;
    check(d?.version === 3 || d?.version === 4, "不支持的版本");
    const g = d.grid;
    check(g && [g.xMin, g.xMax, g.yMin, g.yMax, g.step].every(Number.isFinite) && g.step > 0, "网格参数无效");
    for (const span of [g.xMax - g.xMin, g.yMax - g.yMin]) {
        check(span / g.step >= 8 && Math.abs(span / g.step - Math.round(span / g.step)) < 1e-6, "范围必须由完整的网格单元组成");
    }
    check(Number.isSafeInteger(d.seed) && Object.values(d.levels).every(Number.isFinite), "种子或标高无效");
    const routing = d.routing;
    check(routing && ["sampleStep", "gradeWindow", "overlapLength"].every(k => positive(routing[k])) &&
    ["landing", "clearLead", "viaTolerance"].every(k => routing[k] == null || Number.isFinite(routing[k]) && routing[k] >= 0) &&
    ["profilePasses", "profileRadius", "relaxPasses"].every(k => Number.isSafeInteger(routing[k]) && routing[k] >= 0), "道路采样、平滑或转角参数无效");
    for (const grade of ["street", "path", "stair"]) {
        const rule = d.roadClasses?.[grade];
        check(rule && positive(rule.minRadius) && positive(rule.cornerRadius), grade + " 的道路半径无效");
    }
    check(d.erosion && Number.isSafeInteger(d.erosion.droplets) && d.erosion.droplets >= 0 && positive(d.erosion.radius), "侵蚀参数无效");
    for (const [key, control] of Object.entries(d.levelControls)) {
        check(Object.hasOwn(d.levels, key) && control.length === 4 && control[2] > control[1] && positive(control[3]), "标高控件无效");
    }
    for (const key of ["zones", "buildings", "nodes", "edges", "ridges", "sections"]) {
        check(Array.isArray(d[key]) && new Set(d[key].map(o => o.id)).size === d[key].length, key + " 缺失或含有重复 ID");
    }
    const validPoints = (list, min = 2) => Array.isArray(list) && list.length >= min && list.every(point);
    const yards = d.yards ?? [];
    check(Array.isArray(yards) && new Set(yards.map(y => y.id)).size === yards.length, "院落列表无效或含有重复 ID");
    for (const y of yards) {
        check(d.zones.some(z => z.id === y.zone), y.name + " 的台地无效");
        check(["yard", "plaza"].includes(y.kind ?? "yard"), y.name + " 的区域类型无效");
        const boundary = areaBoundary(d, y);
        check(validPoints(boundary.points, 3) && simpleBoundary(boundary.points), y.name + " 的边界必须是简单多边形");
        if (y.kind !== "plaza") check(Array.isArray(y.buildings) && y.buildings.every(id => d.buildings.some(b => b.id === id)), y.name + " 的所属建筑无效");
    }
    const validHeight = h => Number.isFinite(h) || h && Object.hasOwn(d.levels, h.level) && Number.isFinite(h.offset ?? 0);
    check(Array.isArray(d.peaks) && new Set(d.peaks.map(p => p.id)).size === d.peaks.length, "山头 ID 重复或缺失");
    for (const p of d.peaks) {
        check(p.id && typeof p.name === "string" && validHeight(p.height) && Number.isFinite(p.noise) && p.noise >= 0 && positive(p.scale), "山头名称、高度或噪声无效");
        check(point(p.center) && positive(p.radius) && Number.isFinite(p.protect ?? 10) && (p.protect ?? 10) >= 0 && Number.isFinite(p.cliffMin ?? 1.4) && (p.cliffMin ?? 1.4) >= 0, p.name + " 的山头参数无效");
    }
    check(validPoints(d.coast.points, 3), "海岸线控制点不足");
    check(Number.isSafeInteger(d.coast.smooth) && d.coast.smooth > 0, "海岸线采样数无效");
    for (const z of d.zones) {
        const s = z.shape, fade = z.height?.endRise?.fade;
        if (fade != null) check(point(fade) && fade[0] >= 0 && fade[1] > fade[0], z.name + " 的外半径必须大于内半径");
        check(["polygon", "circle", "ellipse", "band", "sector"].includes(s.type), z.name + " 的形状无效");
        check(s.points ? validPoints(s.points, s.type === "polygon" ? 3 : 2) : point(s.center), z.name + " 的坐标无效");
        if (!s.points) check(Number.isSafeInteger(s.samples) && s.samples >= 3, z.name + " 的采样数无效");
        if (s.type === "circle") check(positive(s.radius), z.name + " 的半径无效");
        if (s.type === "ellipse") check(point(s.radii) && s.radii.every(positive), z.name + " 的半轴无效");
        if (s.type === "sector") check(s.inner >= 0 && s.outer > s.inner, z.name + " 的扇环半径无效");
        if (s.type === "band") check(positive(s.width), z.name + " 的带宽无效");
    }
    for (const r of d.ridges) {
        check(typeof r.name === "string" && validPoints(r.points.map(p => p.point)) && r.points.every(p => validHeight(p.height)) && point(r.widths) && r.widths.every(positive), r.name + " 的山脊无效");
    }
    const v = d.vegetation, fraction = n => Number.isFinite(n) && n >= 0 && n <= 1;
    check(v && Object.values(v.density).every(fraction), "区域植树密度无效");
    delete v.scatterPattern;
    if (v.forest) check(point(v.forest.center) && point(v.forest.radii) && v.forest.radii.every(positive) && fraction(v.forest.density), "旧树林参数无效");
    if (v.grove) check(d.zones.some(z => z.id === v.grove.zone && point(z.shape.center)) && point(v.grove.radius) && v.grove.radius[1] > v.grove.radius[0] && v.grove.radius[0] >= 0 &&
    point(v.grove.angles) && v.grove.angles[1] > v.grove.angles[0] && Array.isArray(v.grove.zones) && fraction(v.grove.density), "旧密林参数无效");
    for (const list of [v.plantings, v.clearings]) check(Array.isArray(list) && list.every(a => a.id && typeof a.name === "string") && new Set(list.map(a => a.id)).size === list.length, "植被区域 ID 或名称无效");
    for (const a of v.plantings) {
        check(typeof (a.natural ?? false) === "boolean" && Number.isFinite(a.feather ?? 0) && (a.feather ?? 0) >= 0 &&
      (a.zones == null || Array.isArray(a.zones) && a.zones.every(id => d.zones.some(z => z.id === id))), a.name + " 的地形或种植区域无效");
        check(validPoints(a.points, 3) && simpleBoundary(a.points) && fraction(a.density) && fraction(a.clump) && point(a.size) && positive(a.size[0]) && a.size[1] >= a.size[0] &&
      ["mixed", "avenue", "small", "shrub", "forest"].includes(a.species) && typeof a.rows === "boolean" && positive(a.spacing), a.name + " 的绿化设置无效");
    }
    for (const c of v.clearings) {
        check(c.shape || d.zones.some(z => z.id === c.zone && z.shape.center), "空地位置无效");
        const shape = clearingShape(d, c);
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
        if (b.shape === "ring") check(b.inner > 0 && b.inner < b.radius, b.name + " 的回廊半径无效");
        for (const door of b.doors) check(b.shape === "rect" ? Number.isInteger(door.wall) && door.wall >= 0 && door.wall < 4 &&
      Number.isFinite(door.t) && door.t >= 0 && door.t <= 1 : Number.isFinite(door.angle), b.name + " 的门位无效");
    }
    for (const n of d.nodes) {
        check(["door", "gate", "junction", "endpoint", "viewpoint"].includes(n.type) && (n.direction == null || Number.isFinite(n.direction)), n.name + " 的节点类型或朝向无效");
        if (n.type === "gate") check(yards.some(y => y.id === n.yard) && Number.isFinite(n.at) && n.at >= 0 && n.at < 1, n.name + " 的院落或周长位置无效");
        for (const pair of [n.through, ...(n.otherThrough ?? [])].filter(Boolean)) {
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
        check(d.roadClasses[e.grade] && [e.width, e.comfort, e.maxGrade, e.corridor].every(v => Number.isFinite(v) && v > 0) && validPoints(e.via, 0), e.name + " 的选线参数无效");
    }
    for (const s of d.sections) check(validPoints(s.points) && s.points.length === 2 && distance(...s.points) > 0, "剖面线长度无效");
    return upgradeWoodlands(d);
}
export const roadModes = ["route", "smooth", "straight"];
export const segmentMode = (edge, i) => edge.segments?.[i]?.mode ?? edge.mode ?? "route";
export const throughPairs = node => [node.through, ...(node.otherThrough ?? [])].filter(Boolean);
export const serializeDesign = d => JSON.stringify(d, null, 2);