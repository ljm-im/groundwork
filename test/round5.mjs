import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { nearbyWall, openDoorAt, removeBuildingPart } from "../src/core/buildings.js";
import { moveHandle } from "../src/core/controls.js";
import { advance, distance, nearest, pointAt, radians, stations } from "../src/core/geometry.js";
import { History } from "../src/core/history.js";
import { Island } from "../src/core/island.js";
import { issueShapes, objectIssues } from "../src/core/issues.js";
import { addFeature, deleteFeature, featureHit, featureLine, insertVertex } from "../src/core/landforms.js";
import { IslandMap } from "../src/render/map.js";
import { buildingShape, clearingShape, nodePose, parseDesign, serializeDesign } from "../src/core/model.js";
import { render } from "svelte/server";
import Network from "../src/app/Network.svelte";
import { overlappingLocations } from "../src/core/proximity.js";
import { addNode, connect } from "../src/core/topology.js";
import { inClearing } from "../src/core/vegetation.js";

const original = await readFixture("round5.json");
const author = parseDesign(original), baseline = new Island(author);
const current = await readFixture("round5-default.json");
const design = parseDesign(current), island = new Island(design);
const counts = {};
for (const issue of baseline.issues)
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
assert.deepEqual(counts, { "ramp-grade": 12, "turn-radius": 9, "stair-grade": 1, "no-route": 1, "sharp-bend": 2, wall: 3, "zone-height": 5 });
assert.equal(author.nodes.length, 33);
assert.equal(author.edges.length, 27);
assert.deepEqual(JSON.parse(serializeDesign(design)), JSON.parse(current));
assert.deepEqual(parseDesign(serializeDesign(author)), author);
// Validate station bounds independently against every contiguous run of offending intervals.
for (const route of baseline.routes) {
    const rule = author.roadClasses[route.edge.grade];
    for (const kind of ["ramp-grade", "stair-grade"]) {
        let start = null;
        const expected = [];
        for (let i = 0; i <= route.stairs.length; i++) {
            const limit = kind === "stair-grade" ? rule.stairLimit : rule.rampLimit;
            const fails = limit != null && i < route.stairs.length && route.stairs[i] === (kind === "stair-grade") && route.peaks[i] > limit;
            if (fails && start == null)
                start = route.s[i];
            if (!fails && start != null) {
                expected.push([start, route.s[i]]);
                start = null;
            }
        }
        const issues = baseline.issues.filter(i => i.kind === kind && i.road === route.id);
        assert.deepEqual(issues.map(i => [i.spans[0].from, i.spans[0].to]), expected);
        for (const issue of issues) {
            const [span] = issue.spans, [shape] = issueShapes(baseline, issue);
            assert.deepEqual(shape.points[0], pointAt(route.points, route.s, span.from));
            assert.deepEqual(shape.points.at(-1), pointAt(route.points, route.s, span.to));
            assert(nearest(...issue.point, shape.points).distance < 1e-6);
        }
    }
}
const selected = baseline.issues.find(i => i.kind === "ramp-grade" && i.road === "street-4");
const view = Object.assign(Object.create(IslandMap.prototype), {
    island: baseline, width: 1000, height: 700, zoom: 1, layers: { issues: true }, draw() { }, clearIssue() {
        this.activeIssue = null;
    }
});
const previousFrame = globalThis.requestAnimationFrame;
try {
    globalThis.requestAnimationFrame = () => 1;
    view.focusIssue(selected);
    assert(distance(view.center, selected.point) < 5);
    const screen = view.screen(selected.point);
    assert(view.issueHits([screen[0] + 11.9, screen[1]]).includes(selected));
    assert(!view.issueHits([screen[0] + 12.1, screen[1]]).includes(selected));
    assert.equal(view.activeIssue, selected);
}
finally {
    if (previousFrame)
        globalThis.requestAnimationFrame = previousFrame;
    else
        delete globalThis.requestAnimationFrame;
}
const ui = { island: baseline, tab: "network", selection: { kind: "edge", id: selected.road }, issue: selected };
const { body: markup } = render(Network, { props: { editor: ui } });
assert(markup.indexOf("对象校验") >= 0 && markup.indexOf("对象校验") < markup.indexOf("路线长度"));
assert(markup.match(/<button[^>]*>/g).some(tag => tag.includes("issue-row is-selected") && tag.includes("data-issue=\"" + baseline.issues.indexOf(selected) + "\"")));
const a = { id: "a", points: [[0, 0], [30, 0]], edge: { width: 2 } }, b = { id: "b", points: [[8, 2], [20, 2]], edge: { width: 2 } };
for (const line of [a, b])
    line.s = stations(line.points);
