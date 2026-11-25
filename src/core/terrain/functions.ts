import { type Expression, type GeoNode, type ResolvedGeoNode, type Point } from "../design/v5.ts";
import { numericProfile } from "../design/polyline.ts";
import { fieldExpressions, functionTable } from "../design/functionTable.ts";
import { type FieldSamples } from "../design/results.ts";
import { evaluate, fieldValue, sampleValue } from "../design/expression.ts";
import { type CrossSection, type Region, signedBoundaryDistance } from "../design/regions.ts";
import { distance, nearest, polygonField, sampleDefined, smooth, type Grid } from "../math/geometry.ts";
import { fbm, noise, noise1D } from "../math/noise.ts";
import { erode } from "./erosion.ts";
import { flattenPath } from "../design/path.ts";
import { shoreDistance } from "./shore.ts";

export interface FieldState {
    grid: Grid;
    fields: Record<string, FieldSamples>;
}
export interface LayerOutput {
    cells: number[];
    values: Float32Array;
    residual?: { height: number; point: Point };
}

export function evaluateLayer(n: ResolvedGeoNode, region: Region, state: FieldState): LayerOutput {
    const { grid, fields } = state, f = n.function, spec = functionTable[f.type];
    const { values: source, defined: mask } = fields[n.field], seed = f.seed as number;
    const bindings = new Map<string, Float64Array>();
    for (const expression of fieldExpressions(f))
        if (typeof expression === "string" && !bindings.has(expression)) bindings.set(expression, new Float64Array(grid.size));
    const readable = bindings.size ? mask.slice() : mask;
    for (const [expression, samples] of bindings) {
        const rule = evaluate(expression, key => fieldValue(key.slice("field:".length)));
        function sampleAt(k: number) {
            if (!readable[k]) return;
            const value = sampleValue(rule, id => fields[id].defined[k] ? fields[id].values[k] : undefined);
            if (value === undefined) readable[k] = 0;
            else samples[k] = value;
        }
        if (spec.readArea === "canvas") {
            for (let k = 0; k < grid.size; k++) sampleAt(k);
        }
        else region.cells.forEach(sampleAt);
    }
    const input = (v: Expression, k: number) => typeof v === "number" ? v : bindings.get(v)![k];
    function featherWeight(width: number) {
        if (!width) return () => 1;
        const distanceToEdge = signedBoundaryDistance(region.shape);
        return (x: number, y: number) => smooth(distanceToEdge(x, y) / width);
    }
    const atSea = (level: number) => shoreDistance(grid, Uint8Array.from(source, h => +(h > level)), mask);
    let residual: LayerOutput["residual"];
    type Cell = (k: number, x: number, y: number) => number;
    function stripInput(x: number, y: number): { cross: CrossSection; edges: [number, number] } | undefined {
        const c = n.construction;
        if (c.type !== "strip") return;
        const cross = region.shape.cross?.([x, y]);
        if (!cross) return;
        const { first, normal: [nx, ny], at: [ax, ay] } = cross;
        const [w1, w2] = c.widths;
        const edge = (w: number, sign: number) => {
            if (w) return sampleDefined(grid, source, mask, ax + sign * nx * w, ay + sign * ny * w);
            // Take the one-sided limit even when the authored edge passes through a cell centre.
            const epsilon = grid.step * 1e-6;
            return sampleDefined(grid, source, mask, ax + sign * nx * epsilon, ay + sign * ny * epsilon,
                ([px, py]) => sign * ((px - ax) * nx + (py - ay) * ny) > epsilon / 2);
        };
        const a = f.type !== "split" || first ? edge(w1, -1) : 0;
        const b = f.type !== "split" || !first ? edge(w2, 1) : 0;
        if (a !== undefined && b !== undefined) return { cross, edges: [a, b] };
    }
    function prepare(): Cell | undefined {
        switch (f.type) {
            case "ground": {
                const value = f.value;
                return () => value;
            }
            case "flat": {
                const weight = featherWeight(f.feather);
                return (k, x, y) => source[k] + input(f.amount, k) * weight(x, y);
            }
            case "slope": {
                if (f.kind === "radial") {
                    const base = f.value;
                    return (k, x, y) => source[k] + base + f.rate * (Math.hypot(x - f.center[0], y - f.center[1]) - f.radius);
                }
                const line = numericProfile(f.line, grid.step / 8);
                return (k, x, y) => {
                    const hit = nearest(x, y, line.points);
                    return source[k] + line.value(line.station(hit.segment, hit.t), f.ease);
                };
            }
            case "noise": {
                const pattern = noise(seed), octaves = f.octaves, weight = featherWeight(f.feather);
                return (k, x, y) => source[k] + input(f.amplitude, k) * fbm(pattern, x / f.scale, y / f.scale, octaves) * weight(x, y);
            }
            case "coast": {
                const n1 = noise(seed), n2 = noise(seed + 101);
                const shoreline = flattenPath(f.shore, grid.step / 8).map(s => s.a);
                let reach = 1;
                for (let k = 0; k < grid.size; k++) if (readable[k]) reach = Math.max(reach, Math.abs(input(f.roughness, k)) * 1.7 + 1);
                const edge = polygonField(grid, shoreline, reach), land = new Uint8Array(grid.size);
                for (let k = 0; k < grid.size; k++) {
                    if (!readable[k]) continue;
                    const [x, y] = grid.point(k), dc = -edge[k], harbor = f.harbor;
                    let perturbation = 0;
                    if (Math.abs(dc) < reach) {
                        const attenuation = harbor.radius > 0 ? smooth((distance([x, y], harbor.center) - harbor.radius) / harbor.span) : 1;
                        const wx = x + 14 * fbm(n2, x / 70, y / 70, 3), wy = y + 14 * fbm(n2, x / 70 + 5.2, y / 70 + 1.3, 3);
                        perturbation = input(f.roughness, k) * attenuation * fbm(n1, wx / 38, wy / 38, 5) * 1.7;
                    }
                    land[k] = +(dc + perturbation > 0);
                }
                const shore = shoreDistance(grid, land, readable);
                return k => source[k] + (land[k] ? Math.min(shore[k] * .28, 3.5) : -1 - Math.min(-shore[k] * .09, 5));
            }
            case "mountain": {
                const n3 = noise(seed + 202);
                const floor = f.floor;
                const ridges = f.ridges.map(r => ({ ...r, profile: numericProfile(r.line, grid.step / 8) }));
                const peaks = f.peaks.map(p => ({ ...p, h: p.at.h }));
                return (k, x, y) => {
                    let h = source[k];
                    if (h <= floor) return h;
                    for (const { profile, widths, widthNoise: w, heightNoise: gain } of ridges) {
                        const hit = nearest(x, y, profile.points), a = profile.points[hit.segment], b = profile.points[hit.segment + 1];
                        const side = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0 ? 0 : 1;
                        const s = profile.station(hit.segment, hit.t);
                        const breadth = widths[side] * (1 + w.amount / 100 * noise1D(seed, s / w.wavelength));
                        const crest = profile.value(s) * (1 + gain.amount / 100 * noise1D(seed + 1, s / gain.wavelength));
                        h = Math.max(h, crest * Math.exp(-((hit.distance / (breadth || 1e-9)) ** 2)));
                    }
                    for (const p of peaks) {
                        const radius = p.radius + p.noise * n3(x / p.scale, y / p.scale);
                        h = Math.max(h, p.h * Math.exp(-((distance([x, y], p.at.p) / (radius || 1e-9)) ** 2)));
                    }
                    return h;
                };
            }
            case "cliff": {
                const n1 = noise(seed);
                const sea = f.seaLevel, shore = atSea(sea);
                return (k, x, y) => source[k] <= sea ? source[k] :
                    Math.min(source[k], Math.max(.4, shore[k] * input(f.factor, k) * (1 + .3 * n1(x / 12, y / 12))));
            }
            case "erosion": {
                const floor = f.floor;
                const eligible = Uint8Array.from(region.mask, (v, k) => +(!!v && !!readable[k] && source[k] > floor));
                const delta = erode(grid, eligible, source, f, seed);
                return k => source[k] + delta[k] * input(f.strength, k);
            }
            case "islets": {
                const n3 = noise(seed + 202);
                const sea = f.seaLevel, shore = atSea(sea);
                return (k, x, y) => {
                    const density = input(f.density, k);
                    return source[k] <= sea && -shore[k] <= f.reach && density > f.threshold &&
                        fbm(n3, x / 7, y / 7, 3) > .56 ? 1 + 1.5 * density : source[k];
                };
            }
            case "blend": case "split": case "batter": return;
        }
    }
    function calculateStrip(k: number, { cross, edges: [a, b] }: NonNullable<ReturnType<typeof stripInput>>) {
        const { s, first, normal: [nx, ny], at: [ax, ay] } = cross;
        if (f.type === "split") return first ? a : b;
        if (f.type === "blend") return a + (b - a) * smooth(s);
        if (f.type !== "batter" || n.construction.type !== "strip") throw Error("需要条带");
        const [w1, w2] = n.construction.widths;
        const highFirst = a >= b, width = w1 + w2, side = highFirst ? 1 : -1, lowWidth = highFirst ? w2 : w1;
        const drop = Math.abs(a - b) - width * f.grade;
        if (drop > 1e-6 && (!residual || drop > residual.height))
            residual = { height: drop, point: [ax + side * nx * lowWidth, ay + side * ny * lowWidth] };
        const plane = Math.max(a, b) - (highFirst ? s : 1 - s) * width * f.grade;
        return first === highFirst ? plane : Math.max(source[k], plane);
    }
    const calculate = prepare(), values: number[] = [], cells: number[] = [];
    for (const k of region.cells) {
        if (!spec.initial && !readable[k]) continue;
        const x = grid.x(k % grid.width), y = grid.y(Math.floor(k / grid.width));
        if (calculate) values.push(calculate(k, x, y));
        else {
            const neighbors = stripInput(x, y);
            if (!neighbors) continue;
            values.push(calculateStrip(k, neighbors));
        }
        cells.push(k);
    }
    return { cells, values: Float32Array.from(values), residual };
}

export function applyLayer(output: LayerOutput, n: Pick<GeoNode, "field" | "function">, state: FieldState) {
    const { values, defined } = state.fields[n.field], initial = functionTable[n.function.type].initial;
    output.cells.forEach((k, i) => {
        values[k] = output.values[i];
        if (initial) defined[k] = 1;
    });
}