import { type Design, type ResolvedDesign, type Point } from "../design/v5.ts";
import { type Handle, type Selection } from "./types.ts";
import { distance } from "../math/geometry.ts";

export function sectionHandles(design: ResolvedDesign, visible: boolean, focus?: Selection): Handle[] {
    if (!visible && !focus) return [];
    return design.sections.filter(s => !focus || s.id === focus.id).flatMap(s =>
        s.points.map((point, index) => ({ kind: "section", id: s.id, point, role: "vertex", index })));
}

export function moveHandle(d: Design, h: Handle, p: Point) {
    const point = p.map(v => Math.round(v * 100) / 100) as Point;
    if (h.kind === "mark") d.marks.find(m => m.id === h.id)!.point = point;
    if (h.kind === "section") {
        const ends = d.sections.find(s => s.id === h.id)!.points, i = h.index!;
        if (distance(point, ends[1 - i]) >= 1) ends[i] = point;
    }
}