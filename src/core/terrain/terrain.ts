import { type Terrain, type TerrainZone } from "../design/results.ts";
import { type Coast, type Design, type Point, type Band } from "../design/types.ts";
import { type Grid } from "../math/geometry.ts";
import { type Noise } from "../math/noise.ts";
import { bounds, clamp, createGrid, eachCell, nearest, polygonField, sample, smooth, spline, stations } from "../math/geometry.ts";
import { areaBoundary, buildingShape, elevation, zoneNoise, zonePolygon } from "../design/shapes.ts";
import { fbm, noise } from "../math/noise.ts";
import { erode } from "./erosion.ts";

function shoreDistance(grid: Grid, mask: Uint8Array) {
    const { size, width, height, step } = grid;
    const d = Float32Array.from(mask, v => v ? 1e6 : 0),
        diagonal = 1.4142 * step;
    for (const direction of [1, -1]) {
        for (let row = 0; row < height; row++)
            for (let col = 0; col < width; col++) {
                const k = direction === 1 ? row * width + col : size - 1 - row * width - col;
                let v = d[k];
                if (!v) continue;
                if (col) v = Math.min(v, d[k - direction] + step);
                if (row) {
                    const back = k - direction * width;
                    v = Math.min(v, d[back] + step);
                    if (col) v = Math.min(v, d[back - direction] + diagonal);
                    if (col + 1 < width) v = Math.min(v, d[back + direction] + diagonal);
                }
                d[k] = v;
            }
    }
    return d;
}

function coastRockiness(rules: Coast["rockiness"], x: number, y: number) {
    let value = 0;
    for (const rule of rules) {
        const t = "center" in rule ? 1 - Math.hypot(x - rule.center[0], y - rule.center[1]) / rule.radius :
            ((rule.axis === 0 ? x : y) * rule.sign - rule.start) / rule.span;
        value = Math.max(value, smooth(t) * rule.strength);
    }
    return value;
}

function zoneTerms(zone: TerrainZone, x: number, y: number) {
    const h = zone.height,
        s = h.slope,
        scale = h.noiseScale ?? 1;
    let base = (h.offset ?? 0) + (h.noise ?? 0) * zoneNoise(x * scale, y * scale);
    let blend = 0,
        rise = 0;
    if (s ?.type === "linear") {
        const t = clamp(((s.axis === 0 ? x : y) - s.start) / s.distance);
        base += s.rise * (s.smooth ? smooth(t) : t);
    }
    else if (s ?.type === "radial") {
        const [cx, cy] = (zone.shape as { center: Point }).center;
        base += s.rate * (Math.hypot(x - cx, y - cy) - s.baseline);
    }
    if (h.blendTo) {
        const { segment, t } = nearest(x, y, (zone.shape as Band).points), lengths = zone.stations!;
        blend = smooth((lengths[segment] + t * (lengths[segment + 1] - lengths[segment])) / (lengths.at(-1)! || 1));
    }
    if (h.endRise) {
        const r = h.endRise,
            a = (Math.atan2(y - r.center[1], x - r.center[0]) * 180 / Math.PI + 360) % 360;
        const radial = r.fade ? smooth((Math.hypot(x - r.center[0], y - r.center[1]) - r.fade[0]) / (r.fade[1] - r.fade[0])) : 1;
        rise = smooth((a - r.start) / r.inSpan) * (1 - smooth((a - r.end) / r.outSpan)) * radial;
    }
    return [base, blend, rise];
}

