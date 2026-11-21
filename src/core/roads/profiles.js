import { clamp, eachCell, pointAt, sample, smooth, stations } from "../math/geometry.js";

function valueAt(s, h, d) {
    let lo = 0,
        hi = s.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (s[mid] <= d) lo = mid;
        else hi = mid;
    }
    return h[lo] + (h[hi] - h[lo]) * clamp((d - s[lo]) / (s[hi] - s[lo] || 1));
}

function runsOf(stairs, s) {
    const runs = [];
    for (let i = 0; i < stairs.length;) {
        let end = i + 1;
        while (end < stairs.length && stairs[end] === stairs[i]) end++;
        runs.push({ start: i, end, stair: stairs[i], length: s[end] - s[i] });
        i = end;
    }
    return runs;
}

function stairSegments(grades, s, rule) {
    let active = false;
    const stairs = grades.map(grade => {
        if (!active && grade > rule.enter) active = true;
        else if (active && grade < rule.exit) active = false;
        return active;
    });
    for (let pass = 0; pass < 2; pass++) {
        const groups = runsOf(stairs, s);
        if (groups.length < 2) break;
        const keep = [];
        for (const [i, group] of groups.entries()) {
            if (group.length >= rule.minRun) continue;
            if (group.stair && grades.slice(group.start, group.end).some(g => g > rule.keep)) {
                keep.push(group);
            }
            else {
                const neighbour = groups[i - 1] ?? groups[i + 1];
                stairs.fill(neighbour.stair, group.start, group.end);
            }
        }
        for (const group of keep) {
            let a = group.start,
                b = group.end;
            while (s[b] - s[a] < rule.minRun && (a > 0 || b < stairs.length)) {
                if (a && (b === stairs.length || s[group.start] - s[a] <= s[b] - s[group.end])) a--;
                else b++;
            }
            stairs.fill(true, a, b);
        }
    }
    return stairs;
}

function fitStairLandings(design, terrain, route, s, h) {
    const { edge, points, platforms = [] } = route, length = s.at(-1);
    const flat = new Uint8Array(Math.max(0, s.length - 1));
    if (edge.grade !== "stair" || !length) return flat;
    const limit = design.roadClasses.stair.stairLimit;
    if (!platforms.length) {
    // Tie a steep threshold into the hillside. Elsewhere leave the surveyed profile
    // available for ordinary slope validation, including steep sections between two doors.
        const apron = Math.min(design.routing.landing ?? 3, length);
        for (const [id, start] of [[edge.from, true], [edge.to, false]]) {
            const node = design.nodes.find(n => n.id === id);
            if (!apron || node?.type !== "door" && node?.type !== "gate") continue;
            const anchor = start ? h[0] : h.at(-1);
            const ground = sample(terrain.grid, terrain.heights, ...pointAt(points, s, start ? apron : length - apron));
            if (Math.abs(ground - anchor) <= limit * apron) continue;
            const grade = Math.max(limit - 1e-8, Math.abs(h.at(-1) - h[0]) / length);
            for (let i = 1; i < h.length - 1; i++) {
                const rise = grade * (start ? s[i] : length - s[i]);
                h[i] = clamp(h[i], anchor - rise, anchor + rise);
            }
        }
        return flat;
    }
    // Reserve the tread width before distributing the climb over the two flights.
    const run = new Float64Array(s.length);
    for (let i = 1; i < s.length; i++) {
        const mid = (s[i] + s[i - 1]) / 2;
        flat[i - 1] = platforms.some(p => Math.abs(mid - p) <= edge.width / 2);
        run[i] = run[i - 1] + (flat[i - 1] ? 0 : s[i] - s[i - 1]);
    }
    const end = h.at(-1), available = run.at(-1);
    if (available > 0) {
        const grade = Math.max(limit - 1e-8, Math.abs(end - h[0]) / available);
        for (let i = 1; i < h.length - 1; i++) {
            const local = grade * (run[i] - run[i - 1]), remaining = grade * (available - run[i]);
            h[i] = clamp(h[i], Math.max(h[i - 1] - local, end - remaining), Math.min(h[i - 1] + local, end + remaining));
        }
    }
    return flat;
}

function samplePlatformEdges(route) {
    if (!route.platforms?.length) return route.points;
    const points = route.points, s = stations(points), half = route.edge.width / 2;
    const edges = route.platforms.flatMap(at => [at - half, at + half]).sort((a, b) => a - b);
    const result = [points[0]];
    for (let i = 1, next = 0; i < points.length; i++) {
        let previous = s[i - 1];
        while (next < edges.length && edges[next] <= s[i] + 1e-7) {
            const at = edges[next++];
            if (at > previous + 1e-7 && at < s[i] - 1e-7) {
                result.push(pointAt(points, s, at));
                previous = at;
            }
        }
        result.push(points[i]);
    }
    return result;
}

