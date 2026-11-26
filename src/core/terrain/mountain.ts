import { numericProfile } from "../design/polyline.ts";
import { type ResolvedFunction } from "../design/v5.ts";
import { distance, nearest } from "../math/geometry.ts";
import { noise } from "../math/noise.ts";

type Mountain = Extract<ResolvedFunction, { type: "mountain" }>;

function roundedMaximum(a: number, b: number, width: number) {
    const highest = Math.max(a, b), gap = Math.abs(a - b);
    if (width <= 0 || gap >= width) return highest;
    return highest + (width - gap) ** 2 / (4 * width);
}

function roundCrest(slope: number, radius: number) {
    const normal = Math.hypot(1, slope), tangent = radius * (slope / normal), drop = radius * (1 - 1 / normal);
    // The circular crown meets the straight flank at exactly the authored slope.
    return (d: number) => d < tangent ? radius * (1 - Math.sqrt(1 - (d / radius) ** 2)) : drop + (d - tangent) * slope;
}

export function mountainProfile(f: Mountain, tolerance: number, seed: number) {
    const pattern = noise(seed + 202);
    const ridges = f.ridges.map(ridge => {
        const profile = numericProfile(ridge.curve, tolerance);
        return { profile, drop: roundCrest(ridge.slope, f.crestRound) };
    });
    return (x: number, y: number, ground: number) => {
        let top: number | undefined;
        for (const { profile, drop } of ridges) {
            const hit = nearest(x, y, profile.points), s = profile.station(hit.segment, hit.t);
            const height = profile.value(s, true) - drop(hit.distance);
            top = top === undefined ? height : roundedMaximum(top, height, f.blend);
        }
        for (const p of f.peaks) {
            const radius = p.radius + p.noise * pattern(x / p.scale, y / p.scale);
            ground = Math.max(ground, p.height * Math.exp(-((distance([x, y], p.at) / (radius || 1e-9)) ** 2)));
        }
        return top === undefined ? ground : roundedMaximum(ground, top, f.footRound);
    };
}