function prepareZones(t: Terrain, design: Design, n2: Noise) {
    const { grid, zones } = t, size = grid.size;
    const fields = zones.map(z => polygonField(grid, z.polygon, 16));
    zones.forEach((z, i) => {
        z.cells = [];
        const center = ("center" in z.shape ? z.shape.center : undefined) ?? [(z.box[0] + z.box[2]) / 2, (z.box[1] + z.box[3]) / 2];
        let closest = Infinity;
        eachCell(grid, z.box, 0, (k, x, y) => {
            if (fields[i][k] >= 0 && !Object.is(fields[i][k], -0)) return;
            z.cells.push(k);
            const dist = (x - center[0]) ** 2 + (y - center[1]) ** 2;
            if (dist < closest) {
                closest = dist;
                z.marker = [x, y];
            }
        });
    });
    t.zoneAt = new Int16Array(size).fill(-1);
    t.base = new Float32Array(size);
    t.naturalWeight = new Float32Array(size).fill(1);
    t.coefficients = Object.fromEntries(Object.keys(design.levels).map(key => [key, new Float32Array(size)]));
    const weights = new Float64Array(zones.length);
    for (let k = 0; k < size; k++) {
        const x = grid.x(k % grid.width),
            y = grid.y(Math.floor(k / grid.width));
        const radius = 9 + 5 * n2(x / 16 + 20, y / 16);
        let nearestDistance = Infinity,
            total = 0,
            owner = -1;
        for (let i = 0; i < zones.length; i++) {
            const d = fields[i][k];
            // Scan conversion includes the lower/left edge and excludes the upper/right edge.
            if (d < 0 || Object.is(d, -0)) {
                owner = i; break;
            }
            weights[i] = d < radius ? (1 - smooth(d / radius)) ** 2 : 0;
            total += weights[i];
            nearestDistance = Math.min(nearestDistance, d);
        }
        if (owner >= 0) {
            t.zoneAt[k] = owner;
            weights.fill(0);
            weights[owner] = 1;
            total = 1;
            t.naturalWeight[k] = 0;
        }
        else {
            if (!total || (t.dc[k] <= 0 && !t.islet[k])) continue;
            const w = smooth(nearestDistance / radius);
            total += w;
            t.naturalWeight[k] = w / total;
        }
        for (let i = 0; i < zones.length; i++) {
            if (!weights[i]) continue;
            const z = zones[i],
                w = weights[i] / total,
                [base, blend, rise] = zoneTerms(z, x, y);
            t.base[k] += w * base;
            if (z.height.level) t.coefficients[z.height.level][k] += w * (1 - blend);
            if (z.height.blendTo) t.coefficients[z.height.blendTo][k] += w * blend;
            if (z.height.endRise) t.coefficients[z.height.endRise.level][k] += w * rise;
        }
    }
}

function prepareBuildings(t: Terrain, design: Design) {
    const { grid } = t;
    t.buildings = design.buildings.map(buildingShape);
    t.padMask = new Uint8Array(grid.size);
    t.clearance = new Float32Array(grid.size).fill(1e5);
    t.pads = t.buildings.map(b => {
        const data = b.data,
            cells: number[] = [],
            pad = data.pad ?? (b.polygon ? 1.3 : data.radius! + 1.3);
        eachCell(grid, b.box, Math.max(16, pad), (k, x, y) => {
            const d = b.signedDistance(x, y);
            t.clearance[k] = Math.min(t.clearance[k], d - (data.blockMargin ?? 0));
            if (b.polygon ? d < pad : Math.hypot(x - data.center[0], y - data.center[1]) <= pad) {
                cells.push(k);
                t.padMask[k] = 1;
            }
        });
        return cells;
    });
    t.yards = (design.yards ?? []).map(area => {
        const yard = areaBoundary(design, area);
        const box = bounds(yard.points), cells: number[] = [], shoulders: [number, number][] = [];
        const apron = Math.SQRT2 * grid.step, blend = 9, reach = Math.max(16, apron + blend);
        const field = polygonField(grid, yard.points, reach);
        if (yard.kind === "plaza") {
            eachCell(grid, box, reach, k => {
                t.clearance[k] = Math.min(t.clearance[k], field[k]);
            });
            return { yard, box, cells, shoulders, height: design.zones.find(z => z.id === yard.zone)!.height };
        }
        eachCell(grid, box, reach, k => {
            t.clearance[k] = Math.min(t.clearance[k], field[k]);
            if (field[k] < 0 || Object.is(field[k], -0)) cells.push(k);
            // The bilinear sample at any point on the wall must reach the courtyard level.
            if (field[k] <= apron) t.padMask[k] = 1;
            if (field[k] >= 0 && !Object.is(field[k], -0) && field[k] < apron + blend) {
                const weight = 1 - smooth((field[k] - apron) / blend);
                shoulders.push([k, weight]);
            }
        });
        return { yard, box, cells, shoulders, height: design.zones.find(z => z.id === yard.zone)!.height };
    });
}

