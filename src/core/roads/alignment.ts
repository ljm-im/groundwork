import { type Alignment, type RoutePart, type RoutingSurface } from "../design/results.ts";
import { type Design, type Edge, type Point } from "../design/types.ts";
import { advance, angleDiff, bearing, clamp, distance, nearest, radians, resample, sample, stations } from "../math/geometry.ts";

export function radiusAt(a: Point, b: Point, c: Point) {
    const x = b[0] - a[0], y = b[1] - a[1], u = c[0] - b[0], v = c[1] - b[1];
    const cross = Math.abs(x * v - y * u), dot = x * u + y * v;
    if (cross < 1e-10)
        return dot < -1e-9 ? 0 : Infinity;
    return Math.hypot(x, y) * Math.hypot(u, v) * distance(a, c) / (2 * cross);
}

export function tangent(a: Point, b: Point, c: Point) {
    const left = bearing(a, b), right = bearing(b, c);
    if (angleDiff(left, right) > 150 * radians)
        return Math.atan2(Math.sin(left) + Math.sin(right), Math.cos(left) + Math.cos(right));
    // Tangent at the middle point of the circle through three unequally spaced controls.
    return left + right - bearing(a, c);
}

export function fillet(a: Point, b: Point, c: Point, radius: number, step: number, tolerance = Infinity) {
    const into = bearing(a, b), out = bearing(b, c);
    const turn = Math.atan2(Math.sin(out - into), Math.cos(out - into));
    if (Math.abs(turn) < 1e-5 || Math.PI - Math.abs(turn) < 1e-5 || radius <= 0)
        return null;
    const factor = Math.tan(Math.abs(turn) / 2);
    const trim = Math.min(radius * factor, distance(a, b) * .49, distance(b, c) * .49);
    if (trim < 1e-6)
        return null;
    const r = trim / factor, start = advance(b, into, -trim), end = advance(b, out, trim);
    const center = advance(start, into + Math.sign(turn) * Math.PI / 2, r);
    const angle = bearing(center, start), half = Math.max(2, Math.ceil(r * Math.abs(turn) / (2 * step)));
    const points = Array.from({ length: 2 * half + 1 }, (_, i) => advance(center, angle + turn * i / (2 * half), r));
    points[0] = start;
    points[points.length - 1] = end;
    const mid = points[half], gap = distance(mid, b);
    if (gap <= tolerance)
        return { first: points.slice(0, half + 1), last: points.slice(half), middle: mid, radius: r };
    // Bring the circular crown into the waypoint disc. Two tangent biarcs join the
    // displaced arc back to the original straight lines without moving their cores.
    const shift = (1 - tolerance / gap), dx = (b[0] - mid[0]) * shift, dy = (b[1] - mid[1]) * shift;
    const shifted = (p: Point): Point => [p[0] + dx, p[1] + dy];
    const middle = tolerance === 0 ? b.slice() as Point : shifted(mid);
    const crown = angle + turn / 2, delta = Math.sign(turn) * Math.min(Math.abs(turn) / 10, 1e-5);
    const first = [...points.slice(0, half).map(shifted), shifted(advance(center, crown - delta, r)), middle];
    const last = [middle, shifted(advance(center, crown + delta, r)), ...points.slice(half + 1).map(shifted)];
    const blend = Math.max(2 * r, 4 * gap);
    const before = advance(b, into, -Math.min(distance(a, b) * .49, trim + blend));
    const after = advance(b, out, Math.min(distance(b, c) * .49, trim + blend));
    return { first: [...biarc(before, first[0], into, into, step), ...first.slice(1)],
        last: [...last, ...biarc(last.at(-1)!, after, out, out, step).slice(1)], middle, radius: r };
}

// A biarc interpolates both end tangents and has a shared tangent at its internal join.
function arc(a: Point, b: Point, heading: number, step: number) {
    const dx = b[0] - a[0], dy = b[1] - a[1], nx = -Math.sin(heading), ny = Math.cos(heading);
    const twice = 2 * (dx * nx + dy * ny);
    if (Math.abs(twice) < 1e-8)
        return resample([a, b], step);
    const r = (dx * dx + dy * dy) / twice, center: Point = [a[0] + nx * r, a[1] + ny * r];
    const start = bearing(center, a);
    let turn = Math.atan2(Math.sin(bearing(center, b) - start), Math.cos(bearing(center, b) - start));
    if (turn * r < 0)
        turn += Math.sign(r) * 2 * Math.PI;
    const count = Math.max(2, Math.ceil(Math.abs(r * turn) / step));
    const line = [a];
    for (let i = 1; i < count; i++)
        line.push(advance(center, start + turn * i / count, Math.abs(r)));
    line.push(b);
    return line;
}

