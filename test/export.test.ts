import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseDesign, serializeDesign, nodePose } from "../src/core/design/model.ts";
import { corners } from "../src/core/design/shapes.ts";
import { type Point } from "../src/core/design/v5.ts";
import { distance, nearest, resample, stations, gradient } from "../src/core/math/geometry.ts";
import { profile } from "../src/core/roads/profiles.ts";
import { Island } from "../src/core/island.ts";
import { syntheticDesign, rect, layer, polygon } from "./scenarios.ts";
import { exportIsland, serializeExport } from "../src/core/export.ts";

const prompt = "  外观保留原样。\n[\n  1,\n  2\n]\t\"门\"  ";
const provenance = (input: string) => ({ sha256: createHash("sha256").update(input).digest("hex"), commit: "a".repeat(40) });

function loadExample() {
    const design = syntheticDesign();
    design.prompt = prompt;
    for (const key of ["buildings", "edges", "nodes"] as const) design[key][0].prompt = key + prompt;
    const original = design.buildings[0];
    for (const shape of ["circle", "ring"] as const) design.buildings.push({ id: shape, name: shape, shape, radius: 3, inner: shape === "ring" ? 1 : undefined,
        center: [shape === "ring" ? 28 : 15, -15], color: original.color, height: 4, doors: [{ id: "D", angle: 32 }] });
    design.nodes.push({ id: "D", name: "D", type: "door", building: original.id, door: original.doors[0].id });
    design.labels.push({ name: "B", point: [2, 3], var: "A" });
    const c = design.geoNodes[0].construction;
    if (c.type === "free") {
        const hole = polygon([[6, 5], [12, 5], [12, 10], [6, 10]]);
        for (const node of hole.nodes) node.id = "H" + node.id;
        c.paths.push(hole);
    }
    design.geoNodes.push(layer("S", rect(-40, 6, -20, 10), { type: "flat", value: -1 }),
        layer("B", rect(-40, 10, -20, 18), { type: "flat", value: 1 }));
    const input = serializeDesign(design), source = provenance(input);
    const island = new Island(design), result = exportIsland(island, source);
    return { design, input, source, island, result };
}
let example: ReturnType<typeof loadExample>;
function exportTest(name: string, check: (data: ReturnType<typeof loadExample>) => void) {
    test(name, () => check(example ??= loadExample()));
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
    let value = 0, total = 0;
    for (const j of new Set([top, bottom])) for (const i of new Set([left, right])) {
        const weight = (1 - Math.abs(x - i)) * (1 - Math.abs(y - j));
        if (terrain.defined[j][i]) {
            value += heights[j][i] * weight; total += weight;
        }
    }
    return value / total;
}

