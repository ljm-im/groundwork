import { advance, angleDiff, bearing, clamp, distance, eachCell, nearest, pointAt, radians, resample, sample, stations } from "../math/geometry.js";
import { nodePose, segmentMode, throughPairs } from "../design/model.js";
import { biarc, fairAlignment, fillet, tangent, turnLimit } from "./alignment.js";
import { selfOverlaps, sharpBends } from "./proximity.js";

const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
    [1, 2],
    [2, 1],
    [-1, 2],
    [-2, 1],
    [1, -2],
    [2, -1],
    [-1, -2],
    [-2, -1]
]
    .map(([x, y]) => ({ x, y, length: Math.hypot(x, y), angle: Math.atan2(-y, x) }));
const directions = steps.length;
const turns = steps.map(a => steps.map(b => angleDiff(a.angle, b.angle)));
class MinHeap {
    states = [];
    costs = [];
    push(state, cost) {
        let i = this.states.length;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.costs[parent] <= cost) break;
            this.states[i] = this.states[parent];
            this.costs[i] = this.costs[parent];
            i = parent;
        }
        this.states[i] = state;
        this.costs[i] = cost;
    }
    pop() {
        const first = this.states[0],
            state = this.states.pop(),
            cost = this.costs.pop(),
            n = this.states.length;
        if (!n) return first;
        let i = 0;
        while (2 * i + 1 < n) {
            let child = 2 * i + 1;
            if (child + 1 < n && this.costs[child + 1] < this.costs[child]) child++;
            if (this.costs[child] >= cost) break;
            this.states[i] = this.states[child];
            this.costs[i] = this.costs[child];
            i = child;
        }
        this.states[i] = state;
        this.costs[i] = cost;
        return first;
    }
}

function searchContext(t) {
    if (t.search) return t.search;
    const n = t.grid.size * directions;
    t.search = { cost: new Float64Array(n), parent: new Int32Array(n), seen: new Int32Array(n), clock: 0 };
    return t.search;
}

function segmentDomain(a, b, edge, t, rules, ends, penalty, stairRule) {
    const dx = b[0] - a[0],
        dy = b[1] - a[1],
        squared = dx * dx + dy * dy || 1;
    const corridor = (x, y) => {
        const u = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / squared);
        return (x - a[0] - u * dx) ** 2 + (y - a[1] - u * dy) ** 2 <= edge.corridor ** 2 + 1e-8;
    };
    const g = t.grid,
        radius = edge.width / 2;
    const clear = (x, y) => x >= g.xMin && x <= g.xMax && y >= g.yMin && y <= g.yMax && corridor(x, y) &&
    sample(g, t.clearance, x, y) >= radius && sample(g, t.heights, x, y) >= rules.minHeight;
    const landing = rules.landing ?? 3;
    const atEnd = (x, y) => landing > 0 && ends.some(p => (x - p[0]) ** 2 + (y - p[1]) ** 2 <= landing ** 2);
    const grade = (p, q) => (sample(g, t.heights, ...q) - sample(g, t.heights, ...p)) / (distance(p, q) || 1);
    const platform = (a, b, c) => !!stairRule && Math.abs(grade(a, b)) >= stairRule.enter && Math.abs(grade(b, c)) >= stairRule.enter;
    return { corridor, clear, atEnd, grade, platform, penalty: penalty && ((x, y) => penalty[g.index(x, y)]) };
}

// Sample a continuous connector without inserting an approach of predetermined length.
function cubic(p, b, incoming, exit, step, handle = 1 / 3) {
    const length = distance(p, b);
    const chord = bearing(p, b),
        start = incoming ?? chord,
        end = exit ?? chord;
    const a1 = advance(p, start, length * handle),
        b1 = advance(b, end, -length * handle);
    const count = Math.max(3, Math.ceil(length / step)), result = [p];
    // Intersections of consecutive sample tangents approximate the curve with exact end bearings.
    let last = p, lastX = Math.cos(start), lastY = Math.sin(start);
    for (let i = 1; i <= count; i++) {
        const u = i / count, v = 1 - u;
        const q = [0, 1].map(k => v ** 3 * p[k] + 3 * v * v * u * a1[k] + 3 * v * u * u * b1[k] + u ** 3 * b[k]);
        const ux = v * v * (a1[0] - p[0]) + 2 * u * v * (b1[0] - a1[0]) + u * u * (b[0] - b1[0]);
        const uy = v * v * (a1[1] - p[1]) + 2 * u * v * (b1[1] - a1[1]) + u * u * (b[1] - b1[1]);
        const dx = q[0] - last[0], dy = q[1] - last[1], cross = lastX * uy - lastY * ux;
        const t = (dx * uy - dy * ux) / cross, chord = Math.hypot(dx, dy);
        const along = Number.isFinite(t) && t > 0 && t < chord ? t : chord / 2;
        result.push([last[0] + along * lastX, last[1] + along * lastY]);
        last = q;
        const norm = Math.hypot(ux, uy) || 1;
        lastX = ux / norm;
        lastY = uy / norm;
    }
    result.push(b);
    return result;
}

