import { angleDiff, bearing, bounds, distance, eachCell, mixPoint, nearest, pointAt, radians, resample, sample } from "../math/geometry.js";
import { exemptRadius, radiusAt } from "../roads/alignment.js";
import { areaBoundary, elevation, nodePose, throughPairs } from "../design/model.js";
import { gateDistance, insideYard, perimeter } from "../edit/yards.js";
import { overlappingLocations, selfOverlaps, sharpBends } from "../roads/proximity.js";

const percent = v => +(v * 100).toFixed(2) + "%";

function gradeIssues(design, route, emit) {
    const rule = design.roadClasses[route.edge.grade];
    if (!rule) return;
    const checks = [
        ["street-stairs", i => route.stairs[i] && !rule.allowStairs, () => "街道出现台阶"],
        ["stair-grade", i => route.stairs[i] && route.peaks[i] > rule.stairLimit, g => "台阶坡度 " + percent(g) + " 超过 " + percent(rule.stairLimit)],
        ["ramp-grade", i => !route.stairs[i] && rule.rampLimit != null && route.peaks[i] > rule.rampLimit, g => "坡道坡度 " + percent(g) + " 超过 " + percent(rule.rampLimit)]
    ];
    for (const [kind, violates, message] of checks) {
        let worst = -1, start = 0;
        for (let i = 0; i <= route.stairs.length; i++) {
            if (i < route.stairs.length && violates(i)) {
                if (worst < 0) start = i;
                if (worst < 0 || route.peaks[i] > route.peaks[worst]) worst = i;
            }
            else if (worst >= 0) {
                const t = (route.locations[worst] - route.s[worst]) / (route.s[worst + 1] - route.s[worst] || 1);
                emit(kind, message(route.peaks[worst]), mixPoint(route.points[worst], route.points[worst + 1], t), "error", { spans: [{ road: route.id, from: route.s[start], to: route.s[i] }] });
                worst = -1;
            }
        }
    }
}

function surfaceIssues(route, terrain, emit) {
    const points = resample(route.points, .5),
        half = route.edge.width / 2,
        box = bounds(points);
    const nearby = b => box[0] - half <= b[2] && box[2] + half >= b[0] && box[1] - half <= b[3] && box[3] + half >= b[1];
    const buildings = terrain.buildings.filter(b => nearby(b.box));
    const walls = terrain.zones.filter(z => z.retainingWall && nearby(z.box));
    const yards = (terrain.yards ?? []).filter(y => nearby(y.box) && y.yard.kind !== "plaza");
    const active = new Map();
    const finish = (key, at) => {
        const issue = active.get(key);
        if (issue) {
            issue.spans[0].to = at; active.delete(key);
        }
    };
    const contact = (key, hit, i, kind, message, severity, extra = {}) => {
        const at = i === points.length - 1 ? route.length : i * .5;
        if (hit && !active.has(key)) {
            const entry = emit(kind, message, points[i], severity, { ...extra, spans: [{ road: route.id, from: Math.max(0, at - .25), to: Math.min(route.length, at + .25) }] });
            active.set(key, entry);
        }
        else if (!hit) finish(key, Math.min(route.length, Math.max(0, at - .25)));
    };
    for (let i = 0; i < points.length; i++) {
        const p = points[i],
            a = points[Math.max(0, i - 1)],
            b = points[Math.min(i + 1, points.length - 1)];
        const l = distance(a, b) || 1,
            nx = -(b[1] - a[1]) / l,
            ny = (b[0] - a[0]) / l;
        for (const building of buildings) {
            const key = "b/" + building.data.id;
            let hit = false;
            if (building.signedDistance(...p) < half) {
                const across = Math.max(2, Math.ceil(2 * half / .4));
                for (let j = 0; j <= across && !hit; j++) {
                    const offset = half * (2 * j / across - 1);
                    hit = building.signedDistance(p[0] + nx * offset, p[1] + ny * offset) < -.015;
                }
            }
            contact(key, hit, i, "building", "路面穿过" + building.data.name, "error", { building: building.data.id });
        }
        for (const z of walls) {
            const key = "z/" + z.id,
                hit = nearest(...p, z.polygon, true).distance <= half;
            contact(key, hit, i, "wall", "路面与" + z.name + "挡土墙相交", "notice");
        }
        for (const { yard } of yards) {
            const key = "yard/" + yard.id;
            const hit = [0, -half, half].some(offset => {
                const q = [p[0] + nx * offset, p[1] + ny * offset];
                return insideYard(yard, q) && nearest(...q, yard.points, true).distance > .03;
            });
            contact(key, hit, i, "yard-interior", "路面进入" + yard.name + "内部", "error");
        }
    }
    for (const key of active.keys()) finish(key, route.length);
}

