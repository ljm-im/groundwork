import { type Design, type Expression, type RoadNode, type Edge, type Point, type Segment, type RoadPair } from "../design/v5.ts";
import { type Route } from "../design/results.ts";
import { distance, nearest } from "../math/geometry.ts";
import { throughPairs } from "../design/model.ts";

export function newId(list: { id: string }[], prefix: string) {
    let i = 1;
    while (list.some(o => o.id === prefix + "-" + i)) i++;
    return prefix + "-" + i;
}

export function addNode(d: Design, point: Point): RoadNode {
    const id = newId(d.nodes, "node");
    const node: RoadNode = { id, label: "新节点 " + id.split("-").at(-1)!, type: "junction", point: [...point] };
    d.nodes.push(node);
    return node;
}

export function connect(d: Design, from: RoadNode<Expression>, to: RoadNode<Expression>): Edge {
    const { width, comfort, maxGrade, corridor } = d.roadClasses.path;
    const edge: Edge = { id: newId(d.edges, "edge"), label: from.label + " → " + to.label, from: from.id, to: to.id,
        via: [], grade: "path", width, comfort, maxGrade, corridor };
    d.edges.push(edge);
    return edge;
}

export function setSegment<K extends keyof Segment>(edge: Edge<Expression>, index: number, key: K, value: Segment[K] | false | "" | null) {
    const segments = edge.segments ?? Array.from({ length: edge.via.length + 1 }, () => ({}));
    const option = { ...segments[index] };
    if (value == null || value === false || value === "") delete option[key]; else option[key] = value;
    segments[index] = option;
    if (segments.some(s => s && Object.keys(s).length)) edge.segments = segments;
    else delete edge.segments;
}

export function insertVia(edge: Edge<Expression>, index: number, p: Point) {
    if (edge.segments) {
        const option = edge.segments[index];
        edge.segments.splice(index, 0, option?.mode ? { mode: option.mode } : {});
    }
    edge.via.splice(index, 0, p.slice() as Point);
}

export function removeVia(edge: Edge<Expression>, index: number) {
    if (edge.segments) {
        const [before, after] = edge.segments.slice(index, index + 2), merged = { ...before };
        delete merged.exactEnd;
        if (after?.exactEnd) merged.exactEnd = true;
        edge.segments.splice(index, 2, merged);
    }
    edge.via.splice(index, 1);
}

export function splitRoad(d: Design, route: Route, point: Point, index: number) {
    const e = d.edges.find(edge => edge.id === route.id)!, oldEnd = d.nodes.find(n => n.id === e.to)!;
    if (distance(route.points[0], point) < .02 || distance(route.points.at(-1)!, point) < .02) return null;
    const node = addNode(d, point);
    node.label = "分岔路口 " + node.id.split("-").at(-1)!;
    const after = { ...e, id: newId(d.edges, "edge"), label: node.label + " → " + oldEnd.label, from: node.id, via: e.via.slice(index) };
    if (route.edge.stairUntil != null) {
        const hit = nearest(...point, route.points);
        const station = route.s[hit.segment] + hit.t * (route.s[hit.segment + 1] - route.s[hit.segment]);
        after.stairUntil = Math.max(0, route.edge.stairUntil - station);
        e.stairUntil = Math.min(route.edge.stairUntil, station);
    }
    if (e.segments) {
        after.segments = e.segments.slice(index).map(s => ({ ...s }));
        e.segments = e.segments.slice(0, index + 1).map(s => ({ ...s }));
        delete e.segments.at(-1)!.exactEnd;
    }
    e.to = node.id;
    e.via = e.via.slice(0, index);
    // An existing waypoint at the cut is now the junction itself.
    if (e.via.length && distance(e.via.at(-1)!, point) < .02) removeVia(e, e.via.length - 1);
    if (after.via.length && distance(after.via[0], point) < .02) {
        after.via.shift(); after.segments?.shift();
    }
    node.through = [e.id, after.id];
    for (const pair of throughPairs(oldEnd)) if (pair[0] === e.id) pair[0] = after.id;
    d.edges.splice(d.edges.indexOf(e) + 1, 0, after);
    return node;
}

export function removeLinks(d: Design, removed: ReadonlySet<string>) {
    const dirty = new Set<string>();
    d.edges = d.edges.filter(e => !removed.has(e.id));
    for (const n of d.nodes) {
        const keep: RoadPair[] = [];
        for (const pair of throughPairs(n)) {
            if (pair.some(id => removed.has(id))) pair.filter(id => !removed.has(id)).forEach(id => dirty.add(id));
            else keep.push(pair);
        }
        if (keep.length) n.through = keep[0]; else delete n.through;
        if (keep.length > 1) n.otherThrough = keep.slice(1); else delete n.otherThrough;
    }
    return dirty;
}