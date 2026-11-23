import { type Design, type Expression, type Point, type Building, type Door, type RoadNode } from "../design/v5.ts";
import { type Terrain, type Route } from "../design/results.ts";
import { advance, bearing, distance, mixPoint, nearest, radians, sampleDefined, eachCell } from "../math/geometry.ts";
import { corners, moveNode, nodePose } from "../design/model.ts";
import { resolveDesign } from "../design/parameters.ts";
import { newId } from "./topology.ts";

export function canPlaceBuilding(island: { terrain: Terrain; routes: Route[] }, center: Point) {
    const { terrain, routes } = island, [x, y] = center;
    const box: Point[] = [[x - 4, y - 3], [x + 4, y - 3], [x + 4, y + 3], [x - 4, y + 3]];
    if ([...box, center].some(p => (sampleDefined(terrain.grid, terrain.heights, terrain.defined, ...p) ?? -1) < 0)) return false;
    let supported = true;
    eachCell(terrain.grid, [x - 4, y - 3, x + 4, y + 3], 0, k => {
        if (!terrain.defined[k] || terrain.heights[k] < 0) supported = false;
    });
    if (!supported) return false;
    const gap = (p: Point) => Math.hypot(Math.max(0, Math.abs(p[0] - x) - 4), Math.max(0, Math.abs(p[1] - y) - 3));
    // A segment can enter the rectangle between its vertices. Clip its two axis
    // intervals before measuring the distance to the nearest side or corner.
    function segmentGap(a: Point, b: Point) {
        let lo = 0, hi = 1;
        for (const [i, half] of [4, 3].entries()) {
            const start = a[i] - center[i], delta = b[i] - a[i];
            if (Math.abs(delta) < 1e-10) {
                if (Math.abs(start) > half) {
                    lo = 1;
                    hi = 0;
                    break;
                }
                continue;
            }
            const u = (-half - start) / delta, v = (half - start) / delta;
            lo = Math.max(lo, Math.min(u, v));
            hi = Math.min(hi, Math.max(u, v));
        }
        return lo <= hi ? 0 : Math.min(gap(a), gap(b), ...box.map(p => nearest(...p, [a, b]).distance));
    }
    for (const shape of terrain.buildings) {
        const b = shape.data;
        if (shape.polygon) {
            if (shape.signedDistance(x, y) <= 0 || shape.polygon.some((p, i) => segmentGap(p, shape.polygon![(i + 1) % 4]) === 0))
                return false;
        }
        else if (gap(b.center) <= b.radius! && (b.shape !== "ring" || box.some(p => distance(p, b.center) >= b.inner!)))
            return false;
    }
    return !routes.some(r => r.points.slice(1).some((p, i) => segmentGap(r.points[i], p) <= r.edge.width / 2));
}

export function placeBuilding(d: Design, point: Point): Building {
    const id = newId(d.buildings, "building");
    const b: Building = { id, label: "新建筑 " + id.split("-").at(-1), shape: "rect", center: point.slice() as Point, size: [8, 6], angle: 0, height: 4, color: "#c78b69", doors: [] };
    d.buildings.push(b);
    return b;
}

export function titlePoint(d: Design, b: Building<Expression>): Point {
    const offset = b.titleOffset ?? [0, 0];
    return [b.center[0] + offset[0], b.center[1] + offset[1]];
}

export function setShape(d: Design, b: Building<Expression>, shape: Building["shape"]) {
    if (b.shape === shape)
        return;
    const numeric = resolveDesign(d), shapeBefore = numeric.buildings.find(v => v.id === b.id)!;
    const positions = b.doors.map(door => nodePose(numeric, { type: "door", building: b.id, door: door.id }).point);
    const size: Point = shapeBefore.size ?? [shapeBefore.radius! * 2, shapeBefore.radius! * 2], radius = shapeBefore.radius ?? Math.sqrt(size[0] * size[1] / Math.PI);
    if (b.pad != null)
        b.pad = shape === "rect" ? Math.max(0, shapeBefore.pad! - radius) : radius + shapeBefore.pad!;
    b.shape = shape;
    if (shape === "rect") {
        b.size = size;
        b.angle ??= 0;
        delete b.radius;
        delete b.inner;
    }
    else {
        b.radius = radius;
        delete b.size;
        delete b.inner;
    }
    b.doors.forEach((door, i) => {
        delete door.wall;
        delete door.t;
        delete door.angle;
        const current = resolveDesign(d);
        moveNode(current, { type: "door", building: b.id, door: door.id }, positions[i]);
        Object.assign(door, current.buildings.find(v => v.id === b.id)!.doors[i]);
    });
}

