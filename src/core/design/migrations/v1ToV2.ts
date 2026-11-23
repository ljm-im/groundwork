import { type FixedRoad, type ImportDesign, type ImportNode } from "./legacy.ts";
import { type Edge, type Point } from "../types.ts";

interface RoadCut { station: number; node: ImportNode }
interface SourceRoad { data: FixedRoad; s: Float64Array; cuts: RoadCut[] }

import { distance, nearest, pointAt, stations } from "../../math/geometry.ts";

// The version-one importer is the only reader of the old road collection.
export function migrateDesign(d: ImportDesign) {
    if (d.version !== 1)
        return d;
    const roads: SourceRoad[] = (d.fixedRoads ?? []).map(data => ({ data, s: stations(data.points), cuts: [] }));
    const used = new Set([...d.nodes, ...d.edges].map(o => o.id));
    function unique(base: string) {
        let id = base, i = 1;
        while (used.has(id))
            id = base + "-" + ++i;
        used.add(id);
        return id;
    }
    function cut(road: SourceRoad, station: number, node?: ImportNode | null, suffix?: string): ImportNode {
        const found = road.cuts.find(c => Math.abs(c.station - station) < .05);
        if (found)
            return found.node;
        const point = pointAt(road.data.points, road.s, station).slice() as Point;
        node ??= d.nodes.find(n => n.point && distance(n.point, point) < .06);
        if (!node) {
            node = { id: unique(road.data.id + "-" + suffix), name: road.data.name + " " + suffix, type: "endpoint", point };
            d.nodes.push(node);
        }
        node.point = point;
        road.cuts.push({ station, node });
        return node;
    }
    for (const n of d.nodes)
        if (n.fixedRoad) {
            const road = roads.find(r => r.data.id === n.fixedRoad);
            if (!road)
                throw new Error("“" + n.name + "”的原道路不存在");
            cut(road, n.at == null ? road.s[n.vertex!] : n.at * road.s.at(-1)!, n);
            delete n.fixedRoad;
            delete n.vertex;
            delete n.at;
        }
    for (const r of roads) {
        cut(r, 0, null, "起点");
        cut(r, r.s.at(-1)!, null, "终点");
    }
    // A connector ending on an older polyline shares a real junction with it.
    for (const r of roads)
        for (const c of [...r.cuts])
            for (const other of roads) {
                if (other === r)
                    continue;
                const { distance: gap, segment, t } = nearest(...c.node.point!, other.data.points);
                if (gap < .08)
                    cut(other, other.s[segment] + t * (other.s[segment + 1] - other.s[segment]), c.node, "路口");
            }
    // Intersecting authored straight lines on the same terrace share their crossing.
    for (const [i, a] of roads.entries())
        for (const b of roads.slice(i + 1)) {
            if (a.data.points.length !== 2 || b.data.points.length !== 2)
                continue;
            const [p, q] = a.data.points, [v, w] = b.data.points;
            const ax = q[0] - p[0], ay = q[1] - p[1], bx = w[0] - v[0], by = w[1] - v[1], det = ax * by - ay * bx;
            if (Math.abs(det) < 1e-9)
                continue;
            const dx = v[0] - p[0], dy = v[1] - p[1], t = (dx * by - dy * bx) / det, u = (dx * ay - dy * ax) / det;
            if (t > .001 && t < .999 && u > .001 && u < .999) {
                const n = cut(a, t * a.s.at(-1)!, null, "路口");
                cut(b, u * b.s.at(-1)!, n);
            }
        }
    for (const r of roads) {
        const { points, id, name, grade, width, ...surface } = r.data;
        const mode = points.length > 2 || ["east-link", "west-link"].includes(id) ? "smooth" : "straight";
        const cuts = r.cuts.sort((a, b) => a.station - b.station);
        let previous;
        for (let i = 1; i < cuts.length; i++) {
            const a = cuts[i - 1], b = cuts[i], length = b.station - a.station, via = [];
            if (points.length > 2) {
                const count = Math.max(1, Math.ceil(length / 13.5));
                for (let j = 1; j < count; j++)
                    via.push(pointAt(points, r.s, a.station + length * j / count));
            }
            const cls = d.roadClasses[grade], edge: Edge = { id: unique(i === 1 ? id : id + "-" + i), name: cuts.length > 2 ? name + " " + i : name,
                from: a.node.id, to: b.node.id, via, grade, width, comfort: cls.comfort, maxGrade: cls.maxGrade, corridor: cls.corridor, mode, ...surface };
            if (surface.stairUntil != null)
                edge.stairUntil = Math.max(0, surface.stairUntil - a.station);
            d.edges.push(edge);
            if (previous) {
                a.node.type = "junction";
                if (a.node.through)
                    (a.node.otherThrough ??= []).push([previous.id, edge.id]);
                else
                    a.node.through = [previous.id, edge.id];
            }
            previous = edge;
        }
    }
    delete d.fixedRoads;
    for (const [grade, radius] of Object.entries({ street: 12, path: 5, stair: 3 })) {
        if (d.roadClasses[grade])
            Object.assign(d.roadClasses[grade], { minRadius: radius, cornerRadius: 2 });
    }
    delete d.routing.turnDegrees;
    d.routing.viaTolerance ??= 1;
    d.version = 2;
    return d;
}