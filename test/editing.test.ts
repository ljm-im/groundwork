import { test } from "node:test";
import assert from "node:assert/strict";
import { type Point, type Ellipse, type Sector, type Yard, type Polygon } from "../src/core/design/types.ts";
import { fixtureOptions, readRegressions } from "../configs/read-fixture.ts";
import { advance, angleDiff, distance, nearest, pointAt, radians, sample, mixPoint } from "../src/core/math/geometry.ts";
import { addDoor, canPlaceBuilding, doorRoads, placeBuilding, removeBuildingPart, rotateBuilding, setShape, titlePoint, nearbyWall, openDoorAt } from "../src/core/edit/buildings.ts";
import { History } from "../src/core/edit/history.ts";
import { Island } from "../src/core/island.ts";
import { moveNode, nodePose, parseDesign, serializeDesign, zonePolygon, buildingShape } from "../src/core/design/model.ts";
import { moveHandle } from "../src/core/edit/controls.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { addGate, addNode, connect, removeLinks, splitRoad } from "../src/core/edit/topology.ts";
import { hedgeLines } from "../src/core/edit/yards.ts";
import { gateDistance, gateFraction, gatePose } from "../src/core/design/gates.ts";
import { insidePolygon, perimeter } from "../src/core/math/polygon.ts";
import { addFeature, deleteFeature, featureHit, featureLine, insertVertex, clickDrawing, drawingTarget, finishExtension, newDrawing } from "../src/core/edit/landforms.ts";
import { branchJunction, referenceDesign, syntheticDesign } from "./scenarios.ts";

test("Moving buildings, shared nodes and snapped entrances", fixtureOptions("round4.json"), async () => {
    const moved = await referenceDesign();
    const plaza = moved.yards!.find(y => y.kind === "plaza")!;
    const plazaShape = moved.zones.find(z => z.id === plaza.zone)!.shape as Ellipse;
    const [cx, cy] = plazaShape.center, [, ry] = plazaShape.radii;
    const house = moved.buildings.find(b => b.shape === "rect" && b.doors.length)!;
    const door = { type: "door" as const, building: house.id, door: house.doors[0].id };
    const initial = nodePose(moved, door);
    house.center = house.center.map((v, i) => v + [5, 2][i]) as Point;
    const translated = nodePose(moved, door);
    assert(distance(translated.point, initial.point.map((v, i) => v + [5, 2][i]) as Point) < 1e-8);
    moveNode(moved, door, [house.center[0] + 100, house.center[1]]);
    const exterior = nodePose(moved, door),
        unit = advance(exterior.point, exterior.angle!, 1);
    assert(distance(unit, house.center) > distance(exterior.point, house.center));
    const shared = branchJunction(moved), target: Point = [8, 12];
    assert(shared.through!.length === 2 && moved.edges.filter(e => e.from === shared.id || e.to === shared.id).length === 3);
    moveNode(moved, shared, target);
    assert.deepEqual(nodePose(moved, shared).point, target);
    assert.equal(nodePose(moved, moved.nodes.find(n => n.type === "endpoint" && n.direction == null)!).angle!, null);
    const entrance = moved.nodes.find(n => n.yard === plaza.id)!;
    moveNode(moved, entrance, [cx, cy + ry + 20]);
    assert(distance(nodePose(moved, entrance).point, [cx, cy + ry]) < 1e-7);
    assert(angleDiff(nodePose(moved, entrance).angle!, Math.PI / 2) < 1e-8);
    const tower = moved.buildings.find(b => b.shape === "circle" && b.doors.length)!, lampDoor = moved.nodes.find(n => n.building === tower.id)!;
    moveNode(moved, lampDoor, [tower.center[0] - 20, tower.center[1]]);
    assert(distance(nodePose(moved, lampDoor).point, [tower.center[0] - tower.radius!, tower.center[1]]) < 1e-8);
    assert(angleDiff(nodePose(moved, lampDoor).angle!, Math.PI) < 1e-8);
});

test("History capacity, undo and redo branches", () => {
    const moved = syntheticDesign();
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
});

