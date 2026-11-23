import { type Clearing, type Design, type Planting, type Point, type Polygon } from "../design/v5.ts";
import { type Box } from "../math/geometry.ts";
import { type Drawing, type DrawingTarget, type Feature, type FeatureMap, type FeatureKind, type Selection, type VertexHit } from "./types.ts";
import { bounds, distance, mixPoint, nearest } from "../math/geometry.ts";
import { zonePolygon as shapePolygon } from "../design/shapes.ts";
import { newId } from "./topology.ts";
import { simpleBoundary } from "../math/polygon.ts";

export const featureNames = { planting: "绿化区", clearing: "林间空地" };

export function features<K extends FeatureKind>(d: Design, kind: K): FeatureMap[K][] {
    return ({ planting: d.vegetation.plantings, clearing: d.vegetation.clearings })[kind] as FeatureMap[K][];
}

export function featureOf<K extends FeatureKind>(d: Design, h: { kind: K; id: string }): FeatureMap[K] | undefined;
export function featureOf(d: Design, h: Selection | null): Feature | undefined;
export function featureOf(d: Design, h: Selection | null) {
    return features(d, h?.kind as FeatureKind)?.find(item => item.id === h!.id);
}

export function featureLine(kind: FeatureKind, item: Feature): Point[] {
    return kind === "planting" ? (item as Planting).points : shapePolygon((item as Clearing).shape);
}

export function featureBounds(kind: FeatureKind, item: Feature): Box {
    return bounds(featureLine(kind, item));
}

export function addFeature<K extends FeatureKind>(d: Design, kind: K, points: Point[]): FeatureMap[K] {
    const list = features(d, kind), id = newId(list, kind);
    const item = { id, name: featureNames[kind] + " " + id.split("-").at(-1) };
    if (points.length < 3 || !simpleBoundary(points))
        throw Error("请绘制至少有三个顶点且不自交的边界");
    const polygon = points.map(p => p.slice() as Point);
    if (kind === "clearing")
        (item as Clearing).shape = { type: "polygon", points: polygon };
    else
        Object.assign(item, { points: polygon, density: .35, clump: .5, size: [.7, 1.7], species: "mixed", rows: false, spacing: 6, natural: false, feather: 0 });
    list.push(item as FeatureMap[K]);
    return item as FeatureMap[K];
}

export function featureHit(kind: FeatureKind, item: Feature, p: Point) {
    const line = featureLine(kind, item), h = nearest(...p, line, true);
    const point = mixPoint(line[h.segment], line[(h.segment + 1) % line.length], h.t);
    const divisions = kind === "clearing" ? ((item as Clearing).shape as Polygon | undefined)?.smooth || 1 : 1;
    const at = (h.segment + h.t) / divisions;
    const last = line.length / divisions - 1;
    const index = Math.min(last, Math.floor(at));
    return { distance: h.distance, point, index, fraction: at - index };
}

export function insertVertex(d: Design, h: Selection, hit: VertexHit) {
    const f = featureOf(d, h)!, points = h.kind === "clearing" ? ((f as Clearing).shape as Polygon | undefined)?.points : (f as Planting).points;
    if (!points)
        return null;
    const existing = points.findIndex(p => distance(p, hit.point) < .05);
    if (existing >= 0)
        return existing;
    const i = hit.index + 1;
    const copy = points.slice();
    copy.splice(i, 0, hit.point);
    if (!simpleBoundary(copy)) throw Error("插入后边界会自交，请选择另一段边界");
    points.splice(i, 0, hit.point);
    return i;
}

export const newDrawing = (kind: FeatureKind): Drawing => ({ kind, points: [], cursor: null, hover: null });

export function drawingTarget(d: Design, kind: FeatureKind, p: Point, scale: number): DrawingTarget | null {
    const tolerance = 10 / scale;
    let closest: DrawingTarget | null = null;
    for (const item of features(d, kind)) {
        if (kind === "clearing" && (item as Clearing).shape?.type !== "polygon")
            continue;
        const hit = featureHit(kind, item, p);
        if (hit.distance > tolerance || closest && hit.distance > closest.distance + 1e-8)
            continue;
        const points = kind === "clearing" ? ((item as Clearing).shape as Polygon).points : (item as Planting).points;
        let index = -1;
        for (let i = 0; i < points.length; i++) {
            const gap = distance(p, points[i]);
            if (gap <= tolerance && (index < 0 || gap < distance(p, points[index]))) index = i;
        }
        const action = index >= 0 ? "select" : "insert";
        if (closest && Math.abs(hit.distance - closest.distance) < 1e-8 && closest.action !== "insert") continue;
        closest = { kind, id: item.id, action, index, hit, point: index >= 0 ? points[index] : hit.point, distance: hit.distance };
    }
    return closest;
}

export function clickDrawing(d: Design, drawing: Drawing, p: Point, scale: number) {
    const { kind, points } = drawing;
    const target = !points.length && drawingTarget(d, kind, p, scale);
    drawing.hover = null;
    drawing.cursor = null;
    if (!target) {
        const previous = points.at(-1);
        if (!previous || distance(previous, p) > .05)
            points.push(p.map(v => +v.toFixed(2)) as Point);
        return null;
    }
    let index = target.index;
    if (target.action === "insert") {
        index = insertVertex(d, target, target.hit)!;
    }
    return { selection: { kind, id: target.id, role: "vertex", index }, changed: target.action === "insert" };
}

export function deleteFeature(d: Design, h: Selection) {
    const item = featureOf(d, h)!, list = features(d, h.kind as FeatureKind);
    if (h.role === "vertex") {
        const pts = h.kind === "clearing" ? ((item as Clearing).shape as Polygon).points : (item as Planting).points;
        if (pts.length <= 3)
            throw Error("已达到最少顶点数，可返回对象后删除整个对象");
        if (!simpleBoundary((pts as Point[]).filter((p, i) => i !== h.index)))
            throw Error("删除后边界会自交");
        pts.splice(h.index!, 1);
        return { kind: h.kind, id: h.id };
    }
    list.splice(list.indexOf(item), 1);
    return null;
}