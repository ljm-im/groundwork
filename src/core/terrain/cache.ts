import { type Design, type Shape, type ZoneHeight } from "../design/types.ts";
import { bindTerrain, crestHeights, erodedGround, generateBase, prepareSite } from "./terrain.ts";

function baseKey(d: Design) {
    const { xMin, xMax, yMin, yMax, step } = d.grid, { points, smooth, rockiness, harbor } = d.coast;
    return JSON.stringify([
        [xMin, xMax, yMin, yMax, step], d.seed, points, smooth, [harbor.center, harbor.radius, harbor.span],
        rockiness.map(r => "center" in r ? [r.center, r.radius, r.strength] : [r.axis, r.sign, r.start, r.span, r.strength]),
        d.ridges.map(r => [r.points.map(p => p.point), r.widths, r.widthNoise, r.heightNoise]),
        d.peaks.map(p => [p.center, p.radius, p.noise, p.scale, p.protect ?? 10, p.cliffMin ?? 1.4])
    ]);
}

function groundKey(base: string, d: Design, heights: ReturnType<typeof crestHeights>) {
    const e = d.erosion;
    return base + "\n" + JSON.stringify([heights.ridges, heights.peaks, e.droplets, e.inertia, e.capacity, e.minCapacity,
        e.deposition, e.erosion, e.evaporation, e.gravity, e.lifetime, e.radius]);
}

function shapeInputs(s: Shape) {
    switch (s.type) {
        case "band": return [s.type, s.points, s.width];
        case "polygon": return [s.type, s.points, s.smooth ?? 0];
        case "ellipse": return [s.type, s.center, s.radii, s.samples];
        case "circle": return [s.type, s.center, s.radius, s.amplitude, s.samples];
        case "sector": return [s.type, s.center, s.inner, s.outer, s.start, s.end, s.innerNoise ?? 0, s.outerNoise ?? 0, s.samples];
    }
}

function zoneHeightInputs(h: ZoneHeight) {
    const s = h.slope, r = h.endRise;
    return [h.level, h.offset ?? 0, h.noise ?? 0, h.noiseScale ?? 1, h.blendTo,
        s && (s.type === "linear" ? [s.type, s.axis, s.start, s.distance, s.rise, !!s.smooth] : [s.type, s.baseline, s.rate]),
        r && [r.level, r.center, r.start, r.inSpan, r.end, r.outSpan, r.fade]];
}

function siteKey(ground: string, d: Design) {
    return ground + "\n" + JSON.stringify([
        Object.entries(d.levels),
        d.zones.map(z => [z.id, z.priority, shapeInputs(z.shape), zoneHeightInputs(z.height)]),
        d.buildings.map(b => [b.shape, b.center, b.shape === "rect" ? [b.size, b.angle] : [b.radius, b.shape === "ring" && b.inner],
            b.pad ?? (b.shape === "rect" ? 1.3 : b.radius! + 1.3), b.blockMargin ?? 0, !!b.summit]),
        (d.yards ?? []).map(y => [y.zone, y.kind === "plaza", y.points])
    ]);
}

function recent<T>(entries: Map<string, T>, limit: number, key: string, compute: () => T): T {
    const hit = entries.get(key);
    if (hit !== undefined) {
        entries.delete(key);
        entries.set(key, hit);
        return hit;
    }
    const result = compute();
    if (entries.size === limit) entries.delete(entries.keys().next().value!);
    entries.set(key, result);
    return result;
}

export class TerrainCache {
    private bases = new Map<string, ReturnType<typeof generateBase>>();
    private grounds = new Map<string, ReturnType<typeof erodedGround>>();
    private sites = new Map<string, ReturnType<typeof prepareSite>>();
    readonly counts = { base: 0, erosion: 0, site: 0 };

    clear() {
        this.bases.clear();
        this.grounds.clear();
        this.sites.clear();
    }

    missing(design: Design) {
        const key = baseKey(design);
        if (!this.bases.has(key)) return "base";
        return this.grounds.has(groundKey(key, design, crestHeights(design))) ? null : "natural";
    }

    generate(design: Design) {
        const geometry = baseKey(design), heights = crestHeights(design);
        const surface = groundKey(geometry, design, heights);
        const base = recent(this.bases, 4, geometry, () => {
            this.counts.base++;
            return generateBase(design);
        });
        const ground = recent(this.grounds, 4, surface, () => {
            this.counts.erosion++;
            return erodedGround(base, design, heights);
        });
        const site = recent(this.sites, 2, siteKey(surface, design), () => {
            this.counts.site++;
            return prepareSite(base, ground, design);
        });
        return bindTerrain(base, ground, site, design);
    }
}