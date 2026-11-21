import { type Point, type Design, type Edge, type Ellipse, type Sector, type Yard } from "../src/core/design/types.ts";
import { type Alignment } from "../src/core/design/results.ts";
import { type ImportDesign } from "../src/core/design/migrations/legacy.ts";
import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { performance } from "node:perf_hooks";
import { advance, angleDiff, bearing, createGrid, distance, nearest, pointAt, radians, sample, stations } from "../src/core/math/geometry.ts";
import { radiusAt, exemptRadius } from "../src/core/roads/alignment.ts";
import { addDoor, canPlaceBuilding, doorRoads, placeBuilding, removeBuildingPart, rotateBuilding, setShape, titlePoint } from "../src/core/edit/buildings.ts";
import { History } from "../src/core/edit/history.ts";
import { Island } from "../src/core/island.ts";
import { moveNode, nodePose, parseDesign, serializeDesign, zonePolygon } from "../src/core/design/model.ts";
import { labelReading } from "../src/render/map.ts";
import { moveHandle } from "../src/core/edit/controls.ts";
import { profile } from "../src/core/roads/profiles.ts";
import { clearLead, routeAll, routeEdge } from "../src/core/roads/routing.ts";
import { selfOverlaps, sharpBends } from "../src/core/roads/proximity.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { armBearing, summitHeights, validateDesign, validateRoads } from "../src/core/checks/validation.ts";
import { addGate, addNode, connect, removeLinks, splitRoad } from "../src/core/edit/topology.ts";
import { hedgeLines } from "../src/core/edit/yards.ts";
import { gateDistance, gateFraction, gatePose } from "../src/core/design/gates.ts";
import { insidePolygon, perimeter } from "../src/core/math/polygon.ts";

const previousDefault = await readFixture("round4.json");
const raw = serializeDesign(parseDesign(previousDefault)),
    design = parseDesign(raw);
const timings: Record<string, number> = {};

function time<T>(name: string, fn: () => T) {
    const t = performance.now(),
        result = fn();
    timings[name] = +(performance.now() - t).toFixed(1); return result;
}
console.log("第一至四轮回归夹具，共", design.edges.length, "条道路");
const model = time("首次生成（含侵蚀、植被、路网及校验）", () => new Island(design));
const again = new Island(parseDesign(raw));
assert.deepEqual(model.terrain.heights, again.terrain.heights);
assert.deepEqual(model.graded.heights, again.graded.heights);
const changed = structuredClone(design);
changed.seed++;
assert.notDeepEqual(generateTerrain(changed).heights, model.terrain.heights);
assert.deepEqual(JSON.parse(serializeDesign(parseDesign(raw))), JSON.parse(raw));
const broken = structuredClone(design);
broken.edges[0].from = "missing";
assert.throws(() => parseDesign(JSON.stringify(broken)));

