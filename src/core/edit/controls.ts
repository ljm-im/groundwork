import { type Design, type ResolvedDesign, type Section, type Point, type PointHolder } from "../design/v5.ts";
import { type Handle, type Selection } from "./types.ts";
import { distance } from "../math/geometry.ts";
import { geometryAt, offsetPoint, placedPoint } from "../design/curveReferences.ts";
import { localPoint } from "./curveEdits.ts";

export function sectionHandles(design: ResolvedDesign, visible: boolean, focus?: Selection): Handle[] {
    if (!visible && !focus) return [];
    return design.sections.filter(s => !focus || s.id === focus.id).flatMap(s =>
        s.points.map((point, index) => ({ kind: "section", id: s.id, point, role: "vertex", index })));
}

function roundedPoint(p: Point): Point {
    return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
}

export function sectionHandlePoint(section: Section<"resolved">, index: number, p: Point, exact = false, shared = false): Point | undefined {
    const point = exact ? p : roundedPoint(p);
    if (shared || distance(point, section.points[1 - index]) >= 1) return point;
}

export function translateHolder(holder: { offset?: Point }, delta: Point) {
    const offset = offsetPoint(holder.offset ?? [0, 0], delta);
    if (offset.some(Boolean)) holder.offset = offset;
    else delete holder.offset;
}

export function movePointGeometry(d: Design, holder: PointHolder, point: Point) {
    const item = geometryAt(d, holder.point);
    if (item && "point" in item) item.point = localPoint(holder.offset ?? [0, 0], point);
}

export function moveSection(d: Design, id: string, delta: Point) {
    const section = d.sections.find(s => s.id === id)!;
    for (const holder of new Set(section.points)) translateHolder(holder, delta);
}

export function moveHandle(d: Design, h: Handle, p: Point) {
    if (h.kind === "mark") {
        const mark = d.marks.find(m => m.id === h.id)!;
        if (mark.follow === "screen") mark.screen = roundedPoint(p);
        else movePointGeometry(d, mark.point, roundedPoint(p));
    }
    if (h.kind === "section") {
        const section = d.sections.find(s => s.id === h.id)!, index = h.index!;
        const holder = section.points[index], other = section.points[1 - index];
        if (holder.point === other.point || distance(p, placedPoint(d, other)) >= 1) movePointGeometry(d, holder, p);
    }
}