const [overlap] = overlappingLocations(a, b, [], { clearance: 1, junctionRadius: 4, overlapLength: 5 }, true);
assert.deepEqual(overlap.spans.map(s => s.road), ["a", "b"]);
assert(Math.abs(overlap.spans[0].from - (8 - Math.sqrt(5))) < 1e-8);
assert(Math.abs(overlap.spans[0].to - (20 + Math.sqrt(5))) < 1e-8);
assert.deepEqual(overlap.spans[1], { road: "b", from: 0, to: 12 });
const structure = author.buildings.find(b => b.id === "studio");
const footprintIssue = { building: structure.id, point: structure.center, kind: "building" };
assert.deepEqual(issueShapes(baseline, footprintIssue)[0], { points: buildingShape(structure).polygon, closed: true });
assert(objectIssues({ ...baseline, issues: [footprintIssue] }, { kind: "building", id: structure.id }).includes(footprintIssue));
// Rebuild through the production Island constructor including erosion at each history step.
const sculpt = parseDesign(original), history = new History(sculpt);
const peak = addFeature(sculpt, "peak", [[14, 53]], { level: "B", offset: 12 });
history.record(sculpt);
const withPeak = new Island(sculpt).terrain.heights;
assert.notDeepEqual(withPeak, baseline.terrain.heights);
const ridge = addFeature(sculpt, "ridge", [[-11, 55], [-1, 68], [16, 74]], [10, { level: "B", offset: 21 }, 10]);
ridge.widths = [12, 15];
history.record(sculpt);
const initial = new Island(sculpt).terrain.heights;
assert.notDeepEqual(initial, withPeak);
const handle = { kind: "ridge", id: ridge.id, role: "vertex", index: 1 };
deleteFeature(sculpt, handle);
history.record(sculpt);
const withoutVertex = new Island(sculpt).terrain.heights;
assert.notDeepEqual(withoutVertex, initial);
assert.deepEqual(new Island(history.step(false)).terrain.heights, initial);
assert.deepEqual(new Island(history.step(true)).terrain.heights, withoutVertex);
let restored = history.step(false);
const originalRidge = restored.ridges.at(-1), samplePoint = featureLine(restored, "ridge", originalRidge)[4];
const hit = featureHit(restored, "ridge", originalRidge, samplePoint);
const inserted = insertVertex(restored, handle, hit);
assert.equal(inserted, 1);
assert.deepEqual(originalRidge.points[inserted].point, samplePoint);
deleteFeature(restored, { ...handle, index: inserted });
assert.deepEqual(new Island(restored).terrain.heights, initial);
deleteFeature(restored, { kind: "ridge", id: ridge.id });
assert.deepEqual(new Island(restored).terrain.heights, withPeak);
deleteFeature(restored, { kind: "peak", id: peak.id });
assert.deepEqual(new Island(restored).terrain.heights, baseline.terrain.heights);
// Physical doors share the snapped wall pose with the routing node.
const town = parseDesign(original), junction = town.nodes.find(n => n.id === "east-west-路口");
const wall = nearbyWall(town, [33, -45.2]);
assert.equal(wall.building.id, "studio");
const entry = openDoorAt(town, wall), edge = connect(town, junction, entry);
const pose = nodePose(town, entry);
assert.deepEqual(pose.point, [33, -46]);
assert(Math.abs(pose.normal - Math.PI / 2) < 1e-8);
assert(buildingShape(wall.building).signedDistance(...advance(pose.point, pose.normal, .2)) > 0);
assert.equal(nodePose(town, edge.to).angle, pose.normal);
assert.equal(openDoorAt(town, wall).id, entry.id);
const free = addNode(town, [31, -42.5]);
connect(town, junction, free);
connect(town, free, entry);
const edges = structuredClone(town.edges);
const drop = [38.7, -50];
moveHandle(town, { kind: "node", id: free.id }, drop);
openDoorAt(town, nearbyWall(town, drop), free);
assert.equal(free.type, "door");
assert.deepEqual(town.edges, edges);
assert(Math.abs(nodePose(town, free).normal) < 1e-8);
const townIsland = new Island(town), route = townIsland.routes.find(r => r.id === edge.id);
assert(distance(route.points.at(-1), pose.point) < 1e-8);
removeBuildingPart(town, wall.building, wall.building.doors.find(door => door.id === free.door));
assert.equal(free.type, "endpoint");
assert.deepEqual(town.edges, edges);
const round = nearbyWall(town, [-80, 14.9]), roundDoor = openDoorAt(town, round), radial = nodePose(town, roundDoor);
assert(Math.abs(distance(radial.point, round.building.center) - round.building.radius) < 1e-8);
assert(Math.abs(radial.normal - 90 * radians) < 1e-8);
assert.deepEqual(parseDesign(serializeDesign(town)), town);
const clearing = author.vegetation.clearings.find(c => c.id === "grove-opening");
assert(clearing && !("view" in author.vegetation));
assert(!author.labels.some(label => label.name === "家的视线"));
const garden = new Island(parseDesign(original));
deleteFeature(garden.design, { kind: "clearing", id: clearing.id });
garden.replant();
const openingTrees = trees => trees.filter(t => inClearing(clearingShape(author, clearing), t.point) && t.wooded);
assert(openingTrees(garden.trees).length > openingTrees(baseline.trees).length);
const inner = design.vegetation.plantings.find(a => a.id === "inner-garden");
const avenue = design.vegetation.plantings.find(a => a.id === "ring-avenue");
assert.equal(inner.density, .35);
assert.equal(avenue.spacing, 6);
const small = island.trees.filter(t => t.planting === inner.id);
assert(small.every(t => inClearing({ type: "polygon", points: inner.points }, t.point)));
assert.deepEqual(new Set(small.map(t => t.species)), new Set(["small", "shrub"]));
const rows = island.trees.filter(t => t.planting === avenue.id && t.row);
assert(rows.length >= 3 && rows.every(t => t.species === "avenue"));
const boundary = [...avenue.points, avenue.points[0]], chain = stations(boundary), length = chain.at(-1);
const spacing = length / Math.round(length / avenue.spacing);
assert(Math.abs(spacing - 6) < .3);
for (const t of rows) {
    const foot = nearest(...t.point, boundary), station = chain[foot.segment] + foot.t * (chain[foot.segment + 1] - chain[foot.segment]);
    assert(foot.distance < 1e-8 && Math.abs((station / spacing - .5) - Math.round(station / spacing - .5)) < 1e-7);
}
let minRoad = Infinity, minBuilding = Infinity;
for (const t of island.trees) {
    for (const r of island.routes)
        minRoad = Math.min(minRoad, nearest(...t.point, r.points).distance - r.edge.width / 2);
    for (const b of island.terrain.buildings)
        minBuilding = Math.min(minBuilding, b.signedDistance(...t.point));
}
assert(minRoad >= 1.5 && minBuilding >= 2);
const added = addFeature(garden.design, "planting", [[3, 38], [10, 42], [11, 35]]);
added.rows = true;
added.density = .8;
assert.deepEqual(parseDesign(serializeDesign(garden.design)), garden.design);
console.log("第五轮作者原稿校验", counts);
console.log("第五轮通过：问题里程和定位、地形重建与撤销、外墙开门与保路、旧空地迁移、绿化边距与文件往返");
console.log("全图树木", island.trees.length, "内环", small.length, "边缘行道树", rows.length, "沿边株距/m", spacing.toFixed(3), "最小路面/建筑净距/m", minRoad.toFixed(3), minBuilding.toFixed(3));