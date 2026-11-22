import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fixtureOptions, readFixture } from "../configs/read-fixture.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { areaBoundary, corners, nodePose, zonePolygon } from "../src/core/design/shapes.ts";
import { type Point } from "../src/core/design/types.ts";
import { distance, nearest } from "../src/core/math/geometry.ts";
import { insidePolygon } from "../src/core/math/polygon.ts";
import { hedgeLines } from "../src/core/edit/yards.ts";
import { Island } from "../src/core/island.ts";
import { syntheticDesign } from "./scenarios.ts";
import { exportIsland, serializeExport } from "../src/core/export.ts";

const prompt = "  外观保留原样。\n[\n  1,\n  2\n]\t\"门\"  ";
const provenance = (input: string) => ({ sha256: createHash("sha256").update(input).digest("hex"), commit: "a".repeat(40) });

async function loadExample() {
    const design = parseDesign(await readFixture("round6.json"));
    design.prompt = prompt;
    for (const key of ["buildings", "edges", "nodes", "zones"] as const) design[key][0].prompt = key + prompt;
    const input = serializeDesign(design), source = provenance(input);
    const island = new Island(design), result = exportIsland(island, source);
    return { design, input, source, island, result };
}

let example: ReturnType<typeof loadExample>;
function exportTest(name: string, check: (data: Awaited<ReturnType<typeof loadExample>>) => void) {
    test(name, fixtureOptions("round6.json"), async () => check(await (example ??= loadExample())));
}

const round = (n: number) => Number(n.toFixed(3)) || 0;
const plan = (p: number[]): Point => [p[0], p[1]];
const rounded = (p: number[]): Point => [round(p[0]), round(p[1])];

// Reconstruct ground level using only the information available in the exported file.
function ground(p: number[], terrain: ReturnType<typeof exportIsland>["terrain"]) {
    const { origin, step, width, height, heights } = terrain;
    const x = Math.max(0, Math.min(width - 1, (p[0] - origin[0]) / step));
    const y = Math.max(0, Math.min(height - 1, (origin[1] - p[1]) / step));
    const left = Math.floor(x), right = Math.ceil(x), top = Math.floor(y), bottom = Math.ceil(y);
    const north = heights[top][left] + (heights[top][right] - heights[top][left]) * (x - left);
    const south = heights[bottom][left] + (heights[bottom][right] - heights[bottom][left]) * (x - left);
    return north + (south - north) * (y - top);
}

