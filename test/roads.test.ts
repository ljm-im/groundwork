import { test } from "node:test";
import assert from "node:assert/strict";
import { type Point, type Design, type Edge, type Ellipse, type Yard } from "../src/core/design/types.ts";
import { type Alignment } from "../src/core/design/results.ts";
import { advance, angleDiff, bearing, createGrid, distance, nearest, pointAt, radians, resample, sample, stations } from "../src/core/math/geometry.ts";
import { radiusAt, exemptRadius } from "../src/core/roads/alignment.ts";
import { Island } from "../src/core/island.ts";
import { nodePose, serializeDesign } from "../src/core/design/model.ts";
import { gradeRoads, profile } from "../src/core/roads/profiles.ts";
import { clearLead, routeAll, routeEdge } from "../src/core/roads/routing.ts";
import { selfOverlaps } from "../src/core/roads/proximity.ts";
import { armBearing, validateDesign, validateRoads } from "../src/core/checks/validation.ts";
import { gateFraction } from "../src/core/design/gates.ts";
import { fixtureOptions, readRegressions } from "../configs/read-fixture.ts";
import { branchJunction, referenceDesign, oldStreet, syntheticDesign, syntheticRoads } from "./scenarios.ts";

test("Migrated streets preserve continuity and the old centreline", fixtureOptions("round4.json", "street-v1.json", "regressions.json"), async () => {
    const design = await referenceDesign(), input = serializeDesign(design);
    const model = new Island(design);
    assert.equal(model.routes.length, design.edges.length);
    const expected = (await readRegressions()).round4;
    assert(expected.convertedRoads.every(id => model.routes.some(r => r.id === id)));
    const street = await oldStreet();
    const circuit = expected.circuit.map(id => model.routes.find(r => r.id === id)!);
    assert(circuit.every((r, i) => r.edge.mode === "smooth" && (!i || circuit[i - 1].edge.to === r.edge.from)));
    const centerline = circuit.flatMap((r, i) => i ? r.points.slice(1) : r.points), oldS = stations(street), newS = stations(centerline);
    const deviations = [
        Math.max(...street.map((p, i) => distance(p, pointAt(centerline, newS, newS.at(-1)! * oldS[i] / oldS.at(-1)!)))),
        Math.max(...street.map(p => nearest(...p, centerline).distance)), Math.max(...centerline.map(p => nearest(...p, street).distance))
    ];
    assert(deviations.every(m => m <= 1), "环街偏差超过1m");
    assert(!/"direction"\s*:/.test(input) && !("doorLead" in design.routing));
});