exportTest("independent exports have identical formatted bytes and preserve authored text", ({ design, input, source, island, result }) => {
    const bytes = serializeExport(result);
    const again = exportIsland(new Island(parseDesign(input)), { commit: source.commit, sha256: source.sha256 });
    assert.equal(serializeExport(again), bytes);
    const json = JSON.parse(bytes);
    assert.deepEqual(json.source, source);
    assert.equal(json.format, "groundwork-export");
    assert.equal(json.version, 3);
    assert.equal(json.prompt, prompt);
    for (const [parents, elements] of [[design.buildings, result.buildings], [design.edges, result.roads], [design.nodes, result.nodes]] as const) {
        assert.equal(elements.find(e => e.id === parents[0].id)!.prompt, parents[0].prompt);
        if (elements[1]) assert.equal(Object.hasOwn(elements[1], "prompt"), false);
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
    const seen = new Set<number>();
    for (let j = 0; j < grid.height; j++) for (let i = 0; i < grid.width; i++) {
        const k = j * grid.width + i, h = graded.heights[k];
        assert.equal(out.defined[j][i], terrain.defined[k]);
        assert.equal(out.heights[j][i], round(h));
        if (!terrain.defined[k]) {
            assert.equal(h, 0); continue;
        }
        const slope = Math.hypot(...gradient(grid, graded.heights, terrain.defined, k));
        const expected = h < 0 ? 0 : terrain.padMask[k] ? 4 : slope > .75 ? 2 : Math.abs(terrain.shore[k]) <= 5 && slope < .3 && h < 2 ? 1 : 3;
        assert.equal(out.surface[j][i], expected);
        seen.add(expected);
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4]);
    assert(out.defined.some(row => row.includes(0)));
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
        assert.deepEqual([out.kind, out.severity, out.road, out.message, out.position.slice(0, 2)], [issue.kind, issue.severity, issue.road, issue.message, rounded(issue.point)]);
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

exportTest("door nodes and labels retain their authored locations and suspended outlines are empty", ({ design, result }) => {
    assert.deepEqual([result.areas, result.walls, result.hedges], [[], [], []]);
    const node = result.nodes.find(n => n.type === "node.door")!;
    const door = result.buildings.find(b => b.id === node.building)!.doors.find(d => d.id === node.door)!;
    assert.deepEqual(node.position, door.position);
    assert.deepEqual(node.normal, door.normal);
    assert.deepEqual(plan(result.labels[0].position), design.labels[0].point);
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

test("Level decks preserve each submerged terrain and surface cell", () => {
    const design = syntheticDesign();
    design.geoNodes.push(layer("W", rect(35, -7, 48, 7), { type: "flat", value: -2 }));
    design.nodes[0].point = [32.25, .25];
    design.nodes[1].point = [46.25, .25];
    Object.assign(design.edges[0], { mode: "straight", levelDeck: true });
    const island = new Island(design), route = island.routes[0];
    const ungraded = new Island({ ...design, edges: [] }), source = provenance(serializeDesign(design));
    const out = exportIsland(island, source), before = exportIsland(ungraded, source);
    assert(route.h.every(h => h === route.h[0]));
    assert(out.nodes.every(n => n.position[2] === out.roads[0].centerline[0][2]));
    assert(route.points.some(p => island.terrain.heights[island.terrain.grid.index(...p)] < -1));
    assert(island.graded.weight.every(w => w === 0));
    assert.deepEqual(island.graded.heights, island.terrain.heights);
    assert.deepEqual(out.terrain.heights, before.terrain.heights);
    assert.deepEqual(out.terrain.surface, before.terrain.surface);
});

test("A deck split across edges shares its shore elevation with a selectively rerouted path", () => {
    const design = syntheticDesign();
    design.geoNodes.push(layer("H", rect(31, 2, 41, 11), { type: "flat", value: 8 }));
    design.nodes = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: String(i), type: "endpoint", point: [24 + 6 * i, .5] }));
    const span = { ...design.edges[0], grade: "path", mode: "straight" as const, levelDeck: true };
    design.edges = [{ ...span, id: "A", from: "0", to: "1" }, { ...span, id: "B", from: "2", to: "1" },
        { ...span, id: "C", from: "2", to: "3", levelDeck: false }];
    const island = new Island(design), first = island.routes[0].h[0];
    const check = (level: number) => {
        for (const r of island.routes.slice(0, 2)) assert(r.h.every(h => h === level));
        assert.equal(island.routes[2].h[0], level);
    };
    check(first);
    design.nodes[0].point = [33, 5];
    island.reroute(new Set(["A"]));
    assert.notEqual(island.routes[0].h[0], first);
    check(island.routes[0].h[0]);
});

test("Flights use equal rises and treads between landings in either direction", () => {
    const design = syntheticDesign(), island = new Island(design), { grid } = island.terrain;
    const edge = { ...design.edges[0], stairs: true };
    design.routing.profilePasses = 0;
    island.terrain.heights = island.terrain.heights.map((_, k) => {
        const [x] = grid.point(k);
        return 10 + .4 * x + .8 * Math.cos(.5 * x);
    });
    const line = resample([[-9.5, .5], [10.5, .5]], 1);
    for (const points of [line, [...line].reverse()]) {
        const route = profile(design, island.terrain, { id: edge.id, edge, points, controls: points, parts: [], platforms: [10] });
        island.routes = [route];
        const out = exportIsland(island, provenance(serializeDesign(design))), road = out.roads[0];
        assert.deepEqual(road.flights.map(f => [f.from, f.to]), [[0, 9], [11, 20]]);
        assert.equal(route.h[9], route.h[11]);
        const chain = stations(points);
        for (const f of road.flights) {
            const start = chain.indexOf(f.from), end = chain.indexOf(f.to);
            for (let i = start + 1; i < end; i++) assert(Math.abs(route.h[i + 1] - 2 * route.h[i] + route.h[i - 1]) < 1e-9);
            const rise = round(road.centerline[end][2] - road.centerline[start][2]);
            assert.equal(f.rise, rise);
            assert.equal(f.steps, Math.ceil(Math.abs(rise) / .17));
            assert.equal(f.riser, round(Math.abs(rise) / f.steps));
            assert.equal(f.tread, round((f.to - f.from) / f.steps));
            assert(f.riser <= .17);
        }
        const slope = Math.abs(route.h[9] - route.h[0]) / 9;
        assert(Math.abs(route.grades[3] - slope) < 1e-9 && Math.abs(route.peaks[3] - slope) < 1e-9);
        assert(Math.abs(route.maxGrade - Math.max(slope, Math.abs(route.h[20] - route.h[11]) / 9)) < 1e-9);
    }
    island.terrain.heights.fill(4);
    const plain = { id: edge.id, edge, points: line, controls: line, parts: [] };
    island.routes = [profile(design, island.terrain, plain), profile(design, island.terrain, { ...plain, edge: design.edges[0] })];
    const [flat, ramp] = exportIsland(island, provenance(serializeDesign(design))).roads;
    assert.deepEqual(flat.flights, [{ from: 0, to: 20, rise: 0, steps: 0, riser: 0, tread: null }]);
    assert.deepEqual(ramp.flights, []);
});

test("tree bases can be reconstructed from rounded grid spacing and origin", () => {
    const d = syntheticDesign();
    d.grid.step = 1.00049;
    const out = exportIsland(new Island(d), provenance(serializeDesign(d)));
    assert.equal(out.terrain.step, 1);
    assert(out.trees.length > 0);
    for (const t of out.trees) assert(Math.abs(t.position[2] - ground(t.position, out.terrain)) <= .00050000001);
});