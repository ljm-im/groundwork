import { type Clearing, type Design, type Height, type Peak, type Planting, type Point, type Polygon, type Ridge, type RidgeVertex } from "../design/types.ts";
import { type Box } from "../math/geometry.ts";
import { type Drawing, type DrawingTarget, type Feature, type FeatureMap, type FeatureKind, type Selection, type VertexHit } from "./types.ts";
import { bounds, distance, mixPoint, nearest, spline } from "../math/geometry.ts";
import { clearingShape, elevation, zonePolygon } from "../design/model.ts";
import { newId } from "./topology.ts";
import { simpleBoundary } from "../math/polygon.ts";

export const featureNames = { peak: "山头", ridge: "山脊", planting: "绿化区", clearing: "林间空地" };

export function features<K extends FeatureKind>(d: Design, kind: K): FeatureMap[K][] {
    return ({ peak: d.peaks, ridge: d.ridges, planting: d.vegetation.plantings, clearing: d.vegetation.clearings })[kind] as FeatureMap[K][];
}

export function featureOf<K extends FeatureKind>(d: Design, h: { kind: K; id: string }): FeatureMap[K] | undefined;
export function featureOf(d: Design, h: Selection | null): Feature | undefined;
export function featureOf(d: Design, h: Selection | null) {
    return features(d, h?.kind as FeatureKind)?.find(item => item.id === h!.id);
}

export function featureLine(d: Design, kind: FeatureKind, item: Feature): Point[] {
    if (kind === "ridge")
        return spline((item as Ridge).points.map(p => p.point), false, 8);
    if (kind === "planting")
        return (item as Planting).points;
    if (kind === "clearing")
        return zonePolygon(clearingShape(d, item as Clearing));
    return [(item as Peak).center];
}

export function featureBounds(d: Design, kind: FeatureKind, item: Feature): Box {
    if (kind === "peak") {
        const { center: [x, y], radius: r } = item as Peak;
        return [x - r, y - r, x + r, y + r];
    }
    return bounds(featureLine(d, kind, item));
}

export function addFeature<K extends FeatureKind>(d: Design, kind: K, points: Point[], height: Height | Height[] = 16): FeatureMap[K] {
    const list = features(d, kind), id = newId(list, kind);
    const item = { id, name: featureNames[kind] + " " + id.split("-").at(-1) };
    if (kind === "peak")
        Object.assign(item, { center: points[0].slice(), height, radius: 14, noise: 2, scale: 10, protect: 0, cliffMin: 1.4 });
    else if (kind === "ridge") {
        if (points.length < 2 || points.some((p, i) => i && distance(p, points[i - 1]) < .05))
            throw Error("山脊至少需要两个不同的折点");
        Object.assign(item, { points: points.map((point, i) => ({ point: point.slice() as Point, height: Array.isArray(height) ? height[i] : height })),
            widths: [18, 18], widthNoise: [.18, .9, 1.7], heightNoise: [.1, 1.3, 4.4] });
    }
    else {
        if (points.length < 3 || !simpleBoundary(points))
            throw Error("请绘制至少有三个顶点且不自交的边界");
        const polygon = points.map(p => p.slice() as Point);
        if (kind === "clearing")
            (item as Clearing).shape = { type: "polygon", points: polygon };
        else
            Object.assign(item, { points: polygon, density: .35, clump: .5, size: [.7, 1.7], species: "mixed", rows: false, spacing: 6, natural: false, feather: 0 });
    }
    list.push(item as FeatureMap[K]);
    return item as FeatureMap[K];
}

export function featureHit(d: Design, kind: FeatureKind, item: Feature, p: Point) {
    const line = featureLine(d, kind, item), closed = kind !== "ridge", h = nearest(...p, line, closed);
    const point = mixPoint(line[h.segment], line[(h.segment + 1) % line.length], h.t);
    const divisions = kind === "ridge" ? 8 : kind === "clearing" ? ((item as Clearing).shape as Polygon | undefined)?.smooth || 1 : 1;
    const at = (h.segment + h.t) / divisions;
    const last = kind === "ridge" ? (item as Ridge).points.length - 2 : line.length / divisions - 1;
    const index = Math.min(last, Math.floor(at));
    return { distance: h.distance, point, index, fraction: at - index };
}