exportTest("independent exports have identical formatted bytes and preserve authored text", ({ design, input, source, island, result }) => {
    const bytes = serializeExport(result);
    const again = exportIsland(new Island(parseDesign(input)), { commit: source.commit, sha256: source.sha256 });
    assert.equal(serializeExport(again), bytes);
    const json = JSON.parse(bytes);
    assert.deepEqual(json.source, source);
    assert.equal(json.format, "groundwork-export");
    assert.equal(json.version, 1);
    assert.equal(json.prompt, prompt);
    for (const [parents, elements] of [[design.buildings, result.buildings], [design.edges, result.roads], [design.nodes, result.nodes], [design.zones, result.areas]] as const) {
        assert.equal(elements.find(e => e.id === parents[0].id)!.prompt, parents[0].prompt);
        assert.equal(Object.hasOwn(elements[1], "prompt"), false);
    }
    for (const elements of [result.buildings, ...result.buildings.map(b => b.doors), result.roads, result.walls, result.hedges, result.areas, result.nodes, result.trees, result.labels, result.issues])
        for (const e of elements) assert(e.id && e.name && e.type);
    assert.match(bytes, /^\{\n  "format"/);
    assert.doesNotMatch(bytes, /\[\n\s+[-\d.]/);
    for (const field of ["routing", "erosion", "levelControls", "angle", "direction", "via", "zones", "radialSlope"])
        assert(!Object.hasOwn(json, field) && !Object.hasOwn(json.buildings[0], field) && !Object.hasOwn(json.roads[0], field));
    assert.equal(serializeDesign(island.design), input);
});

exportTest("the exported grid contains every graded sample and classifies surfaces in priority order", ({ island, result }) => {
    const { terrain, graded } = island, { grid } = terrain, out = result.terrain;
    assert.deepEqual([out.origin, out.step, out.width, out.height, out.rowOrder], [grid.point(0), grid.step, grid.width, grid.height, "north-to-south"]);
    assert.deepEqual(out.surfaceRules.priority, [0, 4, 2, 1, 3]);
    assert.equal(out.heights.length, grid.height);
    assert.equal(out.surface.length, grid.height);
    const paved = new Set([...terrain.pads.flat(), ...terrain.zones.filter(z => z.fill).flatMap(z => z.cells)]);
    const plazas = terrain.yards.filter(y => y.yard.kind === "plaza");
    const seen = new Set<number>();
    for (let j = 0; j < grid.height; j++) {
        assert.equal(out.heights[j].length, grid.width);
        assert.equal(out.surface[j].length, grid.width);
        for (let i = 0; i < grid.width; i++) {
            const k = j * grid.width + i, h = graded.heights[k], step = grid.step;
            const p = grid.point(k);
            assert.equal(out.heights[j][i], round(h));
            const slopeX = (graded.heights[grid.index(p[0] + step, p[1])] - graded.heights[grid.index(p[0] - step, p[1])]) / (i === 0 || i === grid.width - 1 ? step : 2 * step);
            const slopeY = (graded.heights[grid.index(p[0], p[1] + step)] - graded.heights[grid.index(p[0], p[1] - step)]) / (j === 0 || j === grid.height - 1 ? step : 2 * step);
            const slope = Math.hypot(slopeX, slopeY), coast = Math.abs(terrain.dc[k]), rock = terrain.rock[k];
            let expected = 3;
            if (!terrain.land[k] && !terrain.islet[k]) expected = 0;
            else if (paved.has(k) || plazas.some(y => insidePolygon(y.yard, p))) expected = 4;
            else if (terrain.islet[k] || slope > .75 || rock >= .45 && coast <= 8 && slope > .3) expected = 2;
            else if (rock < .35 && coast <= 5 && slope < .3 && h < 2) expected = 1;
            assert.equal(out.surface[j][i], expected);
            seen.add(expected);
        }
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4]);
});

exportTest("profiles, stair segments, trees and validation issues use resolved geometry", ({ design, island, result }) => {
    assert.equal(result.roads.length, design.edges.length);
    for (const road of result.roads) {
        const r = island.routes.find(r => r.id === road.id)!;
        assert.equal(road.type, r.edge.levelDeck ? "road.deck" : "road." + r.edge.grade);
        assert.equal(road.width, round(r.edge.width));
        assert.equal(road.color, r.edge.color);
        assert.deepEqual(road.centerline, r.points.map((p, i) => [...rounded(p), round(r.h[i])]));
        assert.deepEqual(road.stairs, r.stairs);
        assert.equal(road.stairs.length, road.centerline.length - 1);
    }
    assert.equal(result.trees.length, island.trees.length);
    for (const [i, tree] of result.trees.entries()) {
        const t = island.trees[i];
        assert.equal(tree.index, i + 1);
        assert.deepEqual(plan(tree.position), rounded(t.point));
        assert(Math.abs(tree.position[2] - ground(tree.position, result.terrain)) <= .00050000001);
        assert.deepEqual([tree.type, tree.radius, tree.wooded], ["tree." + t.species, round(t.radius), t.wooded]);
    }
    assert.equal(result.issues.length, island.issues.length);
    for (const [i, issue] of island.issues.entries()) {
        const out = result.issues[i];
        assert.deepEqual([out.kind, out.severity, out.road, out.message, plan(out.position)], [issue.kind, issue.severity, issue.road, issue.message, rounded(issue.point)]);
        assert.deepEqual(out.spans, issue.spans?.map(s => ({ road: s.road, from: round(s.from), to: round(s.to) })));
    }
});

exportTest("building foundations, outer and inner footprints, and authored door poses agree", ({ design, island, result }) => {
    assert.equal(result.buildings.length, design.buildings.length);
    assert.deepEqual(new Set(result.buildings.map(b => b.shape)), new Set(["rect", "circle", "ring"]));
    for (const [i, b] of result.buildings.entries()) {
        const original = design.buildings[i], pads = island.terrain.pads[i];
        assert.deepEqual([b.center, b.height, b.color], [rounded(original.center), round(original.height), original.color]);
        assert(pads.some(k => b.padElevation === round(island.graded.heights[k])));
        assert(Math.abs(Math.hypot(...b.longAxis) - 1) < .001);
        if (b.shape === "rect") {
            assert.deepEqual(b.outline, corners(original).map(rounded));
            const index = original.size![0] >= original.size![1] ? 0 : 1;
            const a = b.outline[index], end = b.outline[index + 1], length = distance(a, end);
            assert(Math.abs((end[0] - a[0]) / length - b.longAxis[0]) < .001 && Math.abs((end[1] - a[1]) / length - b.longAxis[1]) < .001);
        }
        else {
            for (const p of b.outline) assert(Math.abs(distance(p, b.center) - b.radius!) < .002);
            if (b.shape === "ring") for (const p of b.innerOutline!) assert(Math.abs(distance(p, b.center) - b.innerRadius!) < .002);
        }
        assert.deepEqual(b.doors.map(d => d.id), original.doors.map(d => d.id));
        for (const door of b.doors) {
            const p = plan(door.position), pose = nodePose(design, { type: "door", building: b.id, door: door.id });
            assert.deepEqual(p, rounded(pose.point));
            assert.equal(door.position[2], b.padElevation);
            assert(nearest(...p, b.outline, true).distance < .01);
            assert((p[0] - b.center[0]) * door.normal[0] + (p[1] - b.center[1]) * door.normal[1] > 0);
            assert.deepEqual(door.normal, rounded([Math.cos(pose.normal!), Math.sin(pose.normal!)]));
            assert.equal(door.wall, original.doors.find(d => d.id === door.id)!.wall);
        }
    }
});

exportTest("areas, door and gate nodes, hedges and labels retain their authored locations", ({ design, result }) => {
    assert.equal(result.areas.length, design.zones.length + design.yards!.length + design.vegetation.rooms.length);
    for (const z of design.zones) {
        const area = result.areas.find(a => a.type === "area.zone" && a.id === z.id)!;
        const s = z.shape;
        assert.deepEqual(area.polygon, zonePolygon(s.type === "circle" || s.type === "ellipse" ? { ...s, samples: 48 } : s).map(rounded));
        assert.equal(area.fill, z.fill);
    }
    for (const [i, room] of design.vegetation.rooms.entries()) {
        const area = result.areas.find(a => a.type === "area.room" && a.id === "room-" + (i + 1))!;
        assert.equal(area.polygon.length, 48);
        for (const p of area.polygon) assert(Math.abs(distance(p, room.center) - room.radius) < .001);
    }
    for (const yard of design.yards!) {
        const area = result.areas.find(a => a.zone === yard.zone && a.id === yard.id)!;
        assert.equal(area.type, "area." + (yard.kind ?? "yard"));
        if (yard.points) assert.deepEqual(area.polygon, yard.points.map(rounded));
        else assert.deepEqual(area.polygon, result.areas.find(a => a.type === "area.zone" && a.id === yard.zone)!.polygon);
        const lines = yard.kind === "plaza" ? [] : hedgeLines(areaBoundary(design, yard), design.nodes.filter(n => n.type === "gate" && n.yard === yard.id), design.edges);
        const hedges = result.hedges.filter(h => h.yard === yard.id);
        assert.deepEqual(hedges.map(h => h.polyline.map(plan)), lines.map(line => line.map(rounded)));
        for (const h of hedges) for (const p of h.polyline) assert(Math.abs(p[2] - ground(p, result.terrain)) <= .00050000001);
    }
    assert.equal(result.nodes.length, design.nodes.length);
    for (const [i, node] of result.nodes.entries()) {
        const n = design.nodes[i], pose = nodePose(design, n);
        assert.deepEqual([node.type, plan(node.position)], ["node." + n.type, rounded(pose.point)]);
        if (n.type === "door" || n.type === "gate") assert.deepEqual(node.normal, rounded([Math.cos(pose.normal!), Math.sin(pose.normal!)]));
        else assert.equal(node.normal, undefined);
        if (n.type === "door") assert.deepEqual(node.position, result.buildings.find(b => b.id === n.building)!.doors.find(d => d.id === n.door)!.position);
        const ends = result.roads.flatMap((road, i) => {
            const edge = design.edges[i];
            return [...(edge.from === n.id ? [road.centerline[0]] : []), ...(edge.to === n.id ? [road.centerline.at(-1)!] : [])];
        });
        for (const p of ends) assert.equal(node.position[2], p[2]);
        if (!ends.length && n.type !== "door") assert(Math.abs(node.position[2] - ground(node.position, result.terrain)) <= .00050000001);
    }
    assert.equal(result.labels.length, design.labels.length);
    for (const [i, label] of result.labels.entries()) {
        const l = design.labels[i], b = design.buildings.find(b => b.id === l.building);
        assert.deepEqual(plan(label.position), rounded(b ? b.center.map((n, k) => n + (l.offset?.[k] ?? 0)) : l.point!));
        assert.equal(label.name, l.name);
        assert(Math.abs(label.position[2] - ground(label.position, result.terrain)) <= .00050000001);
    }
});

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
    const side = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return 0;
    return Math.min(nearest(...a, [c, d]).distance, nearest(...b, [c, d]).distance,
        nearest(...c, [a, b]).distance, nearest(...d, [a, b]).distance);
}