export function generateTerrain(design: Design): Terrain {
    const grid = createGrid(design.grid),
        { size, width } = grid,
        seed = design.seed;
    const field = () => new Float32Array(size);
    const n1 = noise(seed),
        n2 = noise(seed + 101),
        n3 = noise(seed + 202),
        n4 = noise(seed + 303);
    const coast = spline(design.coast.points, true, design.coast.smooth),
        coastD = polygonField(grid, coast, 24);
    const zones = design.zones.slice().sort((a, b) => a.priority - b.priority).map(z => {
        const polygon = zonePolygon(z.shape);
        return { ...z, polygon, box: bounds(polygon), stations: z.shape.type === "band" ? stations(z.shape.points) : null };
    });
    const ridges = design.ridges.map(r => ({
        ...r, line: spline(r.points.map(p => p.point), false, 8), index: new Uint32Array(size),
        fraction: new Float64Array(size), falloff: field(), gain: field()
    }));
    const peaks = design.peaks.map(p => ({ ...p, factor: field() }));
    const land = new Uint8Array(size),
        islet = new Uint8Array(size),
        sea = new Uint8Array(size);
    const rock = field(),
        detail = field(),
        cliff = field(),
        erosionWeight = new Float32Array(size).fill(1),
        harbor = design.coast.harbor;
    for (let k = 0; k < size; k++) {
        const x = grid.x(k % width),
            y = grid.y(Math.floor(k / width)),
            dc = -coastD[k];
        const rk = coastRockiness(design.coast.rockiness, x, y);
        rock[k] = rk;
        if (Math.abs(dc) >= 23) land[k] = dc > 0 ? 1 : 0;
        else {
            const hp = smooth((Math.hypot(x - harbor.center[0], y - harbor.center[1]) - harbor.radius) / harbor.span);
            const wx = x + 14 * fbm(n2, x / 70, y / 70, 3),
                wy = y + 14 * fbm(n2, x / 70 + 5.2, y / 70 + 1.3, 3);
            land[k] = dc + (4 + 8 * rk) * hp * fbm(n1, wx / 38, wy / 38, 5) * 1.7 > 0 ? 1 : 0;
        }
        if (!land[k] && rk > .45 && dc > -12 && fbm(n3, x / 7, y / 7, 3) > .56) islet[k] = 1;
        sea[k] = land[k] || islet[k] ? 0 : 1;
        if (!land[k]) continue;
        for (const r of ridges) {
            const hit = nearest(x, y, r.line),
                a = r.line[hit.segment],
                b = r.line[hit.segment + 1];
            const side = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0 ? 0 : 1;
            const at = (hit.segment + hit.t) / 8,
                w = r.widthNoise,
                h = r.heightNoise;
            const breadth = r.widths[side] * (1 + w[0] * n4(at * w[1], w[2]));
            r.index[k] = Math.min(r.points.length - 2, Math.floor(at));
            r.fraction[k] = at - r.index[k];
            r.falloff[k] = Math.exp(-((hit.distance / breadth) ** 2));
            r.gain[k] = 1 + h[0] * n4(at * h[1], h[2]);
        }
        cliff[k] = (.3 + .75 * rock[k]) * (1 + .3 * n1(x / 12, y / 12));
        for (const peak of peaks) {
            const radius = peak.radius + peak.noise * n3(x / peak.scale, y / peak.scale);
            const d = Math.hypot(x - peak.center[0], y - peak.center[1]), protect = peak.protect ?? 10;
            peak.factor[k] = Math.exp(-((d / radius) ** 2));
            if (d < protect) {
                cliff[k] = Math.max(cliff[k], peak.cliffMin ?? 1.4);
                erosionWeight[k] = Math.min(erosionWeight[k], smooth(d / protect));
            }
        }
        const wx = x + 10 * fbm(n2, x / 40 + 3, y / 40, 3),
            wy = y + 10 * fbm(n2, x / 40, y / 40 + 7, 3);
        detail[k] = 1.6 * fbm(n1, wx / 22, wy / 22, 5) + 2.4 * (fbm(n3, wx / 30, wy / 30, 4, true) - .45);
    }
    const dc = shoreDistance(grid, land),
        outside = shoreDistance(grid, sea);
    for (let k = 0; k < size; k++)
        if (!land[k]) dc[k] = -outside[k];
    const terrain = { grid, coast, zones, ridges, peaks, rock, detail, cliff, erosionWeight, land, islet, dc, natural: field(), heights: field() } as Terrain;
    prepareZones(terrain, design, n2);
    prepareBuildings(terrain, design);
    updateHeights(terrain, design, true);
    return terrain;
}