function travel(length, grade, turn, platform, edge, rules, limit) {
    const slopeCost = length * (1 + (grade / edge.comfort) ** 2);
    return slopeCost * (Math.abs(grade) > edge.maxGrade ? rules.overGradePenalty : 1) +
    rules.turnCost * (platform ? 1 : (turn / limit) ** 2);
}

function lineCost(line, entry, exit, edge, rules, domain, arrival) {
    let total = 0, heading = entry, previousLength = 0;
    for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], length = distance(a, b);
        if (length < 1e-8) continue;
        if (!domain.clear(...b) || !domain.clear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) return Infinity;
        const angle = bearing(a, b), turn = heading == null ? 0 : angleDiff(heading, angle);
        const limit = turnLimit(rules.minRadius, previousLength ? (previousLength + length) / 2 : length) + 1e-7;
        const platform = turn > limit && i > 1 && !domain.atEnd(...a) && domain.platform(line[i - 2], a, b);
        if (turn > limit && !platform && !domain.atEnd(...a)) return Infinity;
        total += travel(length, domain.grade(a, b), turn, platform, edge, rules, limit) + length * (domain.penalty?.(...b) ?? 0);
        heading = angle;
        previousLength = length;
    }
    if (exit != null && heading != null) {
        const turn = angleDiff(heading, exit);
        if (turn > arrival + 1e-7) return Infinity;
        total += rules.turnCost * (turn / turnLimit(rules.minRadius, previousLength || rules.sampleStep)) ** 2;
    }
    return total;
}