test("Yard boundaries, gate snapping, hedges and spacing", fixtureOptions("round4.json", "regressions.json"), async () => {
    const again = new Island(await referenceDesign());
    const yard = again.design.yards!.find(y => y.buildings?.length) as Yard & { points: Point[] };
    const gates = again.design.nodes.filter(n => n.yard === yard.id);
    const building = again.design.buildings.find(b => yard.buildings!.includes(b.id) && b.doors.length)!;
    const door = { type: "door" as const, building: building.id, door: building.doors[0].id };
    const height = again.design.zones.find(z => z.id === yard.zone)!.height.level!;
    assert.deepEqual(yard.points, zonePolygon(again.design.zones.find(z => z.id === yard.zone)!.shape));
    assert.equal(gates.length, (await readRegressions()).round4.yardGates);
    const boundary = perimeter(yard), gaps = [];
    for (const [i, gate] of gates.entries()) {
        const pose = nodePose(again.design, gate);
        assert(Math.abs(sample(again.terrain.grid, again.graded.heights, ...pose.point) - again.design.levels[height]) < 1e-6);
        assert(nearest(...pose.point, yard.points, true).distance < 1e-8);
        assert(!insidePolygon(yard, advance(pose.point, pose.angle!, .1)));
        for (const other of gates.slice(i + 1)) gaps.push(gateDistance(gate, other, boundary.length));
    }
    assert(Math.min(...gaps) >= 6);
    assert(again.terrain.yards[0].cells.every(k => again.graded.heights[k] === again.design.levels[height]));
    for (const r of again.routes) for (const p of r.points) {
        assert(!insidePolygon(yard, p) || nearest(...p, yard.points, true).distance < 1e-7, r.edge.name + " 进入院内");
    }
    assert(!again.design.nodes.some(n => n.building === building.id));
    assert.deepEqual((again.design.vegetation.clearings.find(c => c.cover === "ambient" && c.shape?.type === "sector")!.shape as Sector).center, nodePose(again.design, door).point);
    const edited = structuredClone(again.design), editedYard = edited.yards!.find(y => y.id === yard.id)! as Yard & { points: Point[] };
    const endpoint = edited.nodes.find(n => n.type === "viewpoint")!, added = addGate(edited, editedYard, endpoint);
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
    edited.buildings.find(b => yard.buildings!.includes(b.id) && b.id !== building.id)!.center = beside;
    const crowded = new Island(edited);
    assert(crowded.issues.some(i => i.kind === "gate-spacing" && i.severity === "notice"));
    assert(crowded.issues.some(i => i.kind === "gate-building" && i.severity === "error"));
});

test("Gate poses, hedge gaps and distances respect both polygon windings", () => {
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
});

test("Splitting and removing roads maintains through pairs and approaches", fixtureOptions("round4.json"), async () => {
    const again = new Island(await referenceDesign());
    const forkNode = branchJunction(again.design);
    const main = forkNode.through!.map(id => again.routes.find(r => r.id === id)!);
    const branch = again.routes.find(r => r.edge.from === forkNode.id && !main.includes(r))!;
    const portal = again.design.edges.find(e => again.design.nodes.some(n => n.id === e.to && n.type === "gate"))!,
        front = nodePose(again.design, portal.to);
    const onLead = advance(front.point, front.angle!, 1);
    const cutDesign = structuredClone(again.design), cutIsland = new Island(cutDesign);
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
});

test("Building footprints, door connections, removal and undo", () => {
    const editedTown = syntheticDesign(), again = new Island(editedTown);
    const changes = new History(editedTown), site: Point = [4, 6];
    assert(canPlaceBuilding(again, site));
    assert(!canPlaceBuilding(again, again.design.buildings[0].center));
    assert(!canPlaceBuilding(again, again.routes[0].points[5]));
    const cottage = placeBuilding(editedTown, site);
    assert.deepEqual(cottage.size, [8, 6]);
    assert.deepEqual(titlePoint(editedTown, cottage), site);
    let land = generateTerrain(editedTown);
    const centerCell = land.grid.index(...site), sideCell = land.grid.index(10, 6);
    assert(land.padMask[centerCell] && land.clearance[centerCell] < 0 && !land.padMask[sideCell]);
    moveHandle(editedTown, { kind: "building", id: cottage.id, role: "size" }, [11.5, 10]);
    land = generateTerrain(editedTown);
    assert(land.padMask[sideCell] && land.clearance[sideCell] < 0);
    moveHandle(editedTown, { kind: "building", id: cottage.id, role: "body" }, [5, 7]);
    moveHandle(editedTown, { kind: "building", id: cottage.id, role: "title" }, [5, 13]);
    assert.deepEqual(cottage.titleOffset, [0, 6]);
    cottage.name = "B";
    cottage.height = 5;
    cottage.showTitle = false;
    const doorEnd = addDoor(editedTown, cottage, 1), doorData = cottage.doors[0];
    moveHandle(editedTown, { kind: "node", id: doorEnd.id }, [13, 9]);
    assert.equal(doorData.wall, 1);
    assert(doorData.t! > 0 && doorData.t! < 1);
    setShape(editedTown, cottage, "circle");
    const roundDoor = nodePose(editedTown, doorEnd).point;
    rotateBuilding(cottage, 45);
    assert(Math.abs(distance(cottage.center, roundDoor) - cottage.radius!) < 1e-8);
    assert(distance(roundDoor, nodePose(editedTown, doorEnd).point) > 1);
    setShape(editedTown, cottage, "rect");
    const neighbour = addNode(editedTown, [22, 16]), access = connect(editedTown, doorEnd, neighbour);
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
});

