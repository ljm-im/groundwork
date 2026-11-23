import { type Route } from "../design/results.ts";
import { stairSpans } from "./profiles.ts";

export const maxRiser = .17;
export interface Flight { from: number; to: number; rise: number; steps: number; riser: number; tread: number | null }

export function precision(n: number) {
    if (!Number.isFinite(n)) throw new Error("几何包含非有限数值");
    return Number(n.toFixed(3)) || 0;
}
export function exportFlights(route: Route): Flight[] {
    return stairSpans(route.stairs, route.s).map(({ start, end }) => {
        const from = precision(route.s[start]), to = precision(route.s[end]);
        // Count from the published endpoint elevations in whole millimetres.
        const riseMm = Math.round(precision(route.h[end]) * 1000) - Math.round(precision(route.h[start]) * 1000);
        const rise = riseMm / 1000, steps = Math.ceil(Math.abs(riseMm) / Math.round(maxRiser * 1000));
        return { from, to, rise, steps, riser: steps ? precision(Math.abs(rise) / steps) : 0,
            tread: steps ? precision((to - from) / steps) : null };
    });
}