export function biarc(a: Point, b: Point, incoming: number | null, outgoing: number | null, step: number) {
    const chord = bearing(a, b), length = distance(a, b);
    if (length < 1e-6)
        return [a, b];
    const start = incoming ?? (outgoing == null ? chord : 2 * chord - outgoing), end = outgoing ?? (incoming == null ? chord : 2 * chord - incoming);
    const cap = Math.min(step * .2, length * .035);
    return [a, ...biarcSpan(advance(a, start, cap), advance(b, end, -cap), start, end, step), b];
}

function biarcSpan(a: Point, b: Point, incoming: number, outgoing: number, step: number) {
    const len = distance(a, b);
    if (len < 1e-7)
        return [a, b];
    const chord = bearing(a, b), start = incoming ?? (outgoing == null ? chord : 2 * chord - outgoing), end = outgoing ?? (incoming == null ? chord : 2 * chord - incoming);
    const cos0 = Math.cos(start), sin0 = Math.sin(start), cos1 = Math.cos(end), sin1 = Math.sin(end);
    const dot = (b[0] - a[0]) * (cos0 + cos1) + (b[1] - a[1]) * (sin0 + sin1);
    const den = 2 * (1 - cos0 * cos1 - sin0 * sin1);
    const handle = den > 1e-8 ? len * len / (Math.sqrt(dot * dot + den * len * len) + dot) : dot > 1e-8 ? len * len / (2 * dot) : len / 2;
    const mid: Point = [(a[0] + b[0] + handle * (cos0 - cos1)) / 2, (a[1] + b[1] + handle * (sin0 - sin1)) / 2];
    return [...arc(a, mid, start, step), ...arc(b, mid, end + Math.PI, step).reverse().slice(1)];
}

export function turnLimit(radius: number, length: number) {
    return 2 * Math.asin(Math.min(1, length / (2 * radius)));
}

export function exemptRadius(route: Alignment, index: number, s: Float64Array, design: Design) {
    const at = s[index], landing = design.routing.landing ?? 3;
    if (route.rounds?.some(([lo, hi]) => at >= lo - 1e-6 && at <= hi + 1e-6))
        return true;
    if (route.platforms?.some(p => Math.abs(p - at) <= route.edge.width / 2 + 1e-6))
        return true;
    if (index === 1 && route.branches?.[0] || index === s.length - 2 && route.branches?.[1])
        return true;
    return route.landings?.some(p => at <= landing + 1e-7 && distance(route.points[0], p) < 1e-6 ||
    s.at(-1)! - at <= landing + 1e-7 && distance(route.points.at(-1)!, p) < 1e-6);
}