function astar(a, b, entry, exit, edge, t, rules, domain, arrival, best, coarse = false) {
    const g = t.grid,
        { width, height, step } = g,
        s = g.index(...a);
    // A fine grid cannot turn between two lattice bearings when the turning
    // radius is large. Longer search moves admit those bearings at the same radius.
    const minimumStride = coarse ? 2.2 * rules.minRadius * Math.sin(Math.atan(.5) / 2) : 0;
    const moves = coarse ? steps.map(move => {
        const count = Math.max(1, Math.ceil(minimumStride / (step * move.length)));
        return { ...move, x: move.x * count, y: move.y * count, length: move.length * count };
    }) : steps;
    const { seen, cost, parent } = searchContext(t), stamp = ++t.search.clock;
    const heap = new MinHeap();
    // The start has one continuous heading. Only a free junction can depart in any direction.
    const start = s * directions;
    const origin = g.point(s),
        shiftX = a[0] - origin[0],
        shiftY = a[1] - origin[1];
    let goal = -1, tail = null;
    seen[start] = stamp;
    cost[start] = 0;
    parent[start] = -1;
    heap.push(start, distance(a, b));
    while (heap.states.length) {
        if (heap.costs[0] >= best) break;
        const state = heap.pop();
        if (seen[state] === -stamp) continue;
        seen[state] = -stamp;
        const first = state === start,
            u = Math.floor(state / directions),
            du = state % directions;
        const col = u % width,
            row = Math.floor(u / width);
        const x = g.x(col) + shiftX,
            y = g.y(row) + shiftY;
        const incoming = first ? entry : steps[du].angle,
            remaining = Math.hypot(b[0] - x, b[1] - y);
        if (remaining < Math.max(4.5 * step, 1.6 * minimumStride)) {
            const p = [x, y], joins = remaining < 1e-6 ? [[p, b]] : [cubic(p, b, incoming, exit, step), [p, b]];
            for (const join of joins) {
                const total = cost[state] + lineCost(join, incoming, exit, edge, rules, domain, arrival);
                if (total < best) {
                    best = total; goal = state; tail = join.slice(1);
                }
            }
        }
        const landing = domain.atEnd(x, y);
        const prev = first ? null : [x - moves[du].x * step, y + moves[du].y * step];
        for (let d = 0; d < directions; d++) {
            const move = moves[d],
                i = col + move.x,
                j = row + move.y;
            if (i < 0 || j < 0 || i >= width || j >= height) continue;
            const v = j * width + i,
                next = v * directions + d;
            if (seen[next] === -stamp) continue;
            const vx = g.x(i) + shiftX,
                vy = g.y(j) + shiftY;
            const turn = first ? (entry == null ? 0 : angleDiff(entry, Math.atan2(vy - y, vx - x))) : turns[du][d];
            const stride = step * move.length;
            const limit = turnLimit(rules.minRadius, first ? stride : (stride + moves[du].length * step) / 2) + 1e-7;
            const platform = turn > limit && !landing && edge.grade === "stair" && prev && domain.platform(prev, [x, y], [vx, vy]);
            if (turn > limit && !landing && !platform) continue;
            if (!domain.clear(vx, vy) || !domain.clear((x + vx) / 2, (y + vy) / 2)) continue;
            if (coarse && resample([[x, y], [vx, vy]], Math.min(step, rules.sampleStep)).some(p => !domain.clear(...p))) continue;
            const length = stride;
            const grade = Math.abs(sample(g, t.heights, vx, vy) - sample(g, t.heights, x, y)) / length;
            const candidate = cost[state] + travel(length, grade, turn, platform, edge, rules, limit) + length * (domain.penalty?.(vx, vy) ?? 0);
            if (seen[next] !== stamp || candidate < cost[next]) {
                seen[next] = stamp;
                cost[next] = candidate;
                parent[next] = state;
                heap.push(next, candidate + Math.hypot(vx - b[0], vy - b[1]));
            }
        }
    }
    if (goal < 0) return null;
    const points = tail.reverse();
    for (let at = goal; at !== start; at = parent[at]) {
        const p = g.point(Math.floor(at / directions));
        p[0] += shiftX;
        p[1] += shiftY;
        if (distance(p, points.at(-1)) > 1e-7) points.push(p);
    }
    if (distance(a, points.at(-1)) > 1e-7) points.push(a);
    return points.reverse();
}

function clearLine(line, domain) {
    return line.every((p, i) => domain.clear(...p) &&
    (!i || domain.clear((line[i - 1][0] + p[0]) / 2, (line[i - 1][1] + p[1]) / 2)));
}

