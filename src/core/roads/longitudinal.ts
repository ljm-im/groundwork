import { type Route, type Terrain } from "../design/results.ts";
import { exportFlights } from "../export.ts";
import { clamp, mixPoint, sampleDefined } from "../math/geometry.ts";

export function longitudinal(route: Route, terrain: Pick<Terrain, "grid" | "defined">, heights: Float32Array) {
    const ground = route.points.map(p => sampleDefined(terrain.grid, heights, terrain.defined, ...p));
    const excess: { start: number; end: number; max: number }[] = [];
    for (let i = 0; i < route.peaks.length; i++) {
        if (route.stairs[i] || route.peaks[i] <= route.edge.maxGrade) continue;
        const last = excess.at(-1);
        if (last && last.end === i) {
            last.end++;
            last.max = Math.max(last.max, route.peaks[i]);
        }
        else excess.push({ start: i, end: i + 1, max: route.peaks[i] });
    }
    return { ground, flights: exportFlights(route), excess };
}

export function profileReading(route: Route, at: number, terrain: Terrain, heights: Float32Array) {
    const s = clamp(at, 0, route.length);
    let i = 0;
    while (i + 2 < route.s.length && route.s[i + 1] < s) i++;
    const t = clamp((s - route.s[i]) / (route.s[i + 1] - route.s[i] || 1));
    const point = mixPoint(route.points[i], route.points[i + 1], t), road = route.h[i] + (route.h[i + 1] - route.h[i]) * t;
    const ground = sampleDefined(terrain.grid, heights, terrain.defined, ...point);
    return { s, road, ground, grade: route.grades[i], point, gap: ground === undefined ? undefined : road - ground };
}