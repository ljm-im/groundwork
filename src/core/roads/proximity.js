import { angleDiff, bearing, bounds, clamp, distance, mixPoint, radians, stations } from "../math/geometry.js";

function disk(a, b, center, radius) {
    const dx = b[0] - a[0],
        dy = b[1] - a[1],
        px = a[0] - center[0],
        py = a[1] - center[1];
    const norm = dx * dx + dy * dy;
    if (!norm) return null;
    const middle = -(dx * px + dy * py) / norm,
        perpendicular = (dx * py - dy * px) ** 2 / norm;
    if (perpendicular >= radius * radius) return null;
    const span = Math.sqrt((radius * radius - perpendicular) / norm);
    const lo = Math.max(0, middle - span),
        hi = Math.min(1, middle + span);
    return hi > lo ? [lo, hi] : null;
}

function slab(offset, rate, low, high, open = false) {
    if (Math.abs(rate) < 1e-12) {
        const inside = open ? offset > low && offset < high : offset >= low && offset <= high;
        return inside ? [0, 1] : null;
    }
    const a = (low - offset) / rate,
        b = (high - offset) / rate;
    const lo = Math.max(0, Math.min(a, b)),
        hi = Math.min(1, Math.max(a, b));
    return hi > lo ? [lo, hi] : null;
}

// A road segment swept by the clearance radius is a rectangle with two round caps.
function nearCapsule(segment, other, radius) {
    const { a, b } = segment, p = other.a, q = other.b, ux = (q[0] - p[0]) / other.length, uy = (q[1] - p[1]) / other.length;
    const x = a[0] - p[0],
        y = a[1] - p[1],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
    const intervals = [disk(a, b, p, radius), disk(a, b, q, radius)].filter(Boolean);
    const along = slab(x * ux + y * uy, dx * ux + dy * uy, 0, other.length);
    const across = slab(y * ux - x * uy, dy * ux - dx * uy, -radius, radius, true);
    if (along && across) {
        const lo = Math.max(along[0], across[0]),
            hi = Math.min(along[1], across[1]);
        if (hi > lo) intervals.push([lo, hi]);
    }
    if (!intervals.length) return null;
    const lo = Math.min(...intervals.map(i => i[0])),
        hi = Math.max(...intervals.map(i => i[1]));
    return [segment.station + lo * segment.length, segment.station + hi * segment.length];
}

function segments(route, shared, radius) {
    const result = [];
    for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1],
            b = route.points[i],
            length = distance(a, b);
        if (length < 1e-8) continue;
        let parts = [
            [0, 1]
        ];
        for (const center of shared) {
            const skip = disk(a, b, center, radius);
            if (!skip) continue;
            parts = parts.flatMap(([lo, hi]) => [
                [lo, Math.min(hi, skip[0])],
                [Math.max(lo, skip[1]), hi]
            ].filter(([l, h]) => h - l > 1e-8));
        }
        for (const [lo, hi] of parts) {
            const p = mixPoint(a, b, lo),
                q = mixPoint(a, b, hi);
            result.push({ a: p, b: q, box: bounds([p, q]), length: (hi - lo) * length, station: route.s[i - 1] + lo * length });
        }
    }
    return result;
}

function sustained(intervals, minimum) {
    intervals.sort((a, b) => a[0] - b[0]);
    const runs = [];
    for (const [lo, hi] of intervals) {
        const previous = runs.at(-1);
        if (previous && lo <= previous[1] + 1e-7) previous[1] = Math.max(previous[1], hi);
        else runs.push([lo, hi]);
    }
    return runs.filter(([lo, hi]) => hi - lo >= minimum - 1e-7);
}

export function overlappingLocations(a, b, shared, rules, withRanges = false) {
    const threshold = (a.edge.width + b.edge.width) / 2 + rules.clearance;
    const left = segments(a, shared, rules.junctionRadius),
        right = segments(b, shared, rules.junctionRadius),
        contacts = [];
    for (const p of left)
        for (const q of right) {
            const u = p.box,
                v = q.box;
            if (u[0] >= v[2] + threshold || u[2] <= v[0] - threshold || u[1] >= v[3] + threshold || u[3] <= v[1] - threshold) continue;
            const onA = nearCapsule(p, q, threshold);
            if (!onA) continue;
            const onB = nearCapsule(q, p, threshold);
            if (onB) contacts.push({ onA, onB });
        }
    const runsA = sustained(contacts.map(c => c.onA), rules.overlapLength);
    const runsB = sustained(contacts.map(c => c.onB), rules.overlapLength);
    const points = [];
    for (const ra of runsA)
        for (const rb of runsB) {
            const matches = contacts.filter(c => c.onA[1] > ra[0] && c.onA[0] < ra[1] && c.onB[1] > rb[0] && c.onB[0] < rb[1]);
            if (!matches.length) continue;
            const interval = matches[Math.floor(matches.length / 2)].onA,
                station = (interval[0] + interval[1]) / 2;
            const i = a.s.findIndex(s => s >= station);
            if (i > 0) {
                const point = mixPoint(a.points[i - 1], a.points[i], (station - a.s[i - 1]) / (a.s[i] - a.s[i - 1]));
                const spans = withRanges ? [[a, "onA"], [b, "onB"]].flatMap(([r, key]) =>
                    sustained(matches.map(c => c[key]), 0).map(([from, to]) => ({ road: r.id, from, to }))) : null;
                points.push(withRanges ? { point, spans } : point);
            }
        }
    return points;
}

