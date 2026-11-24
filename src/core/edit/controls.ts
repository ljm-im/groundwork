import { type Design, type ResolvedDesign, type Section, type Point } from "../design/v5.ts";
import { type Handle, type Selection } from "./types.ts";
import { distance } from "../math/geometry.ts";

export function sectionHandles(design: ResolvedDesign, visible: boolean, focus?: Selection): Handle[] {
    if (!visible && !focus) return [];
    return design.sections.filter(s => !focus || s.id === focus.id).flatMap(s =>
        s.points.map((point, index) => ({ kind: "section", id: s.id, point, role: "vertex", index })));
}

function roundedPoint(p: Point): Point {
    return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
}

export function sectionHandlePoint(section: Section, index: number, p: Point): Point | undefined {
    const point = roundedPoint(p);
    if (distance(point, section.points[1 - index]) >= 1) return point;
}

export function moveHandle(d: Design, h: Handle, p: Point) {
    if (h.kind === "mark") d.marks.find(m => m.id === h.id)!.point = roundedPoint(p);
    if (h.kind === "section") {
        const section = d.sections.find(s => s.id === h.id)!, index = h.index!, point = sectionHandlePoint(section, index, p);
        if (point) section.points[index] = point;
    }
}