export function insertVertex(d: Design, h: Selection, hit: VertexHit) {
    const f = featureOf(d, h)!, points = h.kind === "clearing" ? ((f as Clearing).shape as Polygon | undefined)?.points : (f as Planting | Ridge).points;
    if (!points)
        return null;
    const pos = (p: Point | RidgeVertex) => h.kind === "ridge" ? (p as RidgeVertex).point : p as Point;
    const existing = points.findIndex(p => distance(pos(p), hit.point) < .05);
    if (existing >= 0)
        return existing;
    const i = hit.index + 1;
    if (h.kind === "ridge") {
        const ridgePoints = points as RidgeVertex[];
        const a = ridgePoints[i - 1].height, b = ridgePoints[i].height, t = hit.fraction;
        const height = typeof a === "object" && a?.level && typeof b === "object" && a.level === b?.level ? { level: a.level, offset: (a.offset ?? 0) * (1 - t) + (b.offset ?? 0) * t } :
            elevation(a, d.levels) * (1 - t) + elevation(b, d.levels) * t;
        ridgePoints.splice(i, 0, { point: hit.point, height });
    }
    else {
        const polygon = points as Point[], copy = polygon.slice();
        copy.splice(i, 0, hit.point);
        if (!simpleBoundary(copy)) throw Error("插入后边界会自交，请选择另一段边界");
        polygon.splice(i, 0, hit.point);
    }
    return i;
}

export const newDrawing = (kind: FeatureKind): Drawing => ({ kind, points: [], cursor: null, extension: null, hover: null });

export function drawingTarget(d: Design, kind: FeatureKind, p: Point, scale: number): DrawingTarget | null {
    const tolerance = 10 / scale;
    let closest: DrawingTarget | null = null;
    for (const item of features(d, kind)) {
        if (kind === "clearing" && (item as Clearing).shape?.type !== "polygon")
            continue;
        const hit = featureHit(d, kind, item, p);
        if (hit.distance > tolerance || closest && hit.distance > closest.distance + 1e-8)
            continue;
        const points = kind === "ridge" ? (item as Ridge).points.map(v => v.point) : kind === "clearing" ? ((item as Clearing).shape as Polygon).points : (item as Planting).points;
        let endpoint = -1, vertex = -1;
        for (let i = 0; i < points.length; i++) {
            const gap = distance(p, points[i]);
            if (gap > tolerance)
                continue;
            if (kind === "ridge" && (i === 0 || i === points.length - 1)) {
                if (endpoint < 0 || gap < distance(p, points[endpoint]))
                    endpoint = i;
            }
            else if (vertex < 0 || gap < distance(p, points[vertex]))
                vertex = i;
        }
        const index = endpoint >= 0 ? endpoint : vertex, action = endpoint >= 0 ? "extend" : vertex >= 0 ? "select" : "insert";
        if (closest && Math.abs(hit.distance - closest.distance) < 1e-8 && closest.action !== "insert" && action !== "extend")
            continue;
        closest = { kind, id: item.id, action, index, hit, point: index >= 0 ? points[index] : hit.point, distance: hit.distance };
    }
    return closest;
}

export function clickDrawing(d: Design, drawing: Drawing, p: Point, scale: number) {
    const { kind, points, extension } = drawing;
    const target = !extension && !points.length && drawingTarget(d, kind, p, scale);
    drawing.hover = null;
    drawing.cursor = null;
    if (!target) {
        const previous = points.at(-1) ?? extension?.origin;
        if (!previous || distance(previous, p) > .05)
            points.push(p.map(v => +v.toFixed(2)) as Point);
        return null;
    }
    let index = target.index;
    if (target.action === "extend")
        drawing.extension = { id: target.id, atStart: index === 0, origin: target.point.slice() as Point };
    if (target.action === "insert") {
        index = insertVertex(d, target, target.hit)!;
    }
    return { selection: { kind, id: target.id, role: "vertex", index }, changed: target.action === "insert" };
}

export function finishExtension(d: Design, drawing: Drawing, heights: Height[]) {
    const { id, atStart } = drawing.extension!, ridge = d.ridges.find(item => item.id === id)!;
    const added = drawing.points.map((point, i) => ({ point: point.slice() as Point, height: heights[i] }));
    if (atStart)
        ridge.points.unshift(...added.reverse());
    else
        ridge.points.push(...added);
    return { kind: "ridge", id, role: "vertex", index: atStart ? 0 : ridge.points.length - 1 };
}

export function deleteFeature(d: Design, h: Selection) {
    const item = featureOf(d, h)!, list = features(d, h.kind as FeatureKind);
    if (h.role === "vertex") {
        const pts = h.kind === "clearing" ? ((item as Clearing).shape as Polygon).points : (item as Planting | Ridge).points;
        if (pts.length <= (h.kind === "ridge" ? 2 : 3))
            throw Error("已达到最少顶点数，可返回对象后删除整个对象");
        if (h.kind !== "ridge" && !simpleBoundary((pts as Point[]).filter((p, i) => i !== h.index)))
            throw Error("删除后边界会自交");
        pts.splice(h.index!, 1);
        return { kind: h.kind, id: h.id };
    }
    list.splice(list.indexOf(item), 1);
    return null;
}