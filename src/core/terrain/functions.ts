import { type Expression, type GeoNode, type ResolvedGeoNode, type Point } from "../design/v5.ts";
import { numericProfile } from "../design/polyline.ts";
import { fieldExpressions, functionTable } from "../design/functionTable.ts";
import { type FieldSamples } from "../design/results.ts";
import { evaluate, fieldValue, sampleValue } from "../design/expression.ts";
import { type CrossSection, type Region, regionMaskAt, regionMaskIndex, signedBoundaryDistance } from "../design/regions.ts";
import { clamp, nearest, polygonField, sampleDefined, smooth, type Grid, type GridFrame } from "../math/geometry.ts";
import { fbm, noise } from "../math/noise.ts";
import { erodeAtSpacing } from "./erosion.ts";
import { flattenPath } from "../design/path.ts";
import { shoreDistance, shoreFrame } from "./shore.ts";
import { mountainProfile } from "./mountain.ts";

const landRise = .28, landCap = 3.5, seaFall = .09, seaCap = 5;
const coastDistance = Math.max(landCap / landRise, seaCap / seaFall);

export interface FieldState {
    grid: Grid;
    fields: Record<string, FieldSamples>;
}
export interface LayerOutput {
    cells: Int32Array;
    values: Float32Array;
    residual?: { height: number; point: Point };
}

