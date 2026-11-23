import { type Clearing, type Design, type Ellipse, type Planting, type Point, type Polygon, type Sector } from "../design/v5.ts";
import { type Handle, type Selection } from "./types.ts";
import { type NodeAnchor } from "../design/shapes.ts";
import { advance, bearing, clamp, distance, projection, radians } from "../math/geometry.ts";
import { corners, moveNode, nodePose } from "../design/model.ts";
import { resizeRadius, rotateBuilding } from "./buildings.ts";
import { featureOf } from "./landforms.ts";
import { simpleBoundary } from "../math/polygon.ts";

export function handles(design: Design, layers: Partial<Record<"sections" | "plantingAreas" | "buildings" | "network", boolean>>, selected?: Selection | null) {
    const out: Handle[] = [];
    const add = (kind: string, id: string, point: Point, role: string, index = 0) => out.push({ kind, id, point, role, index });
    if (layers.sections)
        for (const s of design.sections) s.points.forEach((p, i) => add("section", s.id, p, "vertex", i));
    for (const [kind, list] of [["planting", design.vegetation.plantings], ["clearing", design.vegetation.clearings]] as const) {
        for (const item of list) {
            if (!layers.plantingAreas && !(selected?.kind === kind && selected.id === item.id)) continue;
            const shape = kind === "planting" ? { type: "polygon" as const, points: (item as Planting).points } : (item as Clearing).shape;
            if ("points" in shape) shape.points.forEach((p, i) => add(kind, item.id, p, "vertex", i));
            else {
                add(kind, item.id, shape.center, "center");
                if (shape.type === "ellipse") {
                    add(kind, item.id, advance(shape.center, 0, shape.radii[0]), "radiusX");
                    add(kind, item.id, advance(shape.center, Math.PI / 2, shape.radii[1]), "radiusY");
                }
                else for (const key of ["start", "end"] as const) add(kind, item.id, advance(shape.center, shape[key] * radians, shape.outer), key);
            }
        }
    }
    for (const b of design.buildings) if (layers.buildings || selected?.kind === "building" && selected.id === b.id) {
        if (selected?.id !== b.id) add("building", b.id, b.center, "center");
        if (b.shape === "rect") {
            corners(b).forEach((p, i) => add("building", b.id, p, "size", i));
            add("building", b.id, advance(b.center, b.angle! * radians, b.size![0] / 2 + 3), "rotate");
        }
        else {
            add("building", b.id, advance(b.center, 0, b.radius!), "radius");
            add("building", b.id, advance(b.center, (b.angle ?? 0) * radians, b.radius! + 3), "rotate");
            if (b.shape === "ring") add("building", b.id, advance(b.center, Math.PI, b.inner!), "inner");
        }
        for (const door of b.doors) {
            if (!layers.network || !design.nodes.some(n => n.type === "door" && n.building === b.id && n.door === door.id)) {
                add("door", b.id, nodePose(design, { type: "door", building: b.id, door: door.id }).point, door.id);
            }
        }
    }
    if (layers.network) {
        for (const e of design.edges) e.via.forEach((p, i) => add("via", e.id, p, "vertex", i));
        for (const n of design.nodes) add("node", n.id, nodePose(design, n).point, n.type);
    }
    return out;
}

function slideDoor(d: Design, node: NodeAnchor, p: Point) {
    const b = d.buildings.find(item => item.id === node.building)!, door = b.doors.find(item => item.id === node.door)!;
    if (b.shape !== "rect") return moveNode(d, node, p);
    const wall = corners(b);
    door.t = projection(...p, wall[door.wall!], wall[(door.wall! + 1) % wall.length]);
}

export function moveHandle(d: Design, h: Selection, p: Point) {
    const { id, role } = h, index = h.index!;
    p = p.map(v => Math.round(v * 100) / 100) as Point;
    if (h.kind === "node" || h.kind === "via") {
        const node = h.kind === "node" ? d.nodes.find(n => n.id === id) : null;
        if (node?.type === "door") slideDoor(d, node, p);
        else if (node) moveNode(d, node, p);
        else d.edges.find(e => e.id === id)!.via[index] = p;
    }
    if (h.kind === "section") {
        const ends = d.sections.find(s => s.id === id)!.points;
        if (distance(p, ends[1 - index]) >= 1) ends[index] = p;
    }
    if (h.kind === "planting" || h.kind === "clearing") {
        const item = featureOf(d, h)!, clearing = item as Clearing;
        const shape = h.kind === "clearing" ? clearing.shape! : item as Planting;
        if (role === "vertex") {
            const copy = (shape as Polygon).points.slice(); copy[index] = p;
            if (simpleBoundary(copy)) (shape as Polygon).points = copy;
        }
        else if (role === "center") (shape as Ellipse | Sector).center = p;
        else if (role === "radiusX" || role === "radiusY") {
            const dim = role === "radiusX" ? 0 : 1;
            const ellipse = shape as Ellipse;
            ellipse.radii[dim] = Math.max(1, Math.abs(p[dim] - ellipse.center[dim]));
        }
        else {
            const sector = shape as Sector, key = role as "start" | "end";
            const angle = bearing(sector.center, p) / radians;
            const delta = ((angle - sector[key] + 540) % 360) - 180;
            sector[key] = role === "start" ? clamp(sector.start + delta, sector.end - 359, sector.end - 1) : clamp(sector.end + delta, sector.start + 1, sector.start + 359);
            sector.outer = Math.max(1, distance(sector.center, p));
        }
    }
    if (h.kind === "door") slideDoor(d, { type: "door", building: id, door: role }, p);
    if (h.kind === "building") {
        const b = d.buildings.find(b => b.id === id)!,
            a = b.angle! * radians;
        if (role === "center" || role === "body") b.center = p;
        else if (role === "title") b.titleOffset = [p[0] - b.center[0], p[1] - b.center[1]];
        else if (role === "rotate") rotateBuilding(b, bearing(b.center, p) / radians);
        else if (role === "size") {
            const x = p[0] - b.center[0],
                y = p[1] - b.center[1];
            b.size = [Math.max(1, 2 * Math.abs(x * Math.cos(a) + y * Math.sin(a))), Math.max(1, 2 * Math.abs(-x * Math.sin(a) + y * Math.cos(a)))];
        }
        else if (role === "inner") b.inner = clamp(distance(b.center, p), .3, b.radius! - .3);
        else resizeRadius(b, Math.max((b.inner ?? 0) + .3, distance(b.center, p)));
    }
}