function routedSpan(a, b, entry, exit, edge, terrain, rules, domain, joinEntry, joinExit) {
    const length = distance(a, b);
    if (length < 1e-7) return { points: [a], failed: false };
    const fail = () => ({ points: resample([a, b], rules.sampleStep), failed: true });
    if (!domain.clear(...a) || !domain.clear(...b)) return fail();
    const arrival = !joinExit && domain.atEnd(...b) ? Math.PI / 2 : turnLimit(rules.minRadius, rules.sampleStep);
    let best = null, cost = Infinity, bendPenalty = Infinity;
    function consider(line) {
        if (joinEntry && entry != null && angleDiff(entry, bearing(line[0], line[1])) > 1e-6) return;
        if (joinExit && exit != null && angleDiff(exit, bearing(line.at(-2), line.at(-1))) > 1e-6) return;
        const score = lineCost(line, entry, exit, edge, rules, domain, arrival);
        if (!Number.isFinite(score)) return;
        const s = stations(line), bends = sharpBends(line, s);
        let penalty = bends.reduce((sum, b) => sum + b.angle - Math.PI / 4, 0);
        for (const [start, angle] of [[true, entry], [false, exit]]) {
            if (angle == null) continue;
            const tip = start ? line[0] : line.at(-1), other = pointAt(line, s, start ? 2 : s.at(-1) - 2);
            penalty += Math.max(0, angleDiff(angle, start ? bearing(tip, other) : bearing(other, tip)) - 5 * radians);
            for (let i = start ? 1 : line.length - 1; i > 0 && i < line.length; i += start ? 1 : -1) {
                if ((start ? s[i - 1] : s.at(-1) - s[i]) > 3) break;
                penalty += Math.max(0, angleDiff(angle, bearing(line[i - 1], line[i])) - turnLimit(rules.minRadius, 3));
            }
        }
        // During a retry, the cost of returning to the contact cells must affect the choice
        // even when the alternative takes a sharper (but still admissible) turn.
        if (domain.penalty ? score < cost :
            penalty < bendPenalty - 1e-6 || Math.abs(penalty - bendPenalty) < 1e-6 && score < cost) {
            cost = score; best = line; bendPenalty = penalty;
        }
    }

    // Continuous candidates compete with the lattice on the same terrain and turn costs.
    for (const handle of [.32, .48]) consider(cubic(a, b, entry, exit, rules.sampleStep, handle));
    if (entry != null || exit != null) consider(biarc(a, b, entry, exit, rules.sampleStep));
    const raw = astar(a, b, entry, exit, edge, terrain, rules, domain, arrival, cost * 1.15);
    if (raw && raw.length > 1) {
        const original = [raw[0], ...raw.slice(1).flatMap((q, i) => resample([raw[i], q], rules.sampleStep).slice(1))];
        consider(original);
        const p = resample(raw, rules.sampleStep);
        for (let pass = 0; p.length > 2 && pass < rules.relaxPasses; pass++) {
            for (let i = 1; i < p.length - 1; i++) {
                const left = p[i - 1], right = p[i + 1], cur = p[i];
                let x = cur[0] + .45 * ((left[0] + right[0]) / 2 - cur[0]);
                let y = cur[1] + .45 * ((left[1] + right[1]) / 2 - cur[1]);
                if (i === 1 && entry != null) [x, y] = advance(a, entry, Math.hypot(x - a[0], y - a[1]));
                if (i === p.length - 2 && exit != null) [x, y] = advance(b, exit, -Math.hypot(x - b[0], y - b[1]));
                if (domain.clear(x, y)) p[i] = [x, y];
            }
            if (pass % 5 === 0 || pass === rules.relaxPasses - 1) consider(p.slice());
        }
    }
    if (!best) {
    // A continuous guide can cross a gap between discrete lattice headings. Its curvature
    // is resolved with neighbouring spans in the whole-edge pass below.
        const guide = cubic(a, b, entry, exit, rules.sampleStep);
        if (clearLine(guide, domain)) best = guide;
        else {
            const bypass = astar(a, b, entry, exit, edge, terrain, rules, domain, arrival, Infinity, true);
            if (bypass) {
                const corners = bypass.map((p, i) => i && i + 1 < bypass.length ? fillet(bypass[i - 1], p, bypass[i + 1], rules.minRadius * 1.02, rules.sampleStep) : null);
                const rounded = [bypass[0]];
                for (let i = 1; i < bypass.length; i++) {
                    const corner = corners[i];
                    rounded.push(...resample([rounded.at(-1), corner?.first[0] ?? bypass[i]], rules.sampleStep).slice(1));
                    if (corner) rounded.push(...corner.first.slice(1), ...corner.last.slice(1));
                }
                consider(rounded);
                if (!best && clearLine(rounded, domain) &&
          (!joinEntry || entry == null || angleDiff(entry, bearing(rounded[0], rounded[1])) < 1e-6) &&
          (!joinExit || exit == null || angleDiff(exit, bearing(rounded.at(-2), rounded.at(-1))) < 1e-6)) best = rounded;
            }
        }
    }
    return best ? { points: best, failed: false } : fail();
}

export function clearLead(node, edge, rules) {
    return node.type === "door" || node.type === "gate" ? (rules.clearLead ?? edge.width / 2 + .5) : 0;
}