assert(!Object.hasOwn(design, "fixedRoads"));
assert(design.nodes.every(n => !Object.hasOwn(n, "fixedRoad")));
assert.equal(model.routes.length, design.edges.length);
const converted = ["street", "lane", "east-link", "west-link", "quay-steps", "pier", "east-west", "north-south"];
assert(converted.every(id => model.routes.some(r => r.id === id)));
const street: unknown = JSON.parse(await readFixture("street-v1.json"));
assert(Array.isArray(street) && street.every((p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));
const circuit = model.routes.filter(r => r.edge.name.startsWith("生活街环街"));
assert(circuit.every((r, i) => r.edge.mode === "smooth" && (!i || circuit[i - 1].edge.to === r.edge.from)));
const centerline = circuit.flatMap((r, i) => i ? r.points.slice(1) : r.points), oldS = stations(street), newS = stations(centerline);
const deviations = [
    Math.max(...street.map((p, i) => distance(p, pointAt(centerline, newS, newS.at(-1)! * oldS[i] / oldS.at(-1)!)))),
    Math.max(...street.map(p => nearest(...p, centerline).distance)), Math.max(...centerline.map(p => nearest(...p, street).distance))
];
assert(deviations.every(m => m <= 1), "环街偏差超过1m");
console.log("环街等比例里程、旧到新、新到旧最大偏差/m", deviations.map(m => m.toFixed(3)).join(" / "));
assert(!/"direction"\s*:/.test(raw) && !("doorLead" in design.routing));
assert(!model.issues.some(i => ["sharp-bend", "self-overlap"].includes(i.kind)), "默认路网出现急弯或自身重叠");
assert.equal(model.issues.filter(i => i.kind === "no-route" || i.kind === "overlap").length, 0);
assert(!model.issues.some(i => i.kind === "turn-radius"));
assert(!model.issues.some(i => i.severity === "error" && model.routes.slice(0, 8).some(r => r.id === i.road)), "原有八条选线路径应通过硬性校验");
assert(model.issues.every(i => i.point.every(Number.isFinite)));
for (const route of model.routes) {
    const { edge, parts } = route;
    assert.deepEqual(route.points[0], nodePose(design, edge.from).point);
    assert.deepEqual(route.points.at(-1)!, nodePose(design, edge.to).point);
    for (let i = 1; i < route.points.length - 1; i++) {
        const a = route.points[i - 1],
            b = route.points[i],
            c = route.points[i + 1];
        const radius = radiusAt(a, b, c);
        if (edge.id === "fork-garden" || !exemptRadius(route, i, route.s, design))
            assert(radius + 1e-5 >= design.roadClasses[edge.grade].minRadius, edge.name + " 转弯半径 " + radius);
    }
    assert(edge.via.every(p => nearest(...p, route.points).distance <= design.routing.viaTolerance! + 1e-6));
    for (const [index, part] of parts.entries()) {
        assert(!part.failed, edge.name);
        const a = part.points[0],
            b = part.points.at(-1)!;
        for (const p of part.points) assert(nearest(...p, [a, b]).distance <= edge.corridor + 1e-6, edge.name + " 越出走廊");
        if (index) {
            const prev = parts[index - 1].points;
            assert(distance(prev.at(-1)!, a) < 1e-7);
            if (parts[index - 1].index !== part.index && edge.segments?.[parts[index - 1].index]?.exactEnd)
                assert(angleDiff(bearing(prev.at(-2)!, a), bearing(a, part.points[1])) < 1e-5, edge.name + " 途经点切线不连续");
        }
    }
    for (const [id, part] of [
        [edge.from, parts[0]],
        [edge.to, parts.at(-1)!]
    ] as const) {
        const n = design.nodes.find(n => n.id === id)!, pose = nodePose(design, n);
        if (!["gate", "door"].includes(n.type)) continue;
        const clearance = clearLead(n, edge, design.routing);
        assert.equal(clearance, edge.width / 2 + .5);
        const lead = advance(pose.point, pose.normal!, clearance);
        assert(distance(id === edge.from ? part.points.at(-1)! : part.points[0], lead) < 1e-8);
        for (const p of part.points) assert(nearest(...p, [pose.point, lead]).distance < 1e-7);
        const points = id === edge.from ? route.points : [...route.points].reverse(), s = stations(points);
        const headings = [pose.angle!];
        for (let i = 1; i < s.length && s[i - 1] < clearance + 3 - 1e-8; i++) {
            if (s[i] > clearance + 1e-8) headings.push(bearing(points[i - 1], points[i]));
        }
        assert(headings.every(a => headings.every(b => angleDiff(a, b) <= 30 * radians + 1e-7)), n.name + " 离墙后3m转向超限");
    }
}
const plazaShape = design.zones.find(z => z.id === "plaza")!.shape as Ellipse;
const plazaRoute = model.routes.find(r => r.edge.from === "plaza")!, [px, py] = plazaRoute.points[0];
const [cx, cy] = plazaShape.center, [rx, ry] = plazaShape.radii;
assert(Math.abs(((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 - 1) < 1e-9);
const plazaNormal = Math.atan2((py - cy) / ry ** 2, (px - cx) / rx ** 2);
const forest = model.routes.find(r => r.id === "forest")!;
for (const [r, expected] of [[plazaRoute, plazaNormal], [forest, bearing(...circuit.at(-1)!.points.slice(-2) as [Point, Point])]] as const) {
    const actual = bearing(r.points[0], pointAt(r.points, r.s, 2));
    assert(angleDiff(expected, actual) <= 5 * radians);
    console.log(r.edge.name, "最初2m朝向偏差", (angleDiff(expected, actual) / radians).toFixed(2) + "°");
}
console.table(model.routes.map(r => ({
    道路: r.edge.name,
    "长度 m": +r.length.toFixed(1),
    "落差 m": +r.drop.toFixed(1),
    "最陡 %": +(r.maxGrade * 100).toFixed(1),
    台阶段数: r.stairRuns,
    "台阶 m": +r.stairLength.toFixed(1),
    绕路比: +r.detour.toFixed(2),
    校验: model.issues.filter(i => i.road === r.id || i.other === r.id).map(i => i.message).join(" / ") || "通过"
})));
time("全部重新选线", () => model.reroute());
const previous = model.routes.slice(),
    points = new Set(["forest"]);
time("单条边重算（林间路）", () => model.reroute(points));
assert.notEqual(model.routes.find(r => r.id === "forest")!, previous.find(r => r.id === "forest")!);
assert.equal(model.routes.find(r => r.id === "lighthouse")!, previous.find(r => r.id === "lighthouse")!);
const originalLines = model.routes.map(r => r.points);
design.levels.H += .5;
time("标高预览（保持线形）", () => model.levels());
assert(model.routes.every((r, i) => r.points === originalLines[i]));
model.levels(true);
assert.deepEqual(model.graded.heights, new Island(structuredClone(design)).graded.heights, "编辑后保存并重开应恢复同一地形");
console.table(timings);

const moved = parseDesign(raw),
    door = { type: "door" as const, building: "house", door: "front" },
    house = moved.buildings.find(b => b.id === door.building)!;
const initial = nodePose(moved, door);
house.center = house.center.map((v, i) => v + [5, 2][i]) as Point;
const translated = nodePose(moved, door);
assert(distance(translated.point, initial.point.map((v, i) => v + [5, 2][i]) as Point) < 1e-8);
moveNode(moved, door, [house.center[0] + 100, house.center[1]]);
const exterior = nodePose(moved, door),
    unit = advance(exterior.point, exterior.angle!, 1);
assert(distance(unit, house.center) > distance(exterior.point, house.center));
const shared = moved.nodes.find(n => n.id === "street-north")!, target: Point = [-28, 19];
assert(shared.through!.length === 2 && moved.edges.filter(e => e.from === shared.id || e.to === shared.id).length === 3);
moveNode(moved, shared, target);
assert.deepEqual(nodePose(moved, shared).point, target);
assert.equal(nodePose(moved, "garden-in").angle!, null);
const entrance = moved.nodes.find(n => n.id === "plaza")!;
moveNode(moved, entrance, [cx, cy + ry + 20]);
assert(distance(nodePose(moved, entrance).point, [cx, cy + ry]) < 1e-7);
assert(angleDiff(nodePose(moved, entrance).angle!, Math.PI / 2) < 1e-8);
const tower = moved.buildings.find(b => b.id === "light")!, lampDoor = moved.nodes.find(n => n.id === "light")!;
moveNode(moved, lampDoor, [tower.center[0] - 20, tower.center[1]]);
assert(distance(nodePose(moved, lampDoor).point, [tower.center[0] - tower.radius!, tower.center[1]]) < 1e-8);
assert(angleDiff(nodePose(moved, lampDoor).angle!, Math.PI) < 1e-8);
const portal = again.design.edges.find(e => e.to === "gate-se")!,
    front = nodePose(again.design, portal.to);
const onLead = advance(front.point, front.angle!, 1);
const split = routeEdge(again.design, again.terrain, { ...portal, via: [onLead] });
assert(split.parts.every(p => !p.failed));
assert(split.points.some(p => distance(p, onLead) < 1e-8));
const unsplit = again.routes.find(r => r.id === portal.id)!.points;
assert(Math.abs(stations(split.points).at(-1)! - stations(unsplit).at(-1)!) < 1e-8);
assert(split.points.every(p => nearest(...p, unsplit).distance < 1e-8));

const hist = new History(moved, 50);
for (let i = 0; i < 55; i++) {
    moved.seed = i;
    hist.record(moved);
}
for (let i = 0; i < 50; i++) assert(hist.step(false));
assert(!hist.canUndo);
assert.equal(hist.step(true)!.seed, 5);
moved.seed = 900;
hist.record(moved);
assert(!hist.canRedo);

const half = parseDesign(raw);
half.grid.step = .5;
const fine = generateTerrain(half);
assert.equal(fine.grid.size, 4 * again.terrain.grid.size);
assert(fine.heights.every(Number.isFinite));
assert(Number.isFinite(sample(fine.grid, fine.heights, half.grid.xMax, half.grid.yMax)));
assert(routeAll(half, fine).every(r => r.parts.every(p => !p.failed)));
for (const [x, y] of [
    [48, 0],
    [48, 26],
    [40, 46]
]) {
    let shore = x;
    while (shore < design.grid.xMax && again.terrain.land[again.terrain.grid.index(shore, y)]) shore++;
    assert(shore - x >= 20 && shore - x <= 25, "默认东坡到海岸应为 20–25 m");
}
const testDesign = parseDesign(raw),
    edge = { ...testDesign.edges[2], from: "ocean-a", to: "ocean-b", via: [] };
testDesign.nodes.push({ id: "ocean-a", name: "ocean-a", type: "junction", point: [-135, 105] }, { id: "ocean-b", name: "ocean-b", type: "junction", point: [-125, 105] });
const fallback = profile(testDesign, again.terrain, routeEdge(testDesign, again.terrain, edge));
assert(fallback.parts.some(p => p.failed));
assert(validateRoads(testDesign, again.terrain, [fallback]).some(i => i.kind === "no-route"));
for (const p of fallback.points) assert(nearest(...p, fallback.controls).distance < 1e-8);

// Synthetic geometry isolates the physical overlap length, the shared-junction exemption,
// the four-metre grade window and the stairs that a street cannot accommodate.
const synthetic = parseDesign(raw);
synthetic.nodes = ["a", "b", "c", "d"].map((id, i) => ({ id, name: id, type: "junction", point: [
    [0, 0],
    [20, 0],
    [0, 2],
    [20, 2]
][i] as Point }));
const grid = createGrid({ xMin: -10, xMax: 35, yMin: -10, yMax: 20, step: 1 });
const flat = { grid, heights: new Float32Array(grid.size).fill(5), buildings: [], zones: [] };
const road = (id: string, from: string, to: string, pts: Point[], extra: Partial<Edge> = {}) => profile(synthetic, flat, {
    id,
    edge: { ...synthetic.edges[0], id, name: id, from, to, width: 2, grade: "path", ...extra },
    points: pts,
    controls: [pts[0], pts.at(-1)!],
    parts: []
});
const aRoad = road("a-b", "a", "b", [
    [0, 0],
    [10, 0],
    [20, 0]
]);
const bRoad = road("c-d", "c", "d", [
    [0, 2],
    [10, 2],
    [20, 2]
]);
assert(validateRoads(synthetic, flat, [aRoad, bRoad]).some(i => i.kind === "overlap"));
const fork = road("a-d", "a", "d", [
    [0, 0],
    [1, 1],
    [2, 2],
    [2, 12]
]);
assert(!validateRoads(synthetic, flat, [aRoad, fork]).some(i => i.kind === "overlap"));
const short = road("c-d", "c", "d", [
    [8, 2.99],
    [9, 2.99]
]);
assert(!validateRoads(synthetic, flat, [aRoad, short]).some(i => i.kind === "overlap"));
assert(!validateRoads(synthetic, flat, [short, aRoad]).some(i => i.kind === "overlap"));
const onLimit = road("on-limit", "c", "d", [
    [0, 3],
    [20, 3]
]);
assert(!validateRoads(synthetic, flat, [aRoad, onLimit]).some(i => i.kind === "overlap"));
const justEnough = road("enough", "c", "d", [
    [6, 2],
    [9, 2]
]);
assert(validateRoads(synthetic, flat, [aRoad, justEnough]).some(i => i.kind === "overlap"));
const headingLine = (gap: number, degrees: number) => {
    const a: Point = [0, 0], b: Point = [1, 0], c = advance(b, degrees * radians, gap);
    return [a, b, c, advance(c, 2 * degrees * radians, 1)];
};
assert(!sharpBends(headingLine(3.01, 24)).length);
assert(sharpBends(headingLine(2.99, 24)).length);
assert(!sharpBends(headingLine(2, 22.5)).length);
const crossing: Point[] = [[0, 0], [12, 10], [0, 10], [12, 0]];
assert(selfOverlaps(crossing, 2).length);
assert(!selfOverlaps([[0, 0], [2, 0], [0, 0]], 2).length, "沿路距离刚好两倍路宽");
assert(!selfOverlaps([[0, 0], [20, 0]], 2).length);
const parallel = (y: number): Point[] => [[0, 0], [20, 0], [30, 3], [32, 10], [24, 16], [14, 12], [10, y], [0, y]];
assert(selfOverlaps(parallel(2.99), 2).some(p => p[0] < 11));
assert(!selfOverlaps(parallel(3), 2).some(p => p[0] < 10));
const crossingRoad = road("crossing", "a", "d", crossing);
assert(validateRoads(synthetic, flat, [crossingRoad]).some(i => i.kind === "self-overlap" && i.severity === "error"));
assert(validateRoads(synthetic, flat, [crossingRoad]).some(i => i.kind === "sharp-bend" && i.severity === "notice"));
const approach = structuredClone(synthetic);
const smallYard: Yard & { points: Point[] } = { id: "test-yard", name: "Test yard", zone: "test", points: [[0, -1], [1, -1], [1, 1], [0, 1]] };
approach.yards = [smallYard];
approach.buildings = [{ id: "tower", name: "Tower", height: 2, color: "gray", shape: "circle", center: [14, 0], radius: 1, doors: [{ id: "base", angle: 0 }] }];
approach.nodes = [
    { id: "west", name: "west", type: "gate", yard: smallYard.id, at: gateFraction(smallYard, [0, 0]) },
    { id: "east", name: "east", type: "door", building: "tower", door: "base" }
];
const opposite = { ...design.edges[0], id: "opposing", from: "west", to: "east", width: 2, corridor: 10, via: [] };
approach.edges = [opposite];
const ground = { ...flat, clearance: new Float32Array(grid.size).fill(20) };
const opposing = profile(approach, ground, routeEdge(approach, ground, opposite));
assert.equal(distance(opposing.points[0], opposing.points.at(-1)!), 15);
assert(angleDiff(nodePose(approach, "west").angle!, nodePose(approach, "east").angle!) > Math.PI - 1e-7);
assert(opposing.parts.every(part => !part.failed));
const collided = selfOverlaps(opposing.points, opposite.width);
const reported = validateRoads(approach, ground, [opposing]).filter(i => i.kind === "self-overlap");
assert.equal(reported.length, collided.length);
assert(reported.every(i => i.severity === "error"));
console.log("相距15m的反向门", collided.length ? "重选后保留并报自身重叠" : "无自身重叠");
const loopEdge: Edge = { ...opposite, id: "compulsory-loop", from: "a", to: "b",
    via: [[9, 0], [15, 6], [9, 12], [3, 6], [9, 0]] };
const forced = profile(synthetic, ground, routeEdge(synthetic, ground, loopEdge));
assert(forced.parts.every(part => !part.failed));
assert(validateRoads(synthetic, ground, [forced]).some(i => i.kind === "self-overlap" && i.severity === "error"));
const steps = road("street", "a", "b", [
    [0, 0],
    [10, 0],
    [20, 0]
], { grade: "street", stairs: true });
assert(validateRoads(synthetic, flat, [steps]).some(i => i.kind === "street-stairs"));
flat.heights = Float32Array.from(flat.heights, (_, i) => 5 + grid.point(i)[0] * .75);
const steep = road("steep", "a", "b", Array.from({ length: 21 }, (_, i) => [i, 0]), { grade: "stair" });
assert(steep.maxGrade > .7);
assert(validateRoads(synthetic, flat, [steep]).some(i => i.kind === "stair-grade"));
// An L-shaped passable strip forces a 90-degree turn well outside the two end landings.
const flights: Design = { ...synthetic, nodes: [
    { id: "base", name: "base", type: "junction", point: [-4.5, .5] }, { id: "top", name: "top", type: "junction", point: [6.5, 10.5] }
] };
const stairEdge = { ...opposite, from: "base", to: "top" };
const ravine = { grid, clearance: new Float32Array(grid.size), heights: new Float32Array(grid.size) };
for (let i = 0; i < grid.size; i++) {
    const [x, y] = grid.point(i);
    if (y === .5 && x >= -4.5 && x <= 6.5 || x === 6.5 && y >= .5 && y <= 10.5) ravine.clearance[i] = 1;
    ravine.heights[i] = 9 + .4 * (x + y);
}
const elbow = profile(flights, ravine, routeEdge(flights, ravine, stairEdge));
assert(elbow.parts.every(p => !p.failed));
assert.deepEqual(elbow.platforms, [11]);
assert.equal(elbow.stairRuns, 2);
for (const i of [10, 11]) {
    assert(Math.abs(elbow.h[i] - elbow.h[i + 1]) < 1e-8);
    assert.equal(elbow.stairs[i], false);
}
const narrow = profile(flights, ravine, { ...elbow, edge: { ...stairEdge, width: .4 } });
const treadStart = narrow.s.findIndex(at => Math.abs(at - 10.8) < 1e-8), treadEnd = narrow.s.findIndex(at => Math.abs(at - 11.2) < 1e-8);
assert(treadStart >= 0 && treadEnd > treadStart && Math.abs(narrow.h[treadStart] - narrow.h[treadEnd]) < 1e-8);
assert(routeEdge(flights, ravine, { ...stairEdge, grade: "path" }).parts.some(p => p.failed));
ravine.heights.fill(5);
assert(routeEdge(flights, ravine, stairEdge).parts.some(p => p.failed));
const yard = again.design.yards![0] as Yard & { points: Point[] }, gates = again.design.nodes.filter(n => n.yard === yard.id);
assert.deepEqual(yard.points, zonePolygon(again.design.zones.find(z => z.id === yard.zone)!.shape));
assert.equal(gates.length, 4);
const boundary = perimeter(yard), gaps = [];
for (const [i, gate] of gates.entries()) {
    const pose = nodePose(again.design, gate);
    assert(Math.abs(sample(again.terrain.grid, again.graded.heights, ...pose.point) - again.design.levels.H) < 1e-6);
    assert(nearest(...pose.point, yard.points, true).distance < 1e-8);
    assert(!insidePolygon(yard, advance(pose.point, pose.angle!, .1)));
    for (const other of gates.slice(i + 1)) gaps.push(gateDistance(gate, other, boundary.length));
}
assert(Math.min(...gaps) >= 6);
assert(again.terrain.yards[0].cells.every(k => again.graded.heights[k] === again.design.levels.H));
for (const r of again.routes) for (const p of r.points) {
    assert(!insidePolygon(yard, p) || nearest(...p, yard.points, true).distance < 1e-7, r.edge.name + " 进入院内");
}
assert(!again.design.nodes.some(n => n.building === "house"));
assert.deepEqual((again.design.vegetation.clearings.find(c => c.id === "grove-opening")!.shape as Sector).center, nodePose(again.design, door).point);
const square: { points: Point[] } = { points: [[0, 0], [12, 0], [12, 12], [0, 12]] };
for (const polygon of [square, { points: [...square.points].reverse() }]) {
    for (const p of [[0, 6], [6, 0], [0, 0]] as Point[]) {
        const pose = gatePose(polygon, gateFraction(polygon, p));
        assert(distance(pose.point, p) < 1e-7 && !insidePolygon(polygon, advance(p, pose.angle!, .2)));
    }
}
const walls = hedgeLines(square, [{ id: "opening", name: "Opening", type: "gate", at: 0 }], []);
assert(walls.every(line => nearest(0, 0, line).distance >= 1.7));
const arc = perimeter(square).length;
assert.equal(gateDistance({ at: .98 }, { at: .02 }, arc).toFixed(2), "1.92");
const edited = parseDesign(raw), editedYard = edited.yards![0] as Yard & { points: Point[] };
const endpoint = edited.nodes.find(n => n.id === "hill")!, added = addGate(edited, editedYard, endpoint);
const position = added.gate.at;
assert.equal(position, gateFraction(editedYard, endpoint.point!));
moveNode(edited, endpoint, [0, 20]);
assert.equal(added.gate.at, position);
moveNode(edited, added.gate, yard.points[9]);
const at = added.gate.at, original = nodePose(edited, added.gate).point, p9 = yard.points[9];
moveHandle(edited, { kind: "yard", id: yard.id, index: 9 }, [p9[0], p9[1] + 1]);
assert.equal(added.gate.at, at);
assert(distance(original, nodePose(edited, added.gate).point) > .4);
parseDesign(serializeDesign(edited));
added.gate.at = gates[0].at;
const beside = nodePose(edited, added.gate).point;
edited.buildings.find(b => b.id === "shed")!.center = beside;
const crowded = new Island(edited);
assert(crowded.issues.some(i => i.kind === "gate-spacing" && i.severity === "notice"));
assert(crowded.issues.some(i => i.kind === "gate-building" && i.severity === "error"));

const lighthouse = again.design.buildings.find(b => b.summit)!;
const summit = summitHeights(again.terrain.grid, again.graded.heights, lighthouse.center);
assert(Math.abs(summit.ground - again.design.levels.L) <= 1);
assert(summit.highest - summit.ground < 1e-6);
assert(!again.issues.some(i => i.kind === "summit"));
const peak = again.design.peaks.find(p => distance(p.center, lighthouse.center) < 1)!;
const nearby = again.terrain.grid.index(...lighthouse.center);
assert(again.terrain.cliff[nearby] >= peak.cliffMin! - 1e-6 && again.terrain.erosionWeight[nearby] < .03);
const lowered = parseDesign(raw);
lowered.buildings.find(b => b.summit)!.center = [-60, -37];
const low = new Island(lowered);
assert(low.issues.some(i => i.kind === "summit" && i.severity === "error"));
const lab = lowered.labels.find(l => l.building === "light")!, label = labelReading(low, lab);
assert.equal(label.actual, sample(low.terrain.grid, low.graded.heights, ...lowered.buildings.find(b => b.summit)!.center));
assert.equal(label.difference, "（设计 27m）");
const exact = { ...low, graded: { ...low.graded, heights: new Float32Array(low.terrain.grid.size).fill(26.5) } };
assert.equal(labelReading(exact, lab).difference, "");
assert(again.issues.some(i => i.kind === "zone-height" && i.zone === "garden" && i.severity === "notice"));

const forkNode = again.design.nodes.find(n => n.id === "gallery-fork")!;
const main = forkNode.through!.map(id => again.routes.find(r => r.id === id)!);
const branch = again.routes.find(r => r.edge.from === forkNode.id && !main.includes(r))!;
const arms = main.map(r => armBearing(r, forkNode.id));
const mainAngle = 180 - angleDiff(arms[0], arms[1]) / radians;
const branchAngle = Math.min(...arms.map(a => angleDiff(armBearing(branch, forkNode.id), a))) / radians;
const galleryFraction = main[1].length / (main[0].length + main[1].length);
assert(mainAngle <= 10 && branchAngle >= 30 && Math.abs(galleryFraction - 1 / 3) < .05);
assert(angleDiff(bearing(...main[0].points.slice(-2) as [Point, Point]), bearing(...main[1].points.slice(0, 2) as [Point, Point])) < 1e-7);
const shallow = { ...main[1], id: branch.id, edge: branch.edge };
assert(validateDesign(again.design, again.terrain, again.graded.heights, [...main, shallow]).some(i => i.kind === "branch-angle"));
const backwards = { ...again.design, edges: [...again.design.edges].reverse() };
for (const r of routeAll(backwards, again.terrain)) assert.deepEqual(r.points, again.routes.find(saved => saved.id === r.id)!.points);
console.log("灯塔基座/25m最高点", summit.ground.toFixed(2), summit.highest.toFixed(2), "最小院门间距", Math.min(...gaps).toFixed(2),
    "主路方向差", mainAngle.toFixed(2), "支路最小夹角", branchAngle.toFixed(2), "回廊侧占比", galleryFraction.toFixed(3));

const cutDesign = parseDesign(raw), cutIsland = new Island(cutDesign);
const garden = cutIsland.routes.find(r => r.id === branch.id)!;
const mid = garden.parts.find(p => p.index === 1)!.points[3];
const oldVia = structuredClone(garden.edge.via);
const cut = splitRoad(cutDesign, garden, mid, 1)!;
cutIsland.reroute(new Set(cut.through));
assert.deepEqual(cut.through!.flatMap(id => cutDesign.edges.find(e => e.id === id)!.via), oldVia);
for (const id of cut.through!) {
    const half = cutIsland.routes.find(r => r.id === id)!;
    assert(half.parts.every(p => !p.failed));
    for (const key of ["grade", "width", "corridor", "comfort", "maxGrade"] as const) assert.equal(half.edge[key], garden.edge[key]);
}
const intoGate = cutIsland.routes.find(r => r.id === portal.id)!;
const shortCut = splitRoad(cutDesign, intoGate, onLead, 0)!;
cutIsland.reroute(new Set(shortCut.through));
const pieces = shortCut.through!.map(id => cutIsland.routes.find(r => r.id === id)!);
assert(pieces.every(r => r.parts.every(p => !p.failed)));
assert(Math.abs(pieces[0].length + pieces[1].length - intoGate.length) < 1e-7);
const two = pieces[1];
const next = splitRoad(cutDesign, two, pointAt(two.points, two.s, .5), 0)!;
cutIsland.reroute(new Set(next.through));
assert(cutIsland.routes.every(r => r.parts.every(p => !p.failed)));
assert.deepEqual(parseDesign(serializeDesign(cutDesign)), cutDesign);
const trunk = cutIsland.routes.find(r => r.id === forkNode.through![0])!;
const trunkPart = trunk.parts.find(p => p.points.length > 6)!;
const splitTrunk = splitRoad(cutDesign, trunk, trunkPart.points[4], trunkPart.index)!;
const nextFork = cutDesign.nodes.find(n => n.id === forkNode.id)!;
assert.equal(nextFork.through![0], splitTrunk.through![1]);
cutIsland.reroute(new Set(splitTrunk.through));
assert.deepEqual(cutIsland.routes.map(r => r.points), new Island(structuredClone(cutDesign)).routes.map(r => r.points));
const invalidThrough = structuredClone(cutDesign);
invalidThrough.nodes.find(n => n.through)!.through!.reverse();
assert.throws(() => parseDesign(serializeDesign(invalidThrough)), /直通/);
const dirty = removeLinks(cutDesign, new Set([cut.through![0]]));
cutIsland.reroute(dirty);
assert(!cut.through);
assert.deepEqual(parseDesign(serializeDesign(cutDesign)), cutDesign);
const legacy = parseDesign(raw);
delete legacy.yards;
legacy.nodes = legacy.nodes.filter(n => n.type !== "gate" && !n.through);
legacy.edges = legacy.edges.filter(e => [e.from, e.to].every(id => legacy.nodes.some(n => n.id === id)));
assert.deepEqual(parseDesign(serializeDesign(legacy)), legacy);
const oldFormat: ImportDesign = parseDesign(raw);
oldFormat.version = 1;
oldFormat.edges = []; oldFormat.nodes = [{ id: "end", name: "旧街尾", type: "endpoint", fixedRoad: "old", vertex: street.length - 1, direction: -15 }];
oldFormat.fixedRoads = [{ id: "old", name: "旧环街", points: street, grade: "street", width: 3 }];
const upgraded = parseDesign(serializeDesign(oldFormat));
assert.equal(upgraded.version, 4);
assert(!Object.hasOwn(upgraded, "fixedRoads"));
assert.deepEqual(nodePose(upgraded, "end").point, street.at(-1)!);
assert.equal(nodePose(upgraded, "end").angle!, -15 * radians);
assert.equal(upgraded.edges[0].to, "end");
assert.deepEqual(parseDesign(serializeDesign(upgraded)), upgraded);
const ring = structuredClone(design);
ring.nodes = [[0, 0], [20, 0], [20, 14], [0, 14]].map((point, i) => ({
    id: String(i), name: String(i), type: "junction", point: point as Point, through: ["r" + ((i + 3) % 4), "r" + i]
}));
ring.edges = ring.nodes.map((n, i) => ({ ...garden.edge, id: "r" + i, from: n.id, to: ring.nodes[(i + 1) % 4].id, via: [] }));
const plain = { grid, heights: new Float32Array(grid.size).fill(5), clearance: new Float32Array(grid.size).fill(20) };
const loop = routeAll(ring, plain);
for (const [i, r] of loop.entries()) {
    assert(r.parts.every(p => !p.failed));
    assert(angleDiff(bearing(...r.points.slice(-2) as [Point, Point]), bearing(...loop[(i + 1) % 4].points.slice(0, 2) as [Point, Point])) < 1e-7);
}
// Geometry of each mode is measured on the sampled line that is actually profiled and drawn.
const elbowDesign = structuredClone(synthetic);
elbowDesign.nodes = [{ id: "a", name: "a", type: "endpoint", point: [0, 0] }, { id: "b", name: "b", type: "endpoint", point: [12, 12] }];
const rightAngle: Edge = { ...opposite, id: "elbow", from: "a", to: "b", via: [[12, 0]], mode: "straight", grade: "path" };
const corner = routeEdge(elbowDesign, plain, rightAngle);
const filletPoints = corner.parts.filter(p => p.round).flatMap((p, i) => i ? p.points.slice(1) : p.points);
assert(filletPoints.length >= 5);
for (let i = 1; i + 1 < filletPoints.length; i++)
    assert(Math.abs(radiusAt(...filletPoints.slice(i - 1, i + 2) as [Point, Point, Point]) - 2) < 1e-7);
for (const part of corner.parts.filter(p => !p.round))
    for (const p of part.points)
        assert(nearest(...p, [part.points[0], part.points.at(-1)!]).distance <= .01);
const gap = nearest(12, 0, corner.points).distance;
assert(gap > .5 && gap <= elbowDesign.routing.viaTolerance!);
const exactAngle = { ...rightAngle, segments: [{ exactEnd: true }, {}] };

function checkTangent(route: Alignment, via: Point, epsilon = 1e-5) {
    const at = route.points.findIndex(p => distance(p, via) < 1e-8);
    assert(at > 0 && at < route.points.length - 1, "精确途经点缺失");
    const [a, b, c] = route.points.slice(at - 1, at + 2);
    assert(angleDiff(bearing(a, b), bearing(b, c)) <= epsilon, "精确途经点切线不连续");
}

checkTangent(routeEdge(elbowDesign, plain, exactAngle), [12, 0], 2e-5);
const mixed: Edge = { ...rightAngle, via: [[8, 0]], segments: [{ exactEnd: true }, { mode: "smooth" }] };
checkTangent(routeEdge(elbowDesign, plain, mixed), [8, 0]);
for (const mode of ["smooth", "route"] as const) {
    const route = routeEdge(elbowDesign, plain, { ...rightAngle, mode, via: [[7, 3]], segments: [{ exactEnd: true }, {}] });
    checkTangent(route, [7, 3]);
    assert(route.parts.every(p => !p.failed));
}
elbowDesign.nodes.push({ id: "j", name: "j", type: "junction", point: [12, 0], through: ["one", "two"] });
elbowDesign.edges = [{ ...rightAngle, id: "one", to: "j", via: [] }, { ...rightAngle, id: "two", from: "j", via: [] }];
const [firstArm, secondArm] = routeAll(elbowDesign, plain);
assert.deepEqual(firstArm.points.at(-1)!, secondArm.points[0]);
const joined = [...firstArm.parts.at(-1)!.points, ...secondArm.parts[0].points.slice(1)];
assert(joined.length >= 5 && joined.slice(1, -1).every((p, i) => Math.abs(radiusAt(joined[i], p, joined[i + 2]) - 2) < 1e-7));
for (const r of again.routes.filter(r => r.edge.mode === "straight"))
    assert(r.points.every(p => nearest(...p, [r.points[0], r.points.at(-1)!]).distance <= .01));
assert(validateRoads(synthetic, flat, [road("tight", "a", "b", [[0, 0], [1, 0], [1, 1]])]).some(i => i.kind === "turn-radius"));
const incline = { ...plain, buildings: [], zones: [], heights: Float32Array.from(plain.heights, (_, i) => 10 + plain.grid.point(i)[0] * .55) };
for (const mode of ["straight", "smooth"] as const) {
    const edge: Edge = { ...rightAngle, via: [], mode, grade: "street" };
    const r = profile(elbowDesign, incline, routeEdge(elbowDesign, incline, edge));
    assert(validateRoads(elbowDesign, incline, [r]).some(i => i.kind === "ramp-grade"));
    assert.equal(r.stairRuns, 0);
}
const bypassGrid = createGrid({ xMin: -10, yMin: -28, xMax: 56, yMax: 28, step: 1 });
const obstacle = { grid: bypassGrid, heights: new Float32Array(bypassGrid.size).fill(5),
    clearance: Float32Array.from({ length: bypassGrid.size }, (_, i) => {
        const [x, y] = bypassGrid.point(i); return Math.hypot(x - 20, y) - 4;
    }) };
const detourDesign: Design = { ...synthetic, nodes: [{ id: "a", name: "a", type: "endpoint", point: [0, 0] }, { id: "b", name: "b", type: "endpoint", point: [45, 0] }] };
for (const grade of ["path", "street"]) {
    const edge: Edge = { ...rightAngle, grade, mode: "route", via: [], corridor: 15, width: 2.5 };
    const r = routeEdge(detourDesign, obstacle, edge);
    assert(r.parts.every(part => !part.failed));
    assert(r.points.every(p => sample(bypassGrid, obstacle.clearance, ...p) >= edge.width / 2));
    assert(r.points.slice(1, -1).every((p, i) => radiusAt(r.points[i], p, r.points[i + 2]) + 1e-5 >= detourDesign.roadClasses[grade].minRadius));
}
const editedTown = parseDesign(raw), changes = new History(editedTown), site: Point = [22, 41];
assert(canPlaceBuilding(again, site));
assert(!canPlaceBuilding(again, again.design.buildings[0].center));
assert(!canPlaceBuilding(again, again.routes.find(r => r.id === "east-west")!.points[5]));
const cottage = placeBuilding(editedTown, site);
assert.deepEqual(cottage.size, [8, 6]);
assert.deepEqual(titlePoint(editedTown, cottage), site);
let land = generateTerrain(editedTown);
const centerCell = land.grid.index(...site), sideCell = land.grid.index(28, 41);
assert(land.padMask[centerCell] && land.clearance[centerCell] < 0 && !land.padMask[sideCell]);
moveHandle(editedTown, { kind: "building", id: cottage.id, role: "size" }, [29.5, 45]);
land = generateTerrain(editedTown);
assert(land.padMask[sideCell] && land.clearance[sideCell] < 0);
moveHandle(editedTown, { kind: "building", id: cottage.id, role: "body" }, [23, 42]);
moveHandle(editedTown, { kind: "building", id: cottage.id, role: "title" }, [23, 48]);
assert.deepEqual(cottage.titleOffset, [0, 6]);
cottage.name = "山径小屋";
cottage.height = 5;
cottage.showTitle = false;
const doorEnd = addDoor(editedTown, cottage, 1), doorData = cottage.doors[0];
moveHandle(editedTown, { kind: "node", id: doorEnd.id }, [31, 44]);
assert.equal(doorData.wall, 1);
assert(doorData.t! > 0 && doorData.t! < 1);
setShape(editedTown, cottage, "circle");
const roundDoor = nodePose(editedTown, doorEnd).point;
rotateBuilding(cottage, 45);
assert(Math.abs(distance(cottage.center, roundDoor) - cottage.radius!) < 1e-8);
assert(distance(roundDoor, nodePose(editedTown, doorEnd).point) > 1);
setShape(editedTown, cottage, "rect");
const neighbour = addNode(editedTown, [40, 50]), access = connect(editedTown, doorEnd, neighbour);
const doorPosition = nodePose(editedTown, doorEnd).point;
assert.deepEqual(doorRoads(editedTown, cottage).map(e => e.id), [access.id]);
changes.record(editedTown);
const withBuilding = serializeDesign(editedTown);
assert.equal(serializeDesign(parseDesign(withBuilding)), withBuilding);
removeBuildingPart(editedTown, cottage);
changes.record(editedTown);
const vacant = new Island(editedTown);
assert(!vacant.terrain.padMask[centerCell] && vacant.terrain.clearance[centerCell] > 0);
assert(editedTown.edges.includes(access) && doorEnd.type === "endpoint");
assert.deepEqual(nodePose(editedTown, doorEnd).point, doorPosition);
assert(vacant.issues.some(i => i.node === doorEnd.id && i.kind === "detached-door" && i.message.includes("端点未接建筑")));
const restored = changes.step(false)!;
assert.equal(serializeDesign(restored), withBuilding);
assert.deepEqual(new Island(restored).terrain.padMask, generateTerrain(parseDesign(withBuilding)).padMask);
assert.deepEqual(changes.step(true)!, editedTown);
const restoredCottage = restored.buildings.find(b => b.id === cottage.id)!;
removeBuildingPart(restored, restoredCottage, restoredCottage.doors[0]);
assert(restored.buildings.includes(restoredCottage) && !restoredCottage.doors.length && restored.edges.some(e => e.id === access.id));
console.log("通过：迁移与环街偏差、全边转弯半径、分段取直、路口倒角、软/精确途经点、建筑与门、场地整平、撤销重做和文件往返");
console.log("通过：端点方向、途经点、急弯、自身重叠、楼梯平台、区域与分岔、峰顶与标注、文件往返、增量计算、撤销及0.5m网格");

await import("./round5.ts");
await import("./round6.ts");
await import("./round7.ts");
await (await import("./golden.ts")).checkSnapshots();