// Minimize centreline distance over pairs of segment parameters whose stations are far enough apart.
function selfContact(a, b, p, q, startGap, la, lb, separation, radius) {
    const ax = b[0] - a[0], ay = b[1] - a[1], bx = q[0] - p[0], by = q[1] - p[1];
    const gap = ([t, u]) => startGap + u * lb - t * la - separation;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]], feasible = [];
    for (let i = 0; i < 4; i++) {
        const c = corners[i], next = corners[(i + 1) % 4], g = gap(c), h = gap(next);
        if (g >= 0) feasible.push(c);
        if (g * h < 0) feasible.push(mixPoint(c, next, g / (g - h)));
    }
    if (!feasible.length) return null;
    const cross = ax * by - ay * bx, dx = p[0] - a[0], dy = p[1] - a[1];
    if (Math.abs(cross) > 1e-12) {
        const t = (dx * by - dy * bx) / cross, u = (dx * ay - dy * ax) / cross;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && gap([t, u]) >= 0) return mixPoint(a, b, t);
    }
    let best = radius * radius - 1e-9, hit = null;
    for (let i = 0; i < feasible.length; i++) {
        const [t, u] = feasible[i], end = feasible[(i + 1) % feasible.length];
        const dt = end[0] - t, du = end[1] - u;
        const x = t * ax - u * bx - dx, y = t * ay - u * by - dy;
        const vx = dt * ax - du * bx, vy = dt * ay - du * by;
        const f = clamp(-(x * vx + y * vy) / (vx * vx + vy * vy || 1));
        const squared = (x + f * vx) ** 2 + (y + f * vy) ** 2;
        if (squared < best) {
            best = squared;
            hit = mixPoint(mixPoint(a, b, t + f * dt), mixPoint(p, q, u + f * du), .5);
        }
    }
    return hit;
}

export function selfOverlaps(points, width, s = stations(points), withRanges = false) {
    const radius = width + 1, separation = 2 * width, contacts = [];
    const boxes = points.slice(1).map((p, i) => bounds([points[i], p]));
    for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i], la = s[i + 1] - s[i];
        if (!la) continue;
        for (let j = i + 1; j < boxes.length; j++) {
            const b = boxes[j], lb = s[j + 1] - s[j];
            if (!lb || s[j + 1] - s[i] <= separation + 1e-8 ||
        b[0] >= a[2] + radius || b[2] <= a[0] - radius || b[1] >= a[3] + radius || b[3] <= a[1] - radius) continue;
            const hit = selfContact(points[i], points[i + 1], points[j], points[j + 1], s[j] - s[i], la, lb, separation, radius);
            if (!hit) continue;
            const previous = contacts.find(c => distance(withRanges ? c.point : c, hit) <= radius);
            if (withRanges) {
                const record = previous ?? { point: hit, ranges: [] };
                const partA = { a: points[i], b: points[i + 1], length: la, station: s[i] }, partB = { a: points[j], b: points[j + 1], length: lb, station: s[j] };
                record.ranges.push(nearCapsule(partA, partB, radius) ?? [s[i], s[i + 1]], nearCapsule(partB, partA, radius) ?? [s[j], s[j + 1]]);
                if (!previous) contacts.push(record);
            }
            else if (!previous) contacts.push(hit);
        }
    }
    if (withRanges) for (const record of contacts) record.ranges = sustained(record.ranges, 0);
    return contacts;
}

// A corner contributes both incident headings. Compare every such pair within a physical interval.
export function sharpBends(points, s = stations(points), spanLength = 3, limit = 45 * radians) {
    const spans = [];
    for (let i = 1; i < points.length; i++) if (s[i] > s[i - 1] + 1e-8) {
        spans.push({ start: s[i - 1], end: s[i], angle: bearing(points[i - 1], points[i]), point: points[i - 1] });
    }
    const bends = [];
    for (let i = 1, first = 0; i < spans.length; i++) {
        const span = spans[i];
        while (spans[first].end < span.start - spanLength - 1e-8) first++;
        let change = 0, from = span.start;
        for (let j = first; j < i; j++) {
            const diff = angleDiff(span.angle, spans[j].angle);
            if (diff > change) {
                change = diff; from = spans[j].start;
            }
        }
        if (change <= limit + 1e-7) continue;
        const previous = bends.at(-1);
        if (!previous || span.start > previous.end + spanLength) bends.push({ angle: change, point: span.point, end: span.start, from, to: span.end });
        else {
            previous.end = span.start; previous.to = span.end; previous.from = Math.min(previous.from, from);
            if (change > previous.angle) {
                previous.angle = change; previous.point = span.point;
            }
        }
    }
    return bends;
}