test("Endpoints, radii, corridors and portal headings", fixtureOptions("round4.json", "regressions.json"), async () => {
    const design = await referenceDesign();
    const model = new Island(design);
    const expected = (await readRegressions()).round4;
    const circuit = expected.circuit.map(id => model.routes.find(r => r.id === id)!);
    const fork = branchJunction(design);
    for (const route of model.routes) {
        const { edge, parts } = route;
        if (edge.mode === "straight") assert(route.points.every(p => nearest(...p, [route.points[0], route.points.at(-1)!]).distance <= .01));
        assert.deepEqual(route.points[0], nodePose(design, edge.from).point);
        assert.deepEqual(route.points.at(-1)!, nodePose(design, edge.to).point);
        for (let i = 1; i < route.points.length - 1; i++) {
            const a = route.points[i - 1],
                b = route.points[i],
                c = route.points[i + 1];
            const radius = radiusAt(a, b, c);
            if (edge.from === fork.id && !fork.through!.includes(edge.id) || !exemptRadius(route, i, route.s, design))
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
    const plaza = design.yards!.find(y => y.kind === "plaza")!;
    const plazaShape = design.zones.find(z => z.id === plaza.zone)!.shape as Ellipse;
    const gate = design.nodes.find(n => n.yard === plaza.id)!;
    const plazaRoute = model.routes.find(r => r.edge.from === gate.id)!, [px, py] = plazaRoute.points[0];
    const [cx, cy] = plazaShape.center, [rx, ry] = plazaShape.radii;
    assert(Math.abs(((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 - 1) < 1e-9);
    const plazaNormal = Math.atan2((py - cy) / ry ** 2, (px - cx) / rx ** 2);
    const continuation = model.routes.find(r => r.edge.from === circuit.at(-1)!.edge.to)!;
    for (const [r, expected] of [[plazaRoute, plazaNormal], [continuation, bearing(...circuit.at(-1)!.points.slice(-2) as [Point, Point])]] as const) {
        const actual = bearing(r.points[0], pointAt(r.points, r.s, 2));
        assert(angleDiff(expected, actual) <= 5 * radians);
    }
});

test("Road beds follow a diagonal incline and a six-metre-radius curve between survey stations", () => {
    const design = syntheticDesign(), grid = createGrid(design.grid);
    design.routing.profilePasses = 0;
    const diagonal: Point[] = [[-16.5, -8.5], [7.5, 9.5]];
    const arc = Array.from({ length: 13 }, (_, i): Point => [2.5 + 6 * Math.cos(i * Math.PI / 24), 2.5 + 6 * Math.sin(i * Math.PI / 24)]);
    for (const [index, line] of [resample(diagonal, 1), arc].entries()) {
        const terrain = { grid, padMask: new Uint8Array(grid.size), heights: Float32Array.from({ length: grid.size }, (_, k) => {
            const [x, y] = grid.point(k);
            return index ? 12 + .4 * (y - x) : 12 + .4 * x + .3 * y;
        }) };
        const edge = { ...design.edges[0], grade: "street", width: 3 };
        const route = profile(design, terrain, { id: edge.id, edge, points: line, controls: line, parts: [] });
        const graded = gradeRoads(design, terrain, [route]);
        if (!index) assert(Math.abs(route.drop / route.length - .5) < 1e-6);
        for (let j = 0; j <= Math.ceil(route.length * 4); j++) {
            const at = Math.min(j / 4, route.length), next = Math.max(1, route.s.findIndex(s => s >= at));
            const t = (at - route.s[next - 1]) / (route.s[next] - route.s[next - 1]);
            const h = route.h[next - 1] + (route.h[next] - route.h[next - 1]) * t;
            assert(Math.abs(h - sample(grid, graded.heights, ...pointAt(line, route.s, at))) <= .05, "station " + at);
        }
    }
});

test("Overlapping road beds use centreline distance, design order for ties and the protected pad mask", () => {
    const { synthetic, grid, flat, road } = syntheticRoads();
    const a = road("A", "a", "b", [[0, .5], [18, .5]], { width: 2 });
    const b = road("B", "c", "d", [[0, 2.5], [18, 2.5]], { width: 10 });
    a.h = [2, 11];
    b.h = [20, 20];
    const terrain = { ...flat, padMask: new Uint8Array(grid.size) };
    terrain.padMask[grid.index(4.5, .5)] = 1;
    synthetic.edges = [a.edge, b.edge];
    const result = gradeRoads(synthetic, terrain, [b, a]);
    assert.equal(result.heights[grid.index(8.5, .5)], 6.25);
    assert.equal(result.heights[grid.index(8.5, 1.5)], 6.25);
    assert.equal(result.heights[grid.index(8.5, 2.5)], 20);
    assert.equal(result.heights[grid.index(4.5, .5)], 5);
    synthetic.edges.reverse();
    assert.equal(gradeRoads(synthetic, terrain, [a, b]).heights[grid.index(8.5, 1.5)], 20);
});

test("Selective rerouting and level previews retain unaffected geometry", () => {
    const design = syntheticDesign();
    design.nodes.push({ id: "c", name: "C", type: "endpoint", point: [6, 4] });
    design.edges.push({ ...design.edges[0], id: "F", from: "c" });
    const model = new Island(design);
    model.reroute();
    const previous = model.routes.slice(),
        points = new Set([design.edges[0].id]);
    model.reroute(points);
    assert.notEqual(model.routes.find(r => r.id === design.edges[0].id)!, previous.find(r => r.id === design.edges[0].id)!);
    assert.equal(model.routes.find(r => r.id === design.edges[1].id)!, previous.find(r => r.id === design.edges[1].id)!);
    const originalLines = model.routes.map(r => r.points);
    design.levels.A += .5;
    model.levels();
    assert(model.routes.every((r, i) => r.points === originalLines[i]));
    model.levels(true);
    assert.deepEqual(model.graded.heights, new Island(structuredClone(design)).graded.heights, "编辑后保存并重开应恢复同一地形");
});

test("Splitting a portal lead preserves the original centreline", fixtureOptions("round4.json"), async () => {
    const again = new Island(await referenceDesign());
    const portal = again.design.edges.find(e => again.design.nodes.some(n => n.id === e.to && n.type === "gate"))!,
        front = nodePose(again.design, portal.to);
    const onLead = advance(front.point, front.angle!, 1);
    const split = routeEdge(again.design, again.terrain, { ...portal, via: [onLead] });
    assert(split.parts.every(p => !p.failed));
    assert(split.points.some(p => distance(p, onLead) < 1e-8));
    const unsplit = again.routes.find(r => r.id === portal.id)!.points;
    assert(Math.abs(stations(split.points).at(-1)! - stations(unsplit).at(-1)!) < 1e-8);
    assert(split.points.every(p => nearest(...p, unsplit).distance < 1e-8));
});

test("Unroutable edges return a straight, flagged fallback", () => {
    const testDesign = syntheticDesign(), again = new Island(testDesign);
    const edge = { ...testDesign.edges[0], from: "ocean-a", to: "ocean-b", via: [] };
    testDesign.nodes.push({ id: "ocean-a", name: "ocean-a", type: "junction", point: [-46, 45] }, { id: "ocean-b", name: "ocean-b", type: "junction", point: [-40, 45] });
    const fallback = profile(testDesign, again.terrain, routeEdge(testDesign, again.terrain, edge));
    assert(fallback.parts.some(p => p.failed));
    assert(validateRoads(testDesign, again.terrain, [fallback]).some(i => i.kind === "no-route"));
    for (const p of fallback.points) assert(nearest(...p, fallback.controls).distance < 1e-8);
});

test("Opposing entrances and compulsory loops", () => {
    const { synthetic, flat, grid } = syntheticRoads();
    const design = synthetic;
    const approach = structuredClone(synthetic);
    const smallYard: Yard & { points: Point[] } = { id: "test-yard", name: "Test yard", zone: "test", points: [[0, -1], [1, -1], [1, 1], [0, 1]] };
    approach.yards = [smallYard];
    approach.buildings = [{ id: "tower", name: "Tower", height: 2, color: "gray", shape: "circle", center: [14, 0], radius: 1, doors: [{ id: "D", angle: 0 }] }];
    approach.nodes = [
        { id: "P", name: "P", type: "gate", yard: smallYard.id, at: gateFraction(smallYard, [0, 0]) },
        { id: "Q", name: "Q", type: "door", building: "tower", door: "D" }
    ];
    const opposite = { ...design.edges[0], id: "opposing", from: "P", to: "Q", width: 2, corridor: 10, via: [] };
    approach.edges = [opposite];
    const ground = { ...flat, clearance: new Float32Array(grid.size).fill(20) };
    const opposing = profile(approach, ground, routeEdge(approach, ground, opposite));
    assert.equal(distance(opposing.points[0], opposing.points.at(-1)!), 15);
    assert(angleDiff(nodePose(approach, "P").angle!, nodePose(approach, "Q").angle!) > Math.PI - 1e-7);
    assert(opposing.parts.every(part => !part.failed));
    const collided = selfOverlaps(opposing.points, opposite.width);
    const reported = validateRoads(approach, ground, [opposing]).filter(i => i.kind === "self-overlap");
    assert.equal(reported.length, collided.length);
    assert(reported.every(i => i.severity === "error"));
    const loopEdge: Edge = { ...opposite, id: "compulsory-loop", from: "a", to: "b",
        via: [[9, 0], [15, 6], [9, 12], [3, 6], [9, 0]] };
    const forced = profile(synthetic, ground, routeEdge(synthetic, ground, loopEdge));
    assert(forced.parts.every(part => !part.failed));
    assert(validateRoads(synthetic, ground, [forced]).some(i => i.kind === "self-overlap" && i.severity === "error"));
});

test("Stair flights, corner landings and narrow treads", () => {
    const { synthetic, grid } = syntheticRoads();
    // An L-shaped passable strip forces a 90-degree turn well outside the two end landings.
    const flights: Design = { ...synthetic, nodes: [
        { id: "P", name: "P", type: "junction", point: [-4.5, .5] }, { id: "Q", name: "Q", type: "junction", point: [6.5, 10.5] }
    ] };
    const stairEdge = { ...synthetic.edges[0], from: "P", to: "Q", width: 2, corridor: 10 };
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
});

test("Through roads and branch angles are independent of edge order", fixtureOptions("round4.json", "regressions.json"), async () => {
    const again = new Island(await referenceDesign());
    const forkNode = branchJunction(again.design);
    const main = forkNode.through!.map(id => again.routes.find(r => r.id === id)!);
    const branch = again.routes.find(r => r.edge.from === forkNode.id && !main.includes(r))!;
    const arms = main.map(r => armBearing(r, forkNode.id));
    const mainAngle = 180 - angleDiff(arms[0], arms[1]) / radians;
    const branchAngle = Math.min(...arms.map(a => angleDiff(armBearing(branch, forkNode.id), a))) / radians;
    const outgoingFraction = main[1].length / (main[0].length + main[1].length);
    assert(mainAngle <= 10 && branchAngle >= 30 && Math.abs(outgoingFraction - (await readRegressions()).round4.outgoingFraction) < .05);
    assert(angleDiff(bearing(...main[0].points.slice(-2) as [Point, Point]), bearing(...main[1].points.slice(0, 2) as [Point, Point])) < 1e-7);
    const shallow = { ...main[1], id: branch.id, edge: branch.edge };
    assert(validateDesign(again.design, again.terrain, again.graded.heights, [...main, shallow]).some(i => i.kind === "branch-angle"));
    const backwards = { ...again.design, edges: [...again.design.edges].reverse() };
    for (const r of routeAll(backwards, again.terrain)) assert.deepEqual(r.points, again.routes.find(saved => saved.id === r.id)!.points);
});

test("Through junctions remain tangent around a closed circuit", () => {
    const { grid, synthetic: ring } = syntheticRoads();
    const curve = { ...ring.edges[0], grade: "path" };
    ring.nodes = [[0, 0], [20, 0], [20, 14], [0, 14]].map((point, i) => ({
        id: String(i), name: String(i), type: "junction", point: point as Point, through: ["r" + ((i + 3) % 4), "r" + i]
    }));
    ring.edges = ring.nodes.map((n, i) => ({ ...curve, id: "r" + i, from: n.id, to: ring.nodes[(i + 1) % 4].id, via: [] }));
    const plain = { grid, heights: new Float32Array(grid.size).fill(5), clearance: new Float32Array(grid.size).fill(20) };
    const loop = routeAll(ring, plain);
    for (const [i, r] of loop.entries()) {
        assert(r.parts.every(p => !p.failed));
        assert(angleDiff(bearing(...r.points.slice(-2) as [Point, Point]), bearing(...loop[(i + 1) % 4].points.slice(0, 2) as [Point, Point])) < 1e-7);
    }
});

test("Straight, smooth and routed modes preserve corners and obstacle clearance", () => {
    const { synthetic, grid, flat, road } = syntheticRoads();
    const plain = { grid, heights: new Float32Array(grid.size).fill(5), clearance: new Float32Array(grid.size).fill(20) };
    // Geometry of each mode is measured on the sampled line that is actually profiled and drawn.
    const elbowDesign = structuredClone(synthetic);
    elbowDesign.nodes = [{ id: "a", name: "a", type: "endpoint", point: [0, 0] }, { id: "b", name: "b", type: "endpoint", point: [12, 12] }];
    const rightAngle: Edge = { ...synthetic.edges[0], width: 2, corridor: 10, id: "elbow", from: "a", to: "b", via: [[12, 0]], mode: "straight", grade: "path" };
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
    const direct = routeEdge(elbowDesign, plain, { ...rightAngle, via: [] });
    assert(direct.points.every(p => nearest(...p, direct.controls).distance <= .01));
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
});