export function profile(design, terrain, route) {
    const { edge } = route, points = samplePlatformEdges(route), s = stations(points), length = s.at(-1);
    let h = points.map(p => sample(terrain.grid, terrain.heights, ...p));
    if (edge.levelDeck) h.fill(h[0]);
    for (let pass = 0; pass < design.routing.profilePasses; pass++) {
        const prev = h;
        h = prev.map((v, i) => {
            if (!i || i === prev.length - 1) return v;
            const a = Math.max(0, i - design.routing.profileRadius),
                b = Math.min(prev.length - 1, i + design.routing.profileRadius);
            let sum = 0;
            for (let j = a; j <= b; j++) sum += prev[j];
            return sum / (b - a + 1);
        });
    }
    const rule = design.roadClasses[edge.grade] ?? design.roadClasses.path;
    const flat = fitStairLandings(design, terrain, route, s, h);
    const gradeSpan = Math.min(length, design.routing.gradeWindow);
    const gradeAt = at => {
        const start = clamp(at - gradeSpan / 2, 0, length - gradeSpan);
        return Math.abs(valueAt(s, h, start + gradeSpan) - valueAt(s, h, start)) / (gradeSpan || 1);
    };
    const grades = points.slice(1).map((_, i) => gradeAt((s[i] + s[i + 1]) / 2));
    const stairs = rule.allowStairs ? stairSegments(grades, s, rule) : grades.map(() => false);
    for (let i = 0; i < stairs.length; i++) if (edge.stairs || s[i] < (edge.stairUntil ?? 0)) stairs[i] = true;
    for (let i = 0; i < flat.length; i++) if (flat[i]) stairs[i] = false;
    // Window extrema of a piecewise-linear profile occur when either end meets a station.
    const breaks = Array.from(s, at => at - gradeSpan / 2).concat(Array.from(s, at => at + gradeSpan / 2)).sort((a, b) => a - b);
    const peaks = [],
        locations = [];
    let cursor = 0,
        maxGrade = 0;
    for (let i = 0; i < s.length - 1; i++) {
        let at = s[i],
            peak = gradeAt(at);
        const consider = p => {
            const grade = gradeAt(p); if (grade > peak) {
                peak = grade;
                at = p;
            }
        };
        while (cursor < breaks.length && breaks[cursor] <= s[i + 1]) {
            if (breaks[cursor] >= s[i]) consider(breaks[cursor]);
            cursor++;
        }
        consider(s[i + 1]);
        peaks.push(peak);
        locations.push(at);
        maxGrade = Math.max(maxGrade, peak);
    }
    const stairRuns = runsOf(stairs, s).filter(r => r.stair);
    const direct = stations(route.controls).at(-1);
    return {
        ...route,
        points,
        s,
        h,
        stairs,
        grades,
        peaks,
        locations,
        length,
        drop: Math.abs(h.at(-1) - h[0]),
        maxGrade,
        stairRuns: stairRuns.length,
        stairLength: stairRuns.reduce((a, r) => a + r.length, 0),
        detour: direct ? length / direct : 1
    };
}

export function gradeRoads(design, terrain, routes) {
    const { grid } = terrain, weight = new Float32Array(grid.size), target = new Float32Array(grid.size);
    for (const route of routes) {
        const half = route.edge.width / 2 + design.routing.roadBedExtra;
        const shoulder = design.roadClasses[route.edge.grade].shoulder,
            radius = half + shoulder;
        for (let i = 0; i < route.points.length; i++) {
            const [px, py] = route.points[i];
            eachCell(grid, [px, py, px, py], radius, (k, x, y) => {
                const squared = (px - x) ** 2 + (py - y) ** 2;
                if (squared > radius * radius) return;
                const w = squared <= half * half ? 1 : 1 - smooth((Math.sqrt(squared) - half) / shoulder);
                if (w > weight[k]) {
                    weight[k] = w;
                    target[k] = route.h[i];
                }
            });
        }
    }
    const heights = terrain.heights.slice();
    for (let k = 0; k < heights.length; k++)
        if (weight[k] && !terrain.padMask[k]) heights[k] += (target[k] - heights[k]) * weight[k];
    return { heights, weight };
}