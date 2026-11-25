import { numericProfile } from "../design/polyline.ts";
import { type ResolvedFunction } from "../design/v5.ts";
import { distance, nearest } from "../math/geometry.ts";
import { noise, noise1D } from "../math/noise.ts";

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
        const profile = numericProfile(ridge.line, tolerance);
        const drop = ridge.slope === undefined ? null : roundCrest(ridge.slope, f.crestRound);
        return { ridge, profile, drop };
    });
    return (x: number, y: number, ground: number) => {
        let top: number | undefined;
        for (const { ridge, profile, drop } of ridges) {
            const hit = nearest(x, y, profile.points), s = profile.station(hit.segment, hit.t);
            if (drop) {
                const height = profile.value(s, true) - drop(hit.distance);
                top = top === undefined ? height : roundedMaximum(top, height, f.blend);
            }
            else {
                const a = profile.points[hit.segment], b = profile.points[hit.segment + 1];
                const side = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0 ? 0 : 1;
                const w = ridge.widthNoise!, gain = ridge.heightNoise!;
                const breadth = ridge.widths![side] * (1 + w.amount / 100 * noise1D(seed, s / w.wavelength));
                const crest = profile.value(s) * (1 + gain.amount / 100 * noise1D(seed + 1, s / gain.wavelength));
                ground = Math.max(ground, crest * Math.exp(-((hit.distance / (breadth || 1e-9)) ** 2)));
            }
        }
        for (const p of f.peaks) {
            const radius = p.radius + p.noise * pattern(x / p.scale, y / p.scale);
            ground = Math.max(ground, p.at.h * Math.exp(-((distance([x, y], p.at.p) / (radius || 1e-9)) ** 2)));
        }
        return top === undefined ? ground : roundedMaximum(ground, top, f.footRound);
    };
}