function routeOnce(design, t, edge, entry, exit, penalty) {
    const rules = { ...design.routing, minRadius: design.roadClasses[edge.grade].minRadius }, startNode = design.nodes.find(n => n.id === edge.from), endNode = design.nodes.find(n => n.id === edge.to);
    const from = { ...nodePose(design, startNode, nodePose(design, endNode).point), ...entry };
    const to = { ...nodePose(design, endNode, from.point), ...exit };
    const controls = [from.point, ...edge.via, to.point],
        parts = [];
    const landings = [from.normal != null && from.point, to.normal != null && to.point].filter(Boolean);
    const first = from.round?.at(-1) ?? advance(from.point, from.normal ?? from.angle ?? 0, from.lead ?? clearLead(startNode, edge, rules));
    const last = to.round?.at(-1) ?? advance(to.point, to.normal ?? to.angle ?? 0, to.lead ?? clearLead(endNode, edge, rules));
    const straight = (a, b, index) => parts.push({ points: resample([a, b], rules.sampleStep), failed: false, lock: true, index });
    // A waypoint on the short wall clearance splits that segment at the clicked station.
    let lo = 0,
        hi = edge.via.length;
    if (from.round) parts.push({ points: from.round, round: true, lock: true, index: 0 });
    else if (from.angle != null) {
        let p = from.point,
            station = 0;
        while (lo < hi) {
            const q = edge.via[lo],
                hit = nearest(...q, [from.point, first]);
            if (hit.distance > 1e-6 || hit.t < station) break;
            straight(p, q, lo);
            p = q;
            station = hit.t;
            lo++;
        }
        if (distance(p, first) > 1e-7) straight(p, first, lo);
    }
    if (!to.round && to.angle != null) {
        let station = 0;
        while (hi > lo) {
            const hit = nearest(...edge.via[hi - 1], [to.point, last]);
            if (hit.distance > 1e-6 || hit.t < station) break;
            station = hit.t;
            hi--;
        }
    }
    const line = [first, ...edge.via.slice(lo, hi), last];
    const modes = line.slice(1).map((_, i) => segmentMode(edge, lo + i));
    const corners = line.map((p, i) => i > 0 && i + 1 < line.length && modes[i - 1] === "straight" && modes[i] === "straight" ?
        fillet(line[i - 1], p, line[i + 1], design.roadClasses[edge.grade].cornerRadius, rules.sampleStep, edge.segments?.[lo + i - 1]?.exactEnd ? 0 : rules.viaTolerance ?? 1) : null);
    const smallCorners = corners.filter(c => c && c.radius < design.roadClasses[edge.grade].cornerRadius - 1e-6)
        .map(c => ({ point: c.middle, radius: c.radius, requested: design.roadClasses[edge.grade].cornerRadius,
            arcs: [{ road: edge.id, ends: [c.first[0], c.last.at(-1)] }] }));
    if (from.smallCorner) smallCorners.push(from.smallCorner);
    if (to.smallCorner) smallCorners.push(to.smallCorner);
    const headings = line.map((p, i) => {
        if (!i) return from.angle;
        if (i === line.length - 1) return to.angle == null ? null : to.angle + Math.PI;
        if (modes[i - 1] === "straight" && modes[i] !== "straight") return bearing(line[i - 1], p);
        if (modes[i] === "straight" && modes[i - 1] !== "straight") return bearing(p, line[i + 1]);
        return tangent(line[i - 1], p, line[i + 1]);
    });
    for (let i = 0; i < modes.length; i++) {
        const index = lo + i, mode = modes[i], a = corners[i]?.last.at(-1) ?? line[i], b = corners[i + 1]?.first[0] ?? line[i + 1];
        if (corners[i]) parts.push({ index, points: corners[i].last, round: true, lock: true });
        if (distance(a, b) > 1e-7) {
            if (mode === "straight") straight(a, b, index);
            else if (mode === "smooth") parts.push({ index, points: biarc(a, b, headings[i], headings[i + 1], rules.sampleStep) });
            else {
                const domain = segmentDomain(a, b, edge, t, rules, landings, penalty, edge.grade === "stair" && design.roadClasses.stair);
                const part = routedSpan(a, b, headings[i], headings[i + 1], edge, t, rules, domain, i > 0 || from.through, i + 1 < modes.length || to.through);
                parts.push({ ...part, index });
            }
        }
        if (corners[i + 1]) parts.push({ index, points: corners[i + 1].first, round: true, lock: true });
    }
    if (to.round) parts.push({ points: [...to.round].reverse(), round: true, lock: true, index: edge.via.length });
    else if (to.angle != null) {
        let p = last;
        for (let i = hi; i < edge.via.length; i++) {
            if (distance(p, edge.via[i]) > 1e-7) straight(p, edge.via[i], i);
            p = edge.via[i];
        }
        if (distance(p, to.point) > 1e-7) straight(p, to.point, edge.via.length);
    }
    if (!parts.length) straight(from.point, to.point, 0);
    const points = parts.flatMap((part, i) => i ? part.points.slice(1) : part.points);
    const platforms = [];
    if (edge.grade === "stair") {
        const s = stations(points), landing = rules.landing ?? 3;
        for (let i = 1; i + 1 < points.length; i++) {
            const p = points[i];
            if (landings.some(q => distance(q, p) <= landing)) continue;
            const turn = angleDiff(bearing(points[i - 1], p), bearing(p, points[i + 1]));
            const step = (s[i + 1] - s[i - 1]) / 2, enter = design.roadClasses.stair.enter;
            const grade = (a, b) => Math.abs(sample(t.grid, t.heights, ...b) - sample(t.grid, t.heights, ...a)) / (distance(a, b) || 1);
            if (turn > Math.max(turnLimit(rules.minRadius, step), Math.PI / 4) && grade(points[i - 1], p) >= enter && grade(p, points[i + 1]) >= enter) platforms.push(s[i]);
        }
    }
    const geometry = fairAlignment(design, t, edge, controls, parts, landings, platforms, from.angle, to.angle);
    const branches = [startNode, endNode].map(n => !!n.through && !throughPairs(n).some(pair => pair.includes(edge.id)));
    return { id: edge.id, edge, controls, parts, landings, branches, smallCorners, ...geometry };
}