export function evaluateLayer(n: ResolvedGeoNode, region: Region, state: FieldState, frameFor = shoreFrame): LayerOutput {
    const { grid, fields } = state, f = n.function, spec = functionTable[f.type];
    const { values: source, defined: mask } = fields[n.field], seed = f.seed as number;
    const bindings = new Map<string, Float64Array>(), readCanvas = spec.readArea === "canvas";
    const size = readCanvas ? grid.size : region.mask.length;
    for (const expression of fieldExpressions(f))
        if (typeof expression === "string" && !bindings.has(expression)) bindings.set(expression, new Float64Array(size));
    const local = bindings.size > 0 && !readCanvas;
    const readable = local ? new Uint8Array(size) : bindings.size ? mask.slice() : mask;
    if (local) {
        for (let j = 0; j < region.height; j++) {
            const start = (region.top + j) * grid.width + region.left;
            readable.set(mask.subarray(start, start + region.width), j * region.width);
        }
    }
    const bindingIndex = (k: number) => local ? regionMaskIndex(region, k) : k;
    for (const [expression, samples] of bindings) {
        const rule = evaluate(expression, key => fieldValue(key.slice("field:".length)));
        function sampleAt(k: number) {
            const at = bindingIndex(k);
            if (!readable[at]) return;
            const value = sampleValue(rule, id => fields[id].defined[k] ? fields[id].values[k] : undefined);
            if (value === undefined) readable[at] = 0;
            else samples[at] = value;
        }
        if (readCanvas) {
            for (let k = 0; k < grid.size; k++) sampleAt(k);
        }
        else for (const k of region.cells) sampleAt(k);
    }
    const input = (v: Expression, k: number) => typeof v === "number" ? v : bindings.get(v)![bindingIndex(k)];
    function featherWeight(width: number) {
        if (!width) return () => 1;
        const distanceToEdge = signedBoundaryDistance(region.shape, width);
        return (x: number, y: number) => smooth(distanceToEdge(x, y) / width);
    }
    function shoreWithin(frame: GridFrame, definedOnCanvas: Uint8Array, landAt: (k: number, i: number, j: number, at: number) => boolean) {
        const { left, top, width, height } = frame;
        const land = new Uint8Array(width * height), defined = new Uint8Array(land.length);
        for (let j = 0; j < height; j++) {
            const row = top + j, start = row * grid.width + left, offset = j * width;
            for (let i = 0; i < width; i++) {
                const k = start + i;
                if (!definedOnCanvas[k]) continue;
                const at = offset + i;
                land[at] = +landAt(k, left + i, row, at);
                defined[at] = 1;
            }
        }
        const shore = shoreDistance(frame, grid.step, land, defined);
        const index = (k: number) => (Math.floor(k / grid.width) - top) * width + k % grid.width - left;
        return { land, shore, index };
    }
    function atSea(level: number, distance: number) {
        const { shore, index } = shoreWithin(frameFor(grid, region, distance), mask, k => source[k] > level);
        return (k: number) => shore[index(k)];
    }
    let residual: LayerOutput["residual"];
    type Cell = (k: number, x: number, y: number) => number;
    const stripPoint: Point = [0, 0];
    function stripInput(x: number, y: number): { cross: CrossSection; a: number; b: number } | undefined {
        const c = n.construction;
        if (c.type !== "strip") return;
        stripPoint[0] = x; stripPoint[1] = y;
        const cross = region.shape.cross?.(stripPoint);
        if (!cross) return;
        const { first, normal: [nx, ny], at: [ax, ay] } = cross;
        const [w1, w2] = c.widths;
        const edge = (w: number, sign: number) => {
            if (w) return sampleDefined(grid, source, mask, ax + sign * nx * w, ay + sign * ny * w);
            // Take the one-sided limit even when the authored edge passes through a cell centre.
            const epsilon = grid.step * 1e-6;
            return sampleDefined(grid, source, mask, ax + sign * nx * epsilon, ay + sign * ny * epsilon,
                (px, py) => sign * ((px - ax) * nx + (py - ay) * ny) > epsilon / 2);
        };
        const a = f.type !== "split" || first ? edge(w1, -1) : 0;
        const b = f.type !== "split" || !first ? edge(w2, 1) : 0;
        if (a !== undefined && b !== undefined) return { cross, a, b };
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
                if (!f.warp && !f.carve)
                    return (k, x, y) => source[k] + input(f.amplitude, k) * fbm(pattern, x / f.scale, y / f.scale, octaves) * weight(x, y);
                const warp = noise(seed + 101), gullies = noise(seed + 202);
                return (k, x, y) => {
                    const original = source[k], factor = weight(x, y);
                    if (!factor) return original;
                    let value = original;
                    if (f.warp) {
                        const u = x / f.warpScale, v = y / f.warpScale;
                        const dx = f.warp * clamp(fbm(warp, u, v, 4), -1, 1);
                        const dy = f.warp * clamp(fbm(warp, u + 7.3, v - 2.1, 4), -1, 1);
                        x += dx;
                        y += dy;
                        value = sampleDefined(grid, source, mask, x, y) ?? original;
                    }
                    const u = x / f.scale, v = y / f.scale;
                    const detail = input(f.amplitude, k) * fbm(pattern, u, v, octaves);
                    const carve = f.carve && value > 0 ? value * f.carve / 100 * (1 - clamp(fbm(gullies, u, v, octaves, true))) : 0;
                    return original + (value - original + detail - carve) * factor;
                };
            }
            case "coast": {
                const n1 = noise(seed), n2 = noise(seed + 101);
                const shoreline = flattenPath(f.shore, grid.step / 8).map(s => s.a);
                let reach = 1;
                for (let k = 0; k < grid.size; k++) if (readable[k]) reach = Math.max(reach, Math.abs(input(f.roughness, k)) * 1.7 + 1);
                const frame = frameFor(grid, region, coastDistance);
                const edge = polygonField(grid, shoreline, reach, frame);
                const { land, shore, index } = shoreWithin(frame, readable, (k, i, j, at) => {
                    const x = grid.x(i), y = grid.y(j), dc = -edge[at], harbor = f.harbor;
                    let perturbation = 0;
                    if (Math.abs(dc) < reach) {
                        const attenuation = harbor.radius > 0 ? smooth((Math.hypot(harbor.center[0] - x, harbor.center[1] - y) - harbor.radius) / harbor.span) : 1;
                        const wx = x + 14 * fbm(n2, x / 70, y / 70, 3), wy = y + 14 * fbm(n2, x / 70 + 5.2, y / 70 + 1.3, 3);
                        perturbation = input(f.roughness, k) * attenuation * fbm(n1, wx / 38, wy / 38, 5) * 1.7;
                    }
                    return dc + perturbation > 0;
                });
                return k => {
                    const at = index(k);
                    return source[k] + (land[at] ? Math.min(shore[at] * landRise, landCap) : -1 - Math.min(-shore[at] * seaFall, seaCap));
                };
            }
            case "mountain": {
                const height = mountainProfile(f, grid.step / 8, seed);
                return (k, x, y) => source[k] <= f.floor ? source[k] : height(x, y, source[k]);
            }
            case "cliff": {
                const n1 = noise(seed);
                const sea = f.seaLevel, limit = Math.max(sea, .4);
                const gain = (x: number, y: number) => 1 + .3 * n1(x / 12, y / 12);
                let distance = 0;
                for (const k of region.cells) {
                    if (!readable[k] || !(source[k] > limit)) continue;
                    const x = grid.x(k % grid.width), y = grid.y(Math.floor(k / grid.width));
                    const g = input(f.factor, k) * gain(x, y);
                    if (g > 0) distance = Math.max(distance, source[k] / g);
                }
                const shore = atSea(sea, distance);
                return (k, x, y) => source[k] <= sea ? source[k] :
                    Math.min(source[k], Math.max(.4, shore(k) * input(f.factor, k) * gain(x, y)));
            }
            case "erosion": {
                const floor = f.floor;
                const eligible = new Uint8Array(grid.size);
                for (const k of region.cells)
                    if (regionMaskAt(region, k) && readable[bindingIndex(k)] && source[k] > floor) eligible[k] = 1;
                const delta = erodeAtSpacing(grid, eligible, source, f, seed, region.cells);
                return (k, x, y) => source[k] + delta(k, x, y) * input(f.strength, k);
            }
            case "islets": {
                const n3 = noise(seed + 202);
                const sea = f.seaLevel, shore = atSea(sea, f.reach);
                return (k, x, y) => {
                    const density = input(f.density, k);
                    return source[k] <= sea && -shore(k) <= f.reach && density > f.threshold &&
                        fbm(n3, x / 7, y / 7, 3) > .56 ? 1 + 1.5 * density : source[k];
                };
            }
            case "blend": case "split": case "batter": return;
        }
    }
    function calculateStrip(k: number, { cross, a, b }: NonNullable<ReturnType<typeof stripInput>>) {
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
    const calculate = prepare(), cells = new Int32Array(region.cells.length), values = new Float32Array(cells.length);
    let count = 0;
    for (const k of region.cells) {
        if (!spec.initial && !readable[bindingIndex(k)]) continue;
        const x = grid.x(k % grid.width), y = grid.y(Math.floor(k / grid.width));
        if (calculate) values[count] = calculate(k, x, y);
        else {
            const neighbors = stripInput(x, y);
            if (!neighbors) continue;
            values[count] = calculateStrip(k, neighbors);
        }
        cells[count++] = k;
    }
    return { cells: cells.subarray(0, count), values: values.subarray(0, count), residual };
}

export function applyLayer(output: LayerOutput, n: Pick<GeoNode, "field" | "function">, state: FieldState) {
    const { values, defined } = state.fields[n.field], initial = functionTable[n.function.type].initial;
    for (let i = 0; i < output.cells.length; i++) {
        const k = output.cells[i];
        values[k] = output.values[i];
        if (initial) defined[k] = 1;
    }
}