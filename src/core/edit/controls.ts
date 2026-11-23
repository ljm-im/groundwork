import { type Design, type ResolvedDesign, type Point } from "../design/v5.ts";
import { type Handle, type Selection } from "./types.ts";
import { type NodeAnchor } from "../design/shapes.ts";
import { resolveDesign } from "../design/parameters.ts";
import { advance, bearing, clamp, distance, projection, radians } from "../math/geometry.ts";
import { corners, moveNode, nodePose } from "../design/model.ts";
import { resizeRadius, rotateBuilding } from "./buildings.ts";

export function handles(design: ResolvedDesign, layers: Partial<Record<"sections" | "buildings" | "network", boolean>>, selected?: Selection | null, focus?: Selection) {
    const out: Handle[] = [];
    const add = (kind: string, id: string, point: Point, role: string, index = 0) => out.push({ kind, id, point, role, index });
    if (focus) {
        const nodeHandle = (id: string) => {
            const n = design.nodes.find(n => n.id === id);
            if (n) add("node", id, nodePose(design, n).point, n.type);
        };
        if (focus.kind === "building") {
            const b = design.buildings.find(b => b.id === focus.id);
            if (b) add("building", b.id, b.center, "center");
        }
        else if (focus.kind === "section")
            design.sections.find(s => s.id === focus.id)?.points.forEach((p, i) => add("section", focus.id, p, "vertex", i));
        else if (focus.kind === "node") nodeHandle(focus.id);
        else {
            const e = design.edges.find(e => e.id === focus.id);
            if (e && focus.kind === "via" && e.via[focus.index!]) add("via", e.id, e.via[focus.index!], "vertex", focus.index);
            if (e && focus.kind === "edge") {
                nodeHandle(e.from);
                e.via.forEach((p, i) => add("via", e.id, p, "vertex", i));
                nodeHandle(e.to);
            }
        }
        return out;
    }
    if (layers.sections)
        for (const s of design.sections) s.points.forEach((p, i) => add("section", s.id, p, "vertex", i));
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

function slideDoor(d: Design, node: Pick<NodeAnchor, "building" | "door" | "type">, p: Point) {
    const b = d.buildings.find(item => item.id === node.building)!, door = b.doors.find(item => item.id === node.door)!;
    const numeric = resolveDesign(d), before = numeric.buildings.find(item => item.id === b.id)!;
    if (b.shape !== "rect") {
        moveNode(numeric, node, p);
        door.angle = before.doors.find(v => v.id === door.id)!.angle;
        return;
    }
    const wall = corners(before), i = before.doors.find(v => v.id === door.id)!.wall!;
    door.t = projection(...p, wall[i], wall[(i + 1) % wall.length]);
}

export function moveHandle(d: Design, h: Selection, p: Point) {
    const { id, role } = h, index = h.index!;
    p = p.map(v => Math.round(v * 100) / 100) as Point;
    if (h.kind === "node" || h.kind === "via") {
        const node = h.kind === "node" ? d.nodes.find(n => n.id === id) : null;
        if (node?.type === "door") slideDoor(d, node, p);
        else if (node) node.point = p;
        else d.edges.find(e => e.id === id)!.via[index] = p;
    }
    if (h.kind === "mark") {
        const mark = d.marks.find(m => m.id === id)!;
        const building = mark.kind === "text" && d.buildings.find(b => b.id === mark.building);
        mark.point = p;
        if (building && mark.kind === "text") mark.offset = [p[0] - building.center[0], p[1] - building.center[1]];
    }
    if (h.kind === "section") {
        const ends = d.sections.find(s => s.id === id)!.points;
        if (distance(p, ends[1 - index]) >= 1) ends[index] = p;
    }
    if (h.kind === "door") slideDoor(d, { type: "door", building: id, door: role }, p);
    if (h.kind === "building") {
        const b = d.buildings.find(b => b.id === id)!,
            before = resolveDesign(d).buildings.find(b => b.id === id)!, a = (before.angle ?? 0) * radians;
        if (role === "center" || role === "body") b.center = p;
        else if (role === "title") b.titleOffset = [p[0] - b.center[0], p[1] - b.center[1]];
        else if (role === "rotate") rotateBuilding(b, bearing(b.center, p) / radians, before);
        else if (role === "size") {
            const x = p[0] - b.center[0],
                y = p[1] - b.center[1];
            b.size = [Math.max(1, 2 * Math.abs(x * Math.cos(a) + y * Math.sin(a))), Math.max(1, 2 * Math.abs(-x * Math.sin(a) + y * Math.cos(a)))];
        }
        else if (role === "inner") b.inner = clamp(distance(b.center, p), .3, before.radius! - .3);
        else resizeRadius(b, Math.max((before.inner ?? 0) + .3, distance(b.center, p)), before);
    }
}