export function updateHeights(t: Terrain, design: Design, refreshErosion = false) {
    const { grid, ridges, peaks, natural } = t;
    const ridgeLevels = ridges.map(r => r.points.map(p => elevation(p.height, design.levels)));
    const peakLevels = peaks.map(p => elevation(p.height, design.levels));
    for (let k = 0; k < grid.size; k++) {
        const dc = t.dc[k];
        if (t.islet[k]) {
            natural[k] = 1 + 1.5 * t.rock[k]; continue;
        }
        if (!t.land[k]) {
            natural[k] = -1 - Math.min(-dc * .09, 5); continue;
        }
        let h = Math.min(dc * .28, 3.5);
        for (let i = 0; i < ridges.length; i++) {
            const r = ridges[i],
                at = r.index[k],
                levels = ridgeLevels[i];
            h = Math.max(h, (levels[at] + (levels[at + 1] - levels[at]) * r.fraction[k]) * r.gain[k] * r.falloff[k]);
        }
        for (let i = 0; i < peaks.length; i++) h = Math.max(h, peaks[i].factor[k] * peakLevels[i]);
        h += t.detail[k] * (.35 + .65 * smooth(h / 10));
        natural[k] = Math.max(.3, Math.min(h, Math.max(.4, dc * t.cliff[k])));
    }
    if (refreshErosion) {
        Object.assign(t, erode(grid, t.land, natural, design.erosion, design.seed));
        for (let k = 0; k < grid.size; k++) t.delta[k] *= t.erosionWeight[k];
    }
    return applyLevels(t, design);
}

// Apply the named platforms and pads to an already evaluated natural surface.
export function applyLevels(t: Terrain, design: Design) {
    const { grid, natural, heights } = t;
    for (let k = 0; k < grid.size; k++) heights[k] = (natural[k] + t.delta[k]) * t.naturalWeight[k] + t.base[k];
    for (const [level, values] of Object.entries(t.coefficients)) {
        const h = design.levels[level];
        for (let k = 0; k < grid.size; k++) heights[k] += values[k] * h;
    }
    for (const [i, cells] of t.pads.entries()) {
        const building = t.buildings[i].data;
        let sum = 0;
        for (const k of cells) sum += heights[k];
        // Level a summit foundation at its measured centre so grading preserves the crest.
        const padHeight = building.summit ? sample(grid, heights, ...building.center) : sum / cells.length;
        for (const k of cells) heights[k] = padHeight;
    }
    for (const y of t.yards) {
        const level = elevation(y.height, design.levels);
        for (const [k, weight] of y.shoulders) heights[k] += (level - heights[k]) * weight;
        for (const k of y.cells) heights[k] = level;
    }
    return heights;
}