exportTest("retaining wall sections follow zone edges and keep the road corridor clear between all samples", ({ island, result }) => {
    assert(result.walls.length > 0);
    const roads = result.roads.flatMap(r => r.centerline.slice(1).map((p, i) => ({ a: plan(r.centerline[i]), b: plan(p), clearance: r.width / 2 + .3 })));
    let closest = Infinity;
    for (const wall of result.walls) {
        const zone = island.terrain.zones.find(z => z.id === wall.zone)!;
        assert(zone.retainingWall);
        assert.equal(wall.top.length, wall.polyline.length);
        assert.equal(wall.bottom.length, wall.polyline.length);
        for (const [i, p] of wall.polyline.entries()) {
            assert(nearest(...p, zone.polygon, true).distance < .001);
            assert(wall.top[i] - wall.bottom[i] >= .399 - 1e-10);
            if (!i) continue;
            const prev = wall.polyline[i - 1];
            assert(distance(prev, p) <= 1.002);
            for (const { a, b, clearance } of roads) {
                // The axis-aligned boxes prove a lower bound before the exact segment test.
                if (Math.max(a[0], b[0]) + clearance + .01 < Math.min(p[0], prev[0]) || Math.min(a[0], b[0]) - clearance - .01 > Math.max(p[0], prev[0]) ||
                    Math.max(a[1], b[1]) + clearance + .01 < Math.min(p[1], prev[1]) || Math.min(a[1], b[1]) - clearance - .01 > Math.max(p[1], prev[1])) continue;
                const gap = segmentDistance(prev, p, a, b) - clearance;
                assert(gap >= 0, wall.id + " enters a roadway by " + -gap);
                closest = Math.min(closest, gap);
            }
        }
    }
    assert(closest < .005, "wall ends reach the requested road margin");
});

