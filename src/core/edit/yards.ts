import { type Edge, type RoadNode, type Point } from "../design/types.ts";
import { type Boundary } from "../design/gates.ts";
import { clamp, mixPoint } from "../math/geometry.ts";
import { perimeter } from "../math/polygon.ts";

// Return only the solid wall intervals, including openings that straddle station zero.
export function hedgeLines(yard: Boundary, gates: RoadNode[], edges: Edge[]) {
    const { points, s, length } = perimeter(yard), gaps = [];
    for (const gate of gates) {
        const half = Math.max(1.2, ...edges.filter(e => e.from === gate.id || e.to === gate.id).map(e => e.width / 2)) + .55;
        for (const wrap of [-length, 0, length]) {
            const at = gate.at! * length + wrap;
            if (at + half > 0 && at - half < length) gaps.push([Math.max(0, at - half), Math.min(length, at + half)]);
        }
    }
    const lines: Point[][] = [];
    function solid(a: number, b: number) {
        if (a >= b) return;
        const line = [];
        for (let i = 0; i + 1 < points.length; i++) {
            if (a >= s[i + 1] || b <= s[i]) continue;
            const lerp = (d: number) => mixPoint(points[i], points[i + 1], clamp((d - s[i]) / (s[i + 1] - s[i])));
            if (!line.length) line.push(lerp(a));
            line.push(lerp(b));
        }
        if (line.length > 1) lines.push(line);
    }
    let start = 0;
    for (const [a, b] of gaps.sort((a, b) => a[0] - b[0])) {
        solid(start, a);
        start = Math.max(start, b);
    }
    solid(start, length);
    return lines;
}