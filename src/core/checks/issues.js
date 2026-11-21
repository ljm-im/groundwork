import { bounds, pointAt } from "../math/geometry.ts";
import { buildingShape, nodePose, zonePolygon } from "../design/model.ts";

export function objectIssues(island, selection) {
    if (!selection)
        return [];
    const { kind, id } = selection;
    if (kind === "edge" || kind === "via")
        return island.issues.filter(i => i.road === id || i.other === id || i.spans?.some(s => s.road === id));
    const nodes = kind === "building" ? island.design.nodes.filter(n => n.type === "door" && n.building === id).map(n => n.id) : kind === "node" ? [id] : [];
    return island.issues.filter(i => {
        if (kind === "building" && i.building === id || kind === "zone" && i.zone === id || nodes.includes(i.node) || nodes.includes(i.otherNode))
            return true;
        return (i.spans ?? []).some(s => {
            const r = island.routes.find(r => r.id === s.road);
            if (!r)
                return false;
            return nodes.includes(r.edge.from) && s.from < .01 || nodes.includes(r.edge.to) && s.to >= r.length - .01;
        });
    });
}

export function issueShapes(island, issue) {
    const shapes = [];
    for (const span of issue.spans ?? []) {
        const r = island.routes.find(r => r.id === span.road);
        if (!r)
            continue;
        const points = [pointAt(r.points, r.s, span.from), ...r.points.filter((p, i) => r.s[i] > span.from && r.s[i] < span.to), pointAt(r.points, r.s, span.to)];
        shapes.push({ points, width: r.edge.width, road: r.id });
    }
    const b = island.design.buildings.find(b => b.id === issue.building);
    if (b) {
        if (b.shape === "rect")
            shapes.push({ points: buildingShape(b).polygon, closed: true });
        else
            for (const radius of [b.radius, ...(b.shape === "ring" ? [b.inner] : [])]) {
                shapes.push({ points: Array.from({ length: 64 }, (_, i) => [b.center[0] + radius * Math.cos(i * Math.PI / 32), b.center[1] + radius * Math.sin(i * Math.PI / 32)]), closed: true });
            }
    }
    const z = island.design.zones.find(z => z.id === issue.zone);
    if (z)
        shapes.push({ points: zonePolygon(z.shape), closed: true });
    if (issue.otherNode)
        shapes.push({ points: [issue.point, nodePose(island.design, issue.otherNode).point] });
    if (!shapes.length)
        shapes.push({ points: [issue.point] });
    return shapes;
}

export function issueView(island, issue, w, h, baseScale) {
    const [x, y] = issue.point, box = bounds([issue.point, ...issueShapes(island, issue).flatMap(shape => shape.points)]);
    const dx = Math.max(12, x - box[0], box[2] - x), dy = Math.max(9, y - box[1], box[3] - y);
    return { center: issue.point.slice(), zoom: Math.max(.5, Math.min(7, (w * .40) / (dx * baseScale), (h * .38) / (dy * baseScale))) };
}