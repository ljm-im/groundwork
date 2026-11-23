import { test } from "node:test";
import assert from "node:assert/strict";
import { type Point, type Polygon } from "../src/core/design/v5.ts";
import { advance, distance, pointAt, radians, mixPoint } from "../src/core/math/geometry.ts";
import { addDoor, canPlaceBuilding, doorRoads, placeBuilding, removeBuildingPart, rotateBuilding, setShape, titlePoint, nearbyWall, openDoorAt } from "../src/core/edit/buildings.ts";
import { History } from "../src/core/edit/history.ts";
import { Island } from "../src/core/island.ts";
import { moveNode, nodePose, parseDesign, serializeDesign, buildingShape } from "../src/core/design/model.ts";
import { moveHandle } from "../src/core/edit/controls.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { addNode, connect, removeLinks, splitRoad } from "../src/core/edit/topology.ts";
import { addFeature, insertVertex, clickDrawing, newDrawing } from "../src/core/edit/landforms.ts";
import { branchJunction, junctionDesign, syntheticDesign } from "./scenarios.ts";

test("Moving buildings, shared nodes and snapped entrances", () => {
    const moved = junctionDesign();
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



test("Splitting and removing roads maintains through pairs and approaches", () => {
    const again = new Island(junctionDesign());
    const forkNode = branchJunction(again.design);
    const main = forkNode.through!.map(id => again.routes.find(r => r.id === id)!);
    const branch = again.routes.find(r => r.edge.from === forkNode.id && !main.includes(r))!;
    const portal = again.design.edges.find(e => again.design.nodes.some(n => n.id === e.to && n.type === "door"))!,
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

test("Polygon drawing, insertion and undo preserve planting and clearing boundaries", () => {
    const saved = serializeDesign(syntheticDesign());
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