function overlapIssues(design, routes, issues) {
    const rules = design.routing;
    for (let i = 0; i < routes.length; i++)
        for (let j = i + 1; j < routes.length; j++) {
            const a = routes[i],
                b = routes[j],
                ea = a.edge,
                eb = b.edge;
            const shared = [ea.from, ea.to].filter(id => id === eb.from || id === eb.to).map(id => nodePose(design, id).point);
            for (const { point, spans } of overlappingLocations(a, b, shared, rules, true)) {
                issues.push({
                    kind: "overlap",
                    severity: "error",
                    road: a.id,
                    other: b.id,
                    point, spans,
                    message: ea.name + "与" + eb.name + "间距不足 " + rules.clearance + " m，持续至少 " + rules.overlapLength + " m"
                });
            }
        }
}

export function validateRoads(design, terrain, routes) {
    const issues = [];
    for (const r of routes) {
        const emit = (kind, message, point, severity = "error", geometry = {}) => {
            const issue = { kind, severity, road: r.id, point, message, ...geometry };
            issues.push(issue);
            return issue;
        };
        const at = p => {
            const h = nearest(...p, r.points); return r.s[h.segment] + h.t * (r.s[h.segment + 1] - r.s[h.segment]);
        };
        const span = (from, to) => ({ spans: [{ road: r.id, from, to }] });
        for (const part of r.parts) {
            if (part.failed) emit("no-route", "走廊内选线失败，已显示直线", part.points[Math.floor(part.points.length / 2)], "error", span(at(part.points[0]), at(part.points.at(-1))));
            const chord = r.controls.slice(part.index, part.index + 2);
            const outside = chord.length === 2 && part.points.find(p => nearest(...p, chord).distance > r.edge.corridor + 1e-6);
            if (outside) emit("corridor", "路段中心线越出走廊", outside);
        }
        for (const corner of r.smallCorners ?? []) {
            const spans = corner.arcs.map(({ road, ends }) => {
                const route = road === r.id ? r : routes.find(other => other.id === road);
                if (!route) return null;
                const positions = ends.map(p => {
                    const hit = nearest(...p, route.points);
                    return route.s[hit.segment] + hit.t * (route.s[hit.segment + 1] - route.s[hit.segment]);
                });
                return { road, from: Math.min(...positions), to: Math.max(...positions) };
            }).filter(Boolean);
            emit("corner-radius", "相邻直线过短，倒角半径 " + corner.radius.toFixed(2) + " m，设计 " + corner.requested + " m", corner.point, "error", { spans });
        }
        if (r.detour > design.routing.detourLimit) emit("detour", "绕路比 " + r.detour.toFixed(2) + " 超过 " + design.routing.detourLimit, r.points[Math.floor(r.points.length / 2)], "error", span(0, r.length));
        gradeIssues(design, r, emit);
        surfaceIssues(r, terrain, emit);
        const line = r.points, minimum = design.roadClasses[r.edge.grade].minRadius;
        let worst = null, first = 0;
        for (let i = 1; i < line.length; i++) {
            const radius = i + 1 < line.length && !exemptRadius(r, i, r.s, design) ? radiusAt(line[i - 1], line[i], line[i + 1]) : Infinity;
            if (radius < minimum - 1e-5) {
                if (!worst) first = i;
                if (!worst || radius < worst.radius) worst = { radius, point: line[i] };
            }
            else if (worst) {
                emit("turn-radius", "转弯半径过小，实测 " + worst.radius.toFixed(2) + " m，最小 " + minimum + " m", worst.point, "error", span(r.s[first - 1], r.s[i]));
                worst = null;
            }
        }
        for (const bend of sharpBends(line, r.s)) {
            emit("sharp-bend", "急弯 · 3 m 内方向变化 " + (bend.angle / radians).toFixed(1) + "°，超过 45°", bend.point, "notice", span(bend.from, bend.to));
        }
        for (const hit of (r.selfOverlaps?.length === 0 ? [] : selfOverlaps(line, r.edge.width, r.s, true))) {
            emit("self-overlap", "自身重叠 · 沿路相隔超过两倍路宽的路面净距不足 1 m", hit.point, "error", { spans: hit.ranges.map(([from, to]) => ({ road: r.id, from, to })) });
        }
    }
    overlapIssues(design, routes, issues);
    return issues;
}