export function routeEdge(design, terrain, edge, entry, exit) {
    let route = routeOnce(design, terrain, edge, entry, exit);
    route.selfOverlaps = selfOverlaps(route.points, edge.width);
    if (!route.selfOverlaps.length) return route;
    const g = terrain.grid, penalty = new Float32Array(g.size), radius = 2 * (edge.width + 1);
    for (const [x, y] of route.selfOverlaps) {
        eachCell(g, [x, y, x, y], radius, (k, px, py) => {
            const w = Math.max(0, 1 - Math.hypot(px - x, py - y) / radius);
            penalty[k] = Math.max(penalty[k], w * design.routing.overGradePenalty);
        });
    }
    const retry = routeOnce(design, terrain, edge, entry, exit, penalty);
    if (retry.parts.every(p => !p.failed)) {
        route = retry;
        route.selfOverlaps = selfOverlaps(route.points, edge.width);
    }
    return route;
}

// A split within the wall clearance divides that same short approach across the two edges.
function portalSpans(design, nodes, edges) {
    const constraints = new Map(design.edges.map(e => [e.id, {}]));
    for (const edge of design.edges) for (const forward of [true, false]) {
        const side = forward ? "from" : "to", far = forward ? "to" : "from";
        const node = nodes.get(edge[side]), pose = nodePose(design, node);
        let current = edge, start = pose.point, lead = clearLead(node, edge, design.routing);
        if (!lead) continue;
        const end = advance(start, pose.normal, lead);
        while (lead > 1e-7) {
            const config = constraints.get(current.id);
            config[side] = { angle: pose.angle, normal: pose.normal, lead };
            const next = nodes.get(current[far]);
            if (next.through?.[forward ? 0 : 1] !== current.id) break;
            const via = forward ? current.via : [...current.via].reverse();
            const point = nodePose(design, next).point;
            let last = 0;
            const straight = [...via, point].every(p => {
                const hit = nearest(...p, [start, end]);
                if (hit.distance > 1e-6 || hit.t < last) return false;
                last = hit.t;
                return true;
            });
            if (!straight || distance(start, point) < 1e-7) break;
            config.straight = true;
            lead -= distance(start, point);
            start = point;
            current = edges.get(next.through[forward ? 1 : 0]);
        }
    }
    return constraints;
}