test("Sculpting peaks and ridges replays terrain through history", () => {
    const author = syntheticDesign(), baseline = new Island(author);
    // Rebuild through the production Island constructor including erosion at each history step.
    const sculpt = structuredClone(author), history = new History(sculpt);
    const peak = addFeature(sculpt, "peak", [[9, 1]], { level: "A", offset: 9 });
    history.record(sculpt);
    const withPeak = new Island(sculpt).terrain.heights;
    assert.notDeepEqual(withPeak, baseline.terrain.heights);
    const ridge = addFeature(sculpt, "ridge", [[-12, 14], [1, 17], [14, 15]], [8, { level: "A", offset: 14 }, 8]);
    ridge.widths = [12, 15];
    history.record(sculpt);
    const initial = new Island(sculpt).terrain.heights;
    assert.notDeepEqual(initial, withPeak);
    const handle = { kind: "ridge", id: ridge.id, role: "vertex", index: 1 };
    deleteFeature(sculpt, handle);
    history.record(sculpt);
    const withoutVertex = new Island(sculpt).terrain.heights;
    assert.notDeepEqual(withoutVertex, initial);
    assert.deepEqual(new Island(history.step(false)!).terrain.heights, initial);
    assert.deepEqual(new Island(history.step(true)!).terrain.heights, withoutVertex);
    let restored = history.step(false)!;
    const originalRidge = restored.ridges.at(-1)!, samplePoint = featureLine(restored, "ridge", originalRidge)[4];
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
});

test("Creating, converting and removing doors preserves roads", () => {
    const town = syntheticDesign(), junction = town.nodes[0], rect = town.buildings[0];
    town.buildings.push({ id: "B", name: "B", shape: "circle", center: [14, 0], radius: 3,
        height: 2, color: "gray", doors: [] });
    const wall = nearbyWall(town, [-13, -5.4])!;
    assert.equal(wall.building.id, rect.id);
    const entry = openDoorAt(town, wall), edge = connect(town, junction, entry);
    const pose = nodePose(town, entry);
    assert.deepEqual(pose.point, [-13, -6]);
    assert(Math.abs(pose.normal! - Math.PI / 2) < 1e-8);
    assert(buildingShape(wall.building).signedDistance(...advance(pose.point, pose.normal!, .2)) > 0);
    assert.equal(nodePose(town, edge.to).angle, pose.normal);
    assert.equal(openDoorAt(town, wall).id, entry.id);
    const free = addNode(town, [-10, -2]);
    connect(town, junction, free);
    connect(town, free, entry);
    const edges = structuredClone(town.edges);
    const drop: Point = [-10.8, -8];
    moveHandle(town, { kind: "node", id: free.id }, drop);
    openDoorAt(town, nearbyWall(town, drop)!, free);
    assert.equal(free.type, "door");
    assert.deepEqual(town.edges, edges);
    assert(Math.abs(nodePose(town, free).normal!) < 1e-8);
    const townIsland = new Island(town), route = townIsland.routes.find(r => r.id === edge.id)!;
    assert(distance(route.points.at(-1)!, pose.point) < 1e-8);
    removeBuildingPart(town, wall.building, wall.building.doors.find(door => door.id === free.door)!);
    assert.equal(free.type, "endpoint");
    assert.deepEqual(town.edges, edges);
    const round = nearbyWall(town, [14, 3.4])!, roundDoor = openDoorAt(town, round), radial = nodePose(town, roundDoor);
    assert(Math.abs(distance(radial.point, round.building.center) - round.building.radius!) < 1e-8);
    assert(Math.abs(radial.normal! - 90 * radians) < 1e-8);
    assert.deepEqual(parseDesign(serializeDesign(town)), town);
});