// Bearings point away from the junction and use the same three-metre interval on each arm.
export function armBearing(route, nodeId) {
    const start = route.edge.from === nodeId;
    const end = start ? route.points[0] : route.points.at(-1);
    return bearing(end, pointAt(route.points, route.s, start ? 3 : route.length - 3));
}

export function summitHeights(grid, heights, point) {
    const [x, y] = point, ground = sample(grid, heights, x, y);
    let highest = ground, highestAt = point;
    eachCell(grid, [x, y, x, y], 25, (k, px, py) => {
        if ((px - x) ** 2 + (py - y) ** 2 <= 625 && heights[k] > highest) {
            highest = heights[k];
            highestAt = [px, py];
        }
    });
    return { ground, highest, highestAt };
}

export function validateDesign(d, terrain, heights, routes) {
    const issues = [];
    for (const y of d.yards ?? []) {
        const gates = d.nodes.filter(n => n.type === "gate" && n.yard === y.id);
        const { length } = perimeter(areaBoundary(d, y));
        const boundary = y.kind === "plaza" ? "广场边界" : "院墙";
        const entrance = y.kind === "plaza" ? "广场入口" : "院门";
        for (const [i, n] of gates.entries()) {
            const point = nodePose(d, n).point;
            for (const other of gates.slice(i + 1)) {
                const gap = gateDistance(n, other, length);
                if (gap < 6 - 1e-8) issues.push({ kind: "gate-spacing", severity: "notice", node: n.id, otherNode: other.id, point, label: n.name,
                    message: "沿" + boundary + "距" + other.name + "仅 " + gap.toFixed(1) + " m，需至少 6 m" });
            }
            for (const b of terrain.buildings) if (b.signedDistance(...point) <= 1.5) {
                issues.push({ kind: "gate-building", severity: "error", node: n.id, building: b.data.id, point, label: n.name, message: entrance + "落在" + b.data.name + "占地外扩 1.5 m 范围内" });
            }
        }
    }
    for (const n of d.nodes.filter(n => n.detachedDoor)) issues.push({ kind: "detached-door", severity: "notice", node: n.id, point: n.point, label: n.name, message: "端点未接建筑（" + n.detachedDoor + "）" });
    for (const n of d.nodes.filter(n => n.through)) {
        const pairs = throughPairs(n), mains = new Set(pairs.flat());
        const branches = routes.filter(r => !mains.has(r.id) && (r.edge.from === n.id || r.edge.to === n.id));
        for (const pair of pairs) {
            const main = pair.map(id => routes.find(r => r.id === id));
            if (!main.every(Boolean)) continue;
            for (const r of branches) {
                const out = armBearing(r, n.id), angle = Math.min(...main.map(trunk => angleDiff(armBearing(trunk, n.id), out))) / radians;
                if (angle < 30 - 1e-7) issues.push({ kind: "branch-angle", severity: "notice", node: n.id, road: r.id, point: nodePose(d, n).point,
                    label: n.name, message: "支路与主路夹角 " + angle.toFixed(1) + "°，需至少 30°" });
            }
        }
    }
    for (const b of d.buildings.filter(b => b.summit)) {
        const { ground, highest } = summitHeights(terrain.grid, heights, b.center);
        if (highest - ground > .5) issues.push({ kind: "summit", severity: "error", building: b.id, point: b.center, label: b.name,
            message: "基座 " + ground.toFixed(1) + " m，25 m 内最高 " + highest.toFixed(1) + " m，高差超过 0.5 m" });
    }
    for (const z of terrain.zones) {
        if (!z.cells.length) continue;
        let sum = 0;
        for (const k of z.cells) sum += heights[k];
        const mean = sum / z.cells.length, target = elevation(z.height, d.levels);
        if (Math.abs(mean - target) > .5) {
            issues.push({ kind: "zone-height", severity: "notice", zone: z.id, point: z.marker, label: z.name,
                message: "区内平均 " + mean.toFixed(1) + " m，设计 " + target.toFixed(1) + " m" });
        }
    }
    return issues;
}