export function routeAll(design, t, previous = [], dirty = null) {
    const nodes = new Map(design.nodes.map(n => [n.id, n])), edges = new Map(design.edges.map(e => [e.id, e]));
    const constraints = portalSpans(design, nodes, edges), incident = new Map(design.nodes.map(n => [n.id, []]));
    for (const e of edges.values()) {
        incident.get(e.from).push(e);
        incident.get(e.to).push(e);
    }
    const pos = id => nodePose(design, nodes.get(id)).point;
    const away = (e, n) => e.from === n.id ? [...e.via, pos(e.to)] : [...e.via].reverse().concat([pos(e.from)]);
    const side = (e, n) => e.from === n.id ? "from" : "to";
    const atMode = (e, n) => segmentMode(e, e.from === n.id ? 0 : e.via.length);
    const pairs = n => throughPairs(n).length ? throughPairs(n).map(pair => pair.map(id => edges.get(id))) :
        incident.get(n.id).length === 2 ? [[...incident.get(n.id)].sort((a, b) => a.id < b.id ? -1 : 1)] : [];
    function endTangent(e, n) {
        const p = pos(n.id), points = away(e, n);
        if (points.length === 1) {
            const remote = nodes.get(e.from === n.id ? e.to : e.from), pair = pairs(remote).find(pair => pair.includes(e));
            const next = pair?.find(other => other !== e);
            if (next)
                points.push(away(next, remote)[0]);
        }
        const h = bearing(p, points[0]);
        return points.length > 1 ? 2 * h - tangent(p, points[0], points[1]) : h;
    }
    const dirtyIds = new Set(dirty ?? edges.keys());
    for (const n of nodes.values()) {
        if (n.type === "door" || n.type === "gate")
            continue;
        const p = pos(n.id);
        for (const [a, b] of pairs(n)) {
            const sa = side(a, n), sb = side(b, n), ca = constraints.get(a.id), cb = constraints.get(b.id);
            if (ca[sa] || cb[sb] || ca.straight || cb.straight)
                continue;
            const left = away(a, n)[0], right = away(b, n)[0], ma = atMode(a, n), mb = atMode(b, n);
            let h = tangent(left, p, right);
            if (ma === "straight" && mb === "straight") {
                const requested = Math.min(design.roadClasses[a.grade].cornerRadius, design.roadClasses[b.grade].cornerRadius);
                const arc = fillet(left, p, right, requested, design.routing.sampleStep);
                if (arc) {
                    ca[sa] = { point: arc.middle, round: [...arc.first].reverse(), angle: bearing(p, left) };
                    if (arc.radius < requested - 1e-6)
                        ca[sa].smallCorner = { point: arc.middle, radius: arc.radius, requested, arcs: [
                            { road: a.id, ends: [arc.first[0], arc.middle] }, { road: b.id, ends: [arc.middle, arc.last.at(-1)] }
                        ] };
                    cb[sb] = { point: arc.middle, round: arc.last, angle: bearing(p, right) };
                    for (const branch of incident.get(n.id).filter(e => e !== a && e !== b))
                        constraints.get(branch.id)[side(branch, n)] ??= { point: arc.middle };
                    continue;
                }
            }
            else if (ma === "straight")
                h = bearing(left, p);
            else if (mb === "straight")
                h = bearing(p, right);
            else if (ma === "smooth" && mb === "smooth" && a.via.length && !b.via.length && incident.get(n.id).length === 2)
                h = endTangent(a, n) + Math.PI;
            else if (ma === "smooth" && mb === "smooth" && b.via.length && !a.via.length && incident.get(n.id).length === 2)
                h = endTangent(b, n);
            else if (ma === "smooth" && mb === "route")
                h = endTangent(a, n) + Math.PI;
            else if (mb === "smooth" && ma === "route")
                h = endTangent(b, n);
            if (n.direction != null && ma !== "straight" && mb !== "straight") {
                const manual = n.direction * radians;
                h = angleDiff(manual, h) <= Math.PI / 2 ? manual : manual + Math.PI;
            }
            ca[sa] = { angle: h + Math.PI, through: true };
            cb[sb] = { angle: h, through: true };
        }
    }
    const cached = new Map(previous.map(r => [r.id, r]));
    return design.edges.map(e => {
        const cfg = constraints.get(e.id), key = JSON.stringify(cfg), saved = cached.get(e.id);
        if (!dirtyIds.has(e.id) && saved?.constraintKey === key)
            return saved;
        if (!cfg.straight)
            return { ...routeEdge(design, t, e, cfg.from, cfg.to), constraintKey: key };
        const controls = [pos(e.from), ...e.via, pos(e.to)], parts = controls.slice(1).map((p, i) => ({ index: i, points: resample([controls[i], p], design.routing.sampleStep) }));
        return { id: e.id, edge: e, constraintKey: key, controls, parts, points: parts.flatMap((part, i) => i ? part.points.slice(1) : part.points) };
    });
}