export function offsetBuildingParts(b: Building<Expression>, key: "angle" | "radius", delta: number) {
    if (key === "angle" && b.shape !== "rect") {
        for (const door of b.doors) if (typeof door.angle === "number") door.angle += delta;
    }
    if (key === "radius" && typeof b.pad === "number") b.pad = Math.max(0, b.pad + delta);
}

export function rotateBuilding(b: Building, angle: number): void;
export function rotateBuilding(b: Building<Expression>, angle: number, before: Building): void;
export function rotateBuilding(b: Building<Expression>, angle: number, before?: Building) {
    offsetBuildingParts(b, "angle", angle - Number((before ?? b).angle ?? 0));
    b.angle = angle;
}

export function resizeRadius(b: Building<Expression>, radius: number, before: Building) {
    offsetBuildingParts(b, "radius", radius - before.radius!);
    b.radius = radius;
}

export function doorNode(d: Design, b: Building<Expression>, door: Door<Expression>) {
    let node = d.nodes.find(n => n.type === "door" && n.building === b.id && n.door === door.id);
    if (!node) {
        node = { id: newId(d.nodes, "door-node"), type: "door", label: b.label + " " + (door.label ?? door.id), building: b.id, door: door.id };
        d.nodes.push(node);
    }
    return node;
}

export function addDoor(d: Design, b: Building<Expression>, wall = 0) {
    const id = newId(b.doors, "door"), door: Door = { id, label: "门 " + id.split("-").at(-1) };
    if (b.shape === "rect")
        Object.assign(door, { wall, t: .5 });
    else
        door.angle = resolveDesign(d).buildings.find(v => v.id === b.id)!.angle ?? 0;
    b.doors.push(door);
    return doorNode(d, b, door);
}

export function nearbyWall(design: Design, p: Point, tolerance = 2) {
    let best: { building: Building; point: Point; pose: Pick<Door, "wall" | "t" | "angle">; gap: number } | null = null;
    for (const building of resolveDesign(design).buildings) {
        let point, pose;
        if (building.shape === "rect") {
            const wall = corners(building), h = nearest(...p, wall, true);
            point = mixPoint(wall[h.segment], wall[(h.segment + 1) % 4], h.t);
            pose = { wall: h.segment, t: h.t };
        }
        else {
            const angle = bearing(building.center, p);
            point = advance(building.center, angle, building.radius!);
            pose = { angle: angle / radians };
        }
        const gap = distance(point, p);
        if (gap <= tolerance && (!best || gap < best.gap))
            best = { building, point, pose, gap };
    }
    return best;
}

export function openDoorAt(design: Design, hit: NonNullable<ReturnType<typeof nearbyWall>>, node?: RoadNode<Expression> | null) {
    const b = design.buildings.find(b => b.id === hit.building.id)!;
    const numeric = resolveDesign(design);
    let door = b.doors.find(door => distance(nodePose(numeric, { type: "door", building: b.id, door: door.id }).point, hit.point) < .35);
    if (!door) {
        const id = newId(b.doors, "door");
        door = { id, label: "门 " + id.split("-").at(-1), ...hit.pose };
        b.doors.push(door);
    }
    if (!node)
        return doorNode(design, b, door);
    Object.assign(node, { type: "door", building: b.id, door: door.id });
    for (const key of ["point", "direction", "directionMode", "through", "otherThrough", "detachedDoor"] as const)
        delete node[key];
    return node;
}

function relatedNodes(d: Design, b: Building<Expression>, door?: Door<Expression>) {
    return d.nodes.filter(n => n.type === "door" && n.building === b.id && (!door || n.door === door.id));
}

export function doorRoads(d: Design, b: Building<Expression>, door?: Door<Expression>) {
    const ids = new Set(relatedNodes(d, b, door).map(n => n.id));
    return d.edges.filter(e => ids.has(e.from) || ids.has(e.to));
}

export function removeBuildingPart(d: Design, b: Building<Expression>, door?: Door<Expression>) {
    const connected = new Set(doorRoads(d, b, door).flatMap(e => [e.from, e.to]));
    for (const n of relatedNodes(d, b, door)) {
        if (connected.has(n.id)) {
            n.point = nodePose(resolveDesign(d), n.id).point.slice() as Point;
            n.type = "endpoint";
            n.detachedDoor = b.label;
            delete n.building;
            delete n.door;
            delete n.direction;
            delete n.directionMode;
        }
        else
            d.nodes = d.nodes.filter(other => other !== n);
    }
    if (door) {
        b.doors = b.doors.filter(item => item.id !== door.id);
        return;
    }
    d.buildings = d.buildings.filter(item => item.id !== b.id);
    d.marks = d.marks.filter(m => m.kind !== "text" || m.building !== b.id);
}