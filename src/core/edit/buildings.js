import { advance, bearing, distance, mixPoint, nearest, radians, sample } from "../math/geometry.ts";
import { corners, moveNode, nodePose } from "../design/model.js";
import { newId } from "./topology.js";

export function canPlaceBuilding(island, center) {
    const { terrain, routes } = island, [x, y] = center;
    const box = [[x - 4, y - 3], [x + 4, y - 3], [x + 4, y + 3], [x - 4, y + 3]];
    if ([...box, center].some(p => p[0] < terrain.grid.xMin || p[1] < terrain.grid.yMin ||
    p[0] > terrain.grid.xMax || p[1] > terrain.grid.yMax || sample(terrain.grid, terrain.heights, ...p) < 0))
        return false;
    const gap = p => Math.hypot(Math.max(0, Math.abs(p[0] - x) - 4), Math.max(0, Math.abs(p[1] - y) - 3));
    // A segment can enter the rectangle between its vertices. Clip its two axis
    // intervals before measuring the distance to the nearest side or corner.
    function segmentGap(a, b) {
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
            if (shape.signedDistance(x, y) <= 0 || shape.polygon.some((p, i) => segmentGap(p, shape.polygon[(i + 1) % 4]) === 0))
                return false;
        }
        else if (gap(b.center) <= b.radius && (b.shape !== "ring" || box.some(p => distance(p, b.center) >= b.inner)))
            return false;
    }
    return !routes.some(r => r.points.slice(1).some((p, i) => segmentGap(r.points[i], p) <= r.edge.width / 2));
}

export function placeBuilding(d, point, zone) {
    const id = newId(d.buildings, "building");
    const b = { id, name: "新建筑 " + id.split("-").at(-1), shape: "rect", center: point.slice(), size: [8, 6], angle: 0, height: 4, color: "#c78b69", doors: [], showTitle: true };
    if (zone)
        b.zone = zone;
    d.buildings.push(b);
    return b;
}

export function titlePoint(d, b) {
    const offset = b.titleOffset ?? d.labels.find(l => l.building === b.id)?.offset ?? [0, 0];
    return [b.center[0] + offset[0], b.center[1] + offset[1]];
}

export function setShape(d, b, shape) {
    if (b.shape === shape)
        return;
    const positions = b.doors.map(door => nodePose(d, { type: "door", building: b.id, door: door.id }).point);
    const size = b.size ?? [b.radius * 2, b.radius * 2], radius = b.radius ?? Math.sqrt(size[0] * size[1] / Math.PI);
    if (b.pad != null)
        b.pad = shape === "rect" ? Math.max(0, b.pad - radius) : radius + b.pad;
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
        moveNode(d, { type: "door", building: b.id, door: door.id }, positions[i]);
    });
}

export function rotateBuilding(b, angle) {
    if (b.shape !== "rect")
        for (const door of b.doors)
            door.angle += angle - (b.angle ?? 0);
    b.angle = angle;
}

export function resizeRadius(b, radius) {
    if (b.pad != null)
        b.pad = Math.max(0, b.pad + radius - b.radius);
    b.radius = radius;
}

export function doorNode(d, b, door) {
    let node = d.nodes.find(n => n.type === "door" && n.building === b.id && n.door === door.id);
    if (!node) {
        node = { id: newId(d.nodes, "door-node"), type: "door", name: b.name + "·" + (door.name ?? door.id), building: b.id, door: door.id };
        d.nodes.push(node);
    }
    return node;
}

export function addDoor(d, b, wall = 0) {
    const id = newId(b.doors, "door"), door = { id, name: "门 " + id.split("-").at(-1) };
    if (b.shape === "rect")
        Object.assign(door, { wall, t: .5 });
    else
        door.angle = b.angle ?? 0;
    b.doors.push(door);
    return doorNode(d, b, door);
}

export function nearbyWall(design, p, tolerance = 2) {
    let best = null;
    for (const building of design.buildings) {
        let point, pose;
        if (building.shape === "rect") {
            const wall = corners(building), h = nearest(...p, wall, true);
            point = mixPoint(wall[h.segment], wall[(h.segment + 1) % 4], h.t);
            pose = { wall: h.segment, t: h.t };
        }
        else {
            const angle = bearing(building.center, p);
            point = advance(building.center, angle, building.radius);
            pose = { angle: angle / radians };
        }
        const gap = distance(point, p);
        if (gap <= tolerance && (!best || gap < best.gap))
            best = { building, point, pose, gap };
    }
    return best;
}

export function openDoorAt(design, hit, node) {
    const b = hit.building;
    let door = b.doors.find(door => distance(nodePose(design, { type: "door", building: b.id, door: door.id }).point, hit.point) < .35);
    if (!door) {
        const id = newId(b.doors, "door");
        door = { id, name: "门 " + id.split("-").at(-1), ...hit.pose };
        b.doors.push(door);
    }
    if (!node)
        return doorNode(design, b, door);
    Object.assign(node, { type: "door", building: b.id, door: door.id });
    for (const key of ["point", "direction", "through", "otherThrough", "detachedDoor"])
        delete node[key];
    return node;
}

function relatedNodes(d, b, door) {
    return d.nodes.filter(n => n.type === "door" && n.building === b.id && (!door || n.door === door.id));
}

export function doorRoads(d, b, door) {
    const ids = new Set(relatedNodes(d, b, door).map(n => n.id));
    return d.edges.filter(e => ids.has(e.from) || ids.has(e.to));
}

export function removeBuildingPart(d, b, door) {
    const connected = new Set(doorRoads(d, b, door).flatMap(e => [e.from, e.to]));
    for (const n of relatedNodes(d, b, door)) {
        if (connected.has(n.id)) {
            n.point = nodePose(d, n).point.slice();
            n.type = "endpoint";
            n.detachedDoor = b.name;
            delete n.building;
            delete n.door;
            delete n.direction;
        }
        else
            d.nodes = d.nodes.filter(other => other !== n);
    }
    if (door) {
        b.doors = b.doors.filter(item => item !== door);
        return;
    }
    d.buildings = d.buildings.filter(item => item !== b);
    d.labels = d.labels.filter(l => l.building !== b.id);
    for (const y of d.yards ?? [])
        if (y.buildings)
            y.buildings = y.buildings.filter(id => id !== b.id);
}