test("Ridge insertion, extension, joining and polygon drawing", () => {
    const d = syntheticDesign();
    const east = addFeature(d, "ridge", [[15, -15], [19, -5], [21, 7], [14, 13]],
        [5, { level: "A", offset: 2 }, { level: "A", offset: 8 }, 9]);
    const west = addFeature(d, "ridge", [[-20, -11], [-22, 2], [-19, 13]]);
    // Each committed click uses the same state transition as the canvas event.
    const terrain = new Island(d).terrain, grid = terrain.grid;
    const saved = serializeDesign(d), history = new History(d);
    const eastMid = featureLine(d, "ridge", east)[12], scale = 8;
    let drawing = newDrawing("ridge");
    const selected = clickDrawing(d, drawing, eastMid, scale)!;
    assert(selected.changed && selected.selection.index === 2 && selected.selection.id === east.id);
    assert.equal(east.points.length, 5);
    assert.deepEqual(east.points[2].height, { level: "A", offset: 5 });
    assert.deepEqual(drawing.points, []);
    assert(!clickDrawing(d, drawing, east.points[2].point, scale)!.changed);
    assert.equal(east.points.length, 5);
    history.record(d);
    assert.equal(serializeDesign(history.step(false)!), saved);
    assert.deepEqual(history.step(true)!.ridges.find(r => r.id === east.id)!.points, east.points);

    for (const atStart of [false, true]) {
        const doc = parseDesign(saved), before = structuredClone(west.points), journal = new History(doc);
        drawing = newDrawing("ridge");
        clickDrawing(doc, drawing, before[atStart ? 0 : before.length - 1].point, scale)!;
        const extra: Point[] = atStart ? [[-24, -17], [-25, -22]] : [[-18, 19], [-15, 24]];
        for (const p of extra)
            clickDrawing(doc, drawing, p, scale)!;
        assert.equal(serializeDesign(doc), saved);
        const heights = extra.map(p => Math.round(sample(grid, terrain.heights, ...p) + 6));
        finishExtension(doc, drawing, heights);
        const added = extra.map((point, i) => ({ point, height: heights[i] }));
        assert.deepEqual(doc.ridges.find(r => r.id === west.id)!.points, atStart ? [...added.reverse(), ...before] : [...before, ...added]);
        journal.record(doc);
        assert.equal(serializeDesign(journal.step(false)!), saved);
        assert.deepEqual(journal.step(true)!, doc);
    }

    const doc = parseDesign(saved), journal = new History(doc);
    drawing = newDrawing("ridge");
    clickDrawing(doc, drawing, [30, 7], scale)!;
    clickDrawing(doc, drawing, eastMid, scale)!;
    assert.equal(drawing.points.length, 2);
    assert.equal(doc.ridges.find(r => r.id === east.id)!.points.length, 4);
    addFeature(doc, "ridge", drawing.points, 11);
    journal.record(doc);
    assert.equal(serializeDesign(journal.step(false)!), saved);
    const near = structuredClone(doc);
    const r1 = addFeature(near, "ridge", [[0, 0], [5, 0], [10, 0]]), r2 = addFeature(near, "ridge", [[0, .6], [5, .6], [10, .6]]);
    assert.equal(drawingTarget(near, "ridge", [7.5, .5], 10)!.id, r2.id);
    assert.equal(drawingTarget(near, "ridge", [0, -1], 10)!.action, "extend");
    assert.equal(drawingTarget(near, "ridge", [5, -1], 10)!.action, "select");
    assert.equal(drawingTarget(near, "ridge", [5, -1.01], 10)!, null);
    assert.equal(drawingTarget(near, "ridge", [7.5, .05], 10)!.id, r1.id);

    for (const kind of ["planting", "clearing"] as const) {
        const doc = parseDesign(saved), area = addFeature(doc, kind, [[0, 0], [8, 0], [8, 8], [0, 8]]);
        const journal = new History(doc), original = serializeDesign(doc), vertices = "points" in area ? area.points : (area.shape as Polygon).points;
        const before = structuredClone(vertices), drawing = newDrawing(kind);
        const m = mixPoint(before[1], before[2], .5);
        assert(clickDrawing(doc, drawing, m, 10)!.changed);
        assert.equal(vertices.length, before.length + 1);
        assert.deepEqual(vertices[2], m);
        assert.deepEqual(drawing.points, []);
        journal.record(doc);
        assert.equal(serializeDesign(journal.step(false)!), original);
        const invalidDoc = parseDesign(original), boundary = addFeature(invalidDoc, kind, [[10, 0], [18, 0], [18, 8], [10, 8]]);
        const copy = serializeDesign(invalidDoc);
        assert.throws(() => insertVertex(invalidDoc, { kind, id: boundary.id }, { point: [14, 12], index: 0, fraction: .5 }), /自交/);
        assert.equal(serializeDesign(invalidDoc), copy);
    }
});