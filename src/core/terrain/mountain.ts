import { numericProfile } from "../design/polyline.ts";
import { type ResolvedFunction } from "../design/v5.ts";
import { distance, normalProjection } from "../math/geometry.ts";
import { noise } from "../math/noise.ts";

type Mountain = Extract<ResolvedFunction, { type: "mountain" }>;

function roundedMaximum(a: number, b: number, width: number) {
    const highest = Math.max(a, b), gap = Math.abs(a - b);
    if (width <= 0 || gap >= width) return highest;
    return highest + (width - gap) ** 2 / (4 * width);
}

function roundedMinimum(a: number, b: number, width: number) {
    return -roundedMaximum(-a, -b, width);
}

function roundCrest(d: number, slope: number, radius: number) {
    const normal = Math.hypot(1, slope), tangent = radius * (slope / normal), drop = radius * (1 - 1 / normal);
    // The circular crown meets the straight flank at exactly the authored slope.
    return d < tangent ? radius * (1 - Math.sqrt(1 - (d / radius) ** 2)) : drop + (d - tangent) * slope;
}

export function mountainProfile(f: Mountain, tolerance: number, seed: number) {
    const pattern = noise(seed + 202);
    function profile({ curve }: Mountain["ridges"][number]) {
        const heights = numericProfile(curve, tolerance), slopes = numericProfile(curve, tolerance, "slope");
        const project = normalProjection(heights.points, curve.closed);
        return (x: number, y: number, direction: -1 | 1) => {
            const hit = project(x, y), s = heights.station(hit.segment, hit.t);
            const drop = roundCrest(hit.distance, slopes.value(s, true), f.crestRound);
            return direction === -1 ? heights.value(s, true) - drop : heights.value(s, true) + drop;
        };
    }
    const ridges = f.ridges.map(profile), valleys = f.valleys.map(profile);
    return (x: number, y: number, ground: number) => {
        let top: number | undefined;
        for (const ridge of ridges) {
            const height = ridge(x, y, -1);
            top = top === undefined ? height : roundedMaximum(top, height, f.blend);
        }
        for (const p of f.peaks) {
            const radius = p.radius + p.noise * pattern(x / p.scale, y / p.scale);
            ground = Math.max(ground, p.height * Math.exp(-((distance([x, y], p.at) / (radius || 1e-9)) ** 2)));
        }
        const raised = top === undefined ? ground : roundedMaximum(ground, top, f.footRound);
        let bottom: number | undefined;
        for (const valley of valleys) {
            const height = valley(x, y, 1);
            bottom = bottom === undefined ? height : roundedMinimum(bottom, height, f.blend);
        }
        return bottom === undefined ? raised : roundedMinimum(raised, bottom, f.footRound);
    };
}