// Project the entire sampled alignment onto the radius, waypoint and corridor constraints.
// Locked straight/fillet samples remain exact. Each movable point is kept inside its own
// corridor; a routed point can only move to passable ground.
export function fairAlignment(design: Design, terrain: RoutingSurface, edge: Edge, controls: Point[], parts: RoutePart[], landings: Point[], platforms: number[], entry: number | null, exit: number | null) {
    const rule = design.roadClasses[edge.grade], radius = rule.minRadius;
    const points: Point[] = [], spans: number[] = [], locked: boolean[] = [], pins = new Map<number, Point>(), ranges: [RoutePart, number, number][] = [];
    for (const p of parts) {
        const start = points.length ? points.length - 1 : 0;
        for (const [j, q] of p.points.entries()) {
            if (points.length && !j)
                continue;
            points.push(q.slice() as Point);
            spans.push(p.index);
            locked.push(false);
        }
        const end = points.length - 1;
        ranges.push([p, start, end]);
        if (p.lock)
            for (let j = start; j <= end; j++)
                locked[j] = true;
    }
    if (points.length < 2)
        return { points, rounds: [], platforms: [] };
    for (let i = 0; i < ranges.length - 1; i++) {
        const [p, , at] = ranges[i], next = ranges[i + 1][0];
        if (next.index === p.index || !edge.via[p.index])
            continue;
        const target = edge.via[p.index];
        if (edge.segments?.[p.index]?.exactEnd) {
            if (!p.round && !next.round) {
                points[at] = target.slice() as Point;
                // The segment solver gives the two flanking samples the same tangent.
                // Keep that short tangent while the rest of the edge adjusts around it.
                locked[at] = true;
                if (!p.failed && !next.failed)
                    locked[at - 1] = locked[at + 1] = true;
            }
        }
        else
            pins.set(at, target);
        if (!p.round && !next.round && !!p.lock !== !!next.lock) {
            locked[p.lock ? at + 1 : at - 1] = true;
        }
    }
    locked[0] = locked[points.length - 1] = true;
    if (points.length > 3) {
        if (entry != null)
            locked[1] = true;
        if (exit != null)
            locked[points.length - 2] = true;
    }
    const originalS = stations(points);
    const platformIndices = platforms.map(p => originalS.reduce((best, v, i) => Math.abs(v - p) < Math.abs(originalS[best] - p) ? i : best, 0));
    for (const i of platformIndices)
        locked[i] = true;
    const isLanding = (p: Point) => landings.some(q => distance(p, q) <= (design.routing.landing ?? 3));
    const exempt = points.map((p, i) => isLanding(p) || platformIndices.includes(i));
    const domains = controls.slice(1).map((q, i) => [controls[i], q]);
    const tolerance = design.routing.viaTolerance ?? 1;
    const normals = points.map((p, i) => {
        const angle = bearing(points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)]); return [-Math.sin(angle), Math.cos(angle)];
    });
    function move(i: number, dx: number, dy: number) {
        if (locked[i])
            return;
        const [nx, ny] = normals[i], shift = dx * nx + dy * ny;
        const p = points[i], q: Point = [p[0] + shift * nx, p[1] + shift * ny], pin = pins.get(i);
        if (pin) {
            const length = distance(q, pin);
            if (length > tolerance) {
                q[0] = pin[0] + (q[0] - pin[0]) * tolerance / length;
                q[1] = pin[1] + (q[1] - pin[1]) * tolerance / length;
            }
        }
        const part = spans[i];
        if (nearest(...q, domains[part]).distance > edge.corridor + 1e-6)
            return;
        if ((edge.segments?.[part]?.mode ?? edge.mode ?? "route") === "route" &&
      (sample(terrain.grid, terrain.clearance, ...q) < edge.width / 2 || sample(terrain.grid, terrain.heights, ...q) < design.routing.minHeight))
            return;
        points[i] = q;
    }
    const target = radius * 1.008;
    for (let pass = 0; pass < 220; pass++) {
        let worst = 0;
        for (let k = 1; k + 1 < points.length; k++) {
            const i = pass % 2 ? points.length - 1 - k : k;
            if (exempt[i] || locked[i] && locked[i - 1] && locked[i + 1])
                continue;
            const a = points[i - 1], b = points[i], c = points[i + 1];
            const r = radiusAt(a, b, c);
            if (r >= target)
                continue;
            const dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy);
            if (len < 1e-6 || len >= 2 * target)
                continue;
            const side = Math.sign(dx * (b[1] - a[1]) - dy * (b[0] - a[0])) || 1;
            const lift = Math.sqrt(target * target - len * len / 4) * side;
            const center: Point = [(a[0] + c[0]) / 2 + dy / len * lift, (a[1] + c[1]) / 2 - dx / len * lift];
            const norm = distance(b, center) || 1;
            const x = center[0] + (b[0] - center[0]) * target / norm - b[0], y = center[1] + (b[1] - center[1]) * target / norm - b[1];
            const t = clamp(distance(a, b) / (distance(a, b) + distance(b, c) || 1));
            const u = 1 - t, weight = Number(!locked[i]) + (!locked[i - 1] ? u * u : 0) + (!locked[i + 1] ? t * t : 0);
            if (weight < 1e-8)
                continue;
            worst = Math.max(worst, Math.hypot(x, y));
            move(i, x / weight, y / weight);
            move(i - 1, -u * x / weight, -u * y / weight);
            move(i + 1, -t * x / weight, -t * y / weight);
        }
        if (worst < 1e-6)
            break;
    }
    const s = stations(points), rounds: [number, number][] = [];
    for (const [part, a, b] of ranges) {
        part.points = points.slice(a, b + 1);
        if (part.round)
            rounds.push([s[a], s[b]]);
    }
    return { points, rounds, platforms: platformIndices.map(i => s[i]) };
}