test("wall openings have the specified width on both sides of a raised square, including road end caps", () => {
    const model = new Island(syntheticDesign()), { grid } = model.terrain, source = provenance(serializeDesign(model.design));
    const square: Point[] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const wallZone = { ...model.terrain.zones[0], polygon: square, retainingWall: true };
    model.terrain.zones = [wallZone];
    const raised = model.graded.heights.map((_, k) => {
        const [x, y] = grid.point(k);
        return Math.abs(x) < 10 && Math.abs(y) < 10 ? 3 : 0;
    });
    model.graded.heights = raised;
    const crossing = { ...model.routes[0], edge: { ...model.routes[0].edge, width: 2 }, points: [[-15, 0], [15, 0]] as Point[], h: [0, 0], stairs: [false] };
    model.routes = [crossing];
    for (const polygon of [square, [...square].reverse()]) {
        wallZone.polygon = polygon;
        const walls = exportIsland(model, source).walls;
        assert.equal(walls.length, 2);
        const ends = walls.flatMap(w => [w.polyline[0], w.polyline.at(-1)!]);
        for (const x of [-10, 10]) for (const y of [-1.3, 1.3]) assert(ends.some(p => distance(p, [x, y]) < .003));
        for (const w of walls) for (const [i, p] of w.polyline.entries()) {
            if (Math.abs(p[0]) < 9 || Math.abs(p[1]) < 9) assert.deepEqual([w.top[i], w.bottom[i]], [3, 0]);
        }
    }
    model.routes = [{ ...crossing, points: [[10, 0]], h: [0], stairs: [] }];
    const [wall] = exportIsland(model, source).walls;
    assert(Math.abs(distance(wall.polyline[0], [10, 0]) - 1.3) < .003);
    assert(Math.abs(distance(wall.polyline.at(-1)!, [10, 0]) - 1.3) < .003);
    model.routes = [];
    const closed = exportIsland(model, source).walls;
    assert.equal(closed.length, 1);
    assert.deepEqual(closed[0].polyline[0], closed[0].polyline.at(-1));
    model.graded.heights = raised.map(h => h / 10);
    assert.deepEqual(exportIsland(model, source).walls, []);
});

test("Both arms share the exported junction elevation across a one-metre terrain break", () => {
    const design = syntheticDesign();
    design.nodes = [
        { id: "A", name: "A", type: "endpoint", point: [-12, 0] }, { id: "B", name: "B", type: "junction", point: [0, 0] },
        { id: "C", name: "C", type: "endpoint", point: [12, 0] }, { id: "D", name: "D", type: "endpoint", point: [4, 4] }
    ];
    const edge = { ...design.edges[0], from: "A", to: "B", mode: "straight" as const };
    design.edges = [edge, { ...edge, id: "F", from: "B", to: "C" }];
    const island = new Island(design), { grid } = island.terrain;
    island.terrain.heights = island.terrain.heights.map((_, k) => grid.point(k)[0] < 0 ? 4 : 5);
    island.reroute();
    const out = exportIsland(island, provenance(serializeDesign(design)));
    const joint = out.nodes.find(n => n.id === "B")!, isolated = out.nodes.find(n => n.id === "D")!;
    assert.equal(joint.position[2], 4.5);
    assert.equal(island.routes[0].h.at(-1), island.routes[1].h[0]);
    assert.equal(out.roads[0].centerline.at(-1)![2], joint.position[2]);
    assert.equal(out.roads[1].centerline[0][2], joint.position[2]);
    assert.equal(isolated.position[2], ground(isolated.position, out.terrain));
});

test("tree bases can be reconstructed from rounded grid spacing and origin", () => {
    const d = syntheticDesign(), step = 1.00049, xMin = -48.0002, yMax = 48.0002;
    d.grid = { xMin, xMax: xMin + 96 * step, yMin: yMax - 96 * step, yMax, step };
    const out = exportIsland(new Island(d), provenance(serializeDesign(d)));
    assert.equal(out.terrain.step, 1);
    assert(out.trees.length > 0);
    for (const t of out.trees) assert(Math.abs(t.position[2] - ground(t.position, out.terrain)) <= .00050000001);
});