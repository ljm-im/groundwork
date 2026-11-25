import { type Expression, type GeoNode, type ResolvedGeoNode, type Point } from "../design/v5.ts";
import { numericProfile } from "../design/polyline.ts";
import { fieldExpressions, functionTable } from "../design/functionTable.ts";
import { type FieldSamples } from "../design/results.ts";
import { evaluate, fieldValue, sampleValue } from "../design/expression.ts";
import { type CrossSection, type Region, type RegionShape, type Segment, shapeWork, regionMaskAt, regionMaskIndex, signedBoundaryDistance } from "../design/regions.ts";
import { clamp, nearest, polygonField, createGrid, sampleDefined, smooth, gridSpec, type Grid, type GridFrame, type GridSpec } from "../math/geometry.ts";
import { fbm, noise } from "../math/noise.ts";
import { erosionSampler, prepareErosion, type ErosionData } from "./erosion.ts";
import { flattenPath } from "../design/path.ts";
import { shoreDistance, shoreFrame } from "./shore.ts";
import { mountainProfile } from "./mountain.ts";
import { cellBlock, measureWork, parallelThreshold, runBlocks, workBuffer, type WorkPool } from "../math/work.ts";

const landRise = .28, landCap = 3.5, seaFall = .09, seaCap = 5;
const coastDistance = Math.max(landCap / landRise, seaCap / seaFall);
const shoreMaskParallelThreshold = 16384, shoreMaskBlock = 4096;

export interface FieldState {
    grid: Grid;
    fields: Record<string, FieldSamples>;
}
export interface LayerOutput {
    cells: Int32Array;
    values: Float32Array;
    residual?: { height: number; point: Point };
}

type RegionCells = Omit<Region, "shape">;
interface BoundInputs { readable: Uint8Array; bindings: Map<string, Float64Array>; local: boolean }
type LayerContext = BoundInputs & { node: ResolvedGeoNode; region: RegionCells; spec: GridSpec; fields: FieldState["fields"] };
type BindingSamples = Pick<LayerContext, "region" | "fields" | "readable" | "local"> & {
    length: number; expression: string; samples: Float64Array;
};
export type BindingTask = BindingSamples & { kind: "binding" };

function bindingIndex(region: RegionCells, local: boolean, k: number) {
    return local ? regionMaskIndex(region, k) : k;
}

export function sampleBinding({ expression, region, fields, readable, local, samples, length }: BindingSamples) {
    const rule = evaluate(expression, key => fieldValue(key.slice("field:".length)));
    let cell = 0;
    function read(id: string) {
        const field = fields[id];
        return field.defined[cell] ? field.values[cell] : undefined;
    }
    return (block: number) => {
        const start = block * cellBlock, end = Math.min(length, start + cellBlock);
        for (let i = start; i < end; i++) {
            const k = local ? region.cells[i] : i, at = bindingIndex(region, local, k);
            if (!readable[at]) continue;
            cell = k;
            const value = sampleValue(rule, read);
            if (value === undefined) readable[at] = 0;
            else samples[at] = value;
        }
    };
}

function bindInputs(n: ResolvedGeoNode, region: RegionCells, { grid, fields }: FieldState, pool?: WorkPool): BoundInputs {
    const mask = fields[n.field].defined, shared = !!pool?.size;
    const bindings = new Map<string, Float64Array>(), readCanvas = functionTable[n.function.type].readArea === "canvas";
    const size = readCanvas ? grid.size : region.mask.length;
    for (const expression of fieldExpressions(n.function))
        if (typeof expression === "string" && !bindings.has(expression)) bindings.set(expression, new Float64Array(workBuffer(size * 8, shared)));
    const local = bindings.size > 0 && !readCanvas;
    const readable = bindings.size ? new Uint8Array(workBuffer(size, shared)) : mask;
    if (local) {
        for (let j = 0; j < region.height; j++) {
            const start = (region.top + j) * grid.width + region.left;
            readable.set(mask.subarray(start, start + region.width), j * region.width);
        }
    }
    else if (bindings.size) readable.set(mask);
    const length = readCanvas ? grid.size : region.cells.length;
    for (const [expression, samples] of bindings) {
        const input = { expression, region, fields, readable, local, samples, length };
        runBlocks(pool, length, Math.ceil(length / cellBlock), sampleBinding(input), (): BindingTask => ({ kind: "binding", ...input }));
    }
    return { bindings, readable, local };
}

type SeaMask = { source: Float32Array; level: number };
type CoastMask = { edge: Float32Array; reach: number; harbor: Extract<ResolvedGeoNode["function"], { type: "coast" }>["harbor"]; roughness: Expression;
    binding?: Float64Array; seed: number };
type ShoreMask = { frame: GridFrame; spec: GridSpec; land: Uint8Array; defined: Uint8Array; readable: Uint8Array;
    coast?: CoastMask; sea?: SeaMask };
export type ShoreMaskTask = ShoreMask & { kind: "shoreMask" };

export function fillShoreMask({ frame, spec, land, defined, readable, coast, sea }: ShoreMask) {
    const grid = createGrid(spec), { left, top, width } = frame;
    function coastLand({ edge, reach, harbor, roughness, binding, seed }: CoastMask) {
        const n1 = noise(seed), n2 = noise(seed + 101);
        return (k: number, at: number) => {
            const dc = -edge[at];
            let perturbation = 0;
            if (Math.abs(dc) < reach) {
                const x = grid.x(left + at % width), y = grid.y(top + Math.floor(at / width));
                const attenuation = harbor.radius > 0 ? smooth((Math.hypot(harbor.center[0] - x, harbor.center[1] - y) - harbor.radius) / harbor.span) : 1;
                const wx = x + 14 * fbm(n2, x / 70, y / 70, 3), wy = y + 14 * fbm(n2, x / 70 + 5.2, y / 70 + 1.3, 3);
                const value = typeof roughness === "number" ? roughness : binding![k];
                perturbation = value * attenuation * fbm(n1, wx / 38, wy / 38, 5) * 1.7;
            }
            return dc + perturbation > 0;
        };
    }
    const landAt = coast ? coastLand(coast) : (k: number) => sea!.source[k] > sea!.level;
    return (block: number) => {
        const start = block * shoreMaskBlock, end = Math.min(land.length, start + shoreMaskBlock);
        for (let at = start; at < end; at++) {
            const k = (top + Math.floor(at / width)) * grid.width + left + at % width;
            if (!readable[k]) continue;
            land[at] = +landAt(k, at);
            defined[at] = 1;
        }
    };
}

type CliffReach = { spec: GridSpec; cells: Int32Array; source: Float32Array; readable: Uint8Array; seed: number;
    limit: number; factor: Expression; binding?: Float64Array; distances: Float64Array };
export type CliffReachTask = CliffReach & { kind: "cliffReach" };

export function cliffReach({ spec, cells, source, readable, seed, limit, factor, binding, distances }: CliffReach) {
    const grid = createGrid(spec), gain = cliffGain(seed);
    return (block: number) => {
        const start = block * cellBlock, end = Math.min(cells.length, start + cellBlock);
        let distance = 0;
        for (let j = start; j < end; j++) {
            const k = cells[j];
            if (!readable[k] || !(source[k] > limit)) continue;
            const x = grid.x(k % grid.width), y = grid.y(Math.floor(k / grid.width));
            const g = (typeof factor === "number" ? factor : binding![k]) * gain(x, y);
            if (g > 0) distance = Math.max(distance, source[k] / g);
        }
        distances[block] = distance;
    };
}

interface ShoreData { land: Uint8Array; shore: Float32Array; frame: GridFrame }
interface PreparedLayer { coast?: ShoreData; sea?: ShoreData; erosion?: ErosionData; feather?: Segment[] }
type CellOutput = { cells?: Int32Array; values: Float32Array; counts: Int32Array; residuals: Float64Array };
type LayerCells = LayerContext & { data: PreparedLayer; output: CellOutput; blockSize: number };
export type LayerTask = LayerCells & { kind: "layer"; shape: number };

function shoreIndex(grid: Grid, { left, top, width }: GridFrame, k: number) {
    return (Math.floor(k / grid.width) - top) * width + k % grid.width - left;
}

function inputValue({ region, local, bindings }: LayerContext, v: Expression, k: number) {
    return typeof v === "number" ? v : bindings.get(v)![bindingIndex(region, local, k)];
}

function prepareLayer(context: LayerContext, grid: Grid, shape: RegionShape, frameFor: typeof shoreFrame, pool?: WorkPool): PreparedLayer {
    const { node: n, region, fields, readable, local, spec, bindings } = context, f = n.function, seed = f.seed as number;
    const { values: source, defined: mask } = fields[n.field], shared = !!pool?.size;
    function shoreWithin(frame: GridFrame, definedOnCanvas: Uint8Array, options: Pick<ShoreMask, "coast" | "sea">): ShoreData {
        const size = frame.width * frame.height;
        const land = new Uint8Array(workBuffer(size, shared)), defined = new Uint8Array(workBuffer(size, shared));
        const config = { frame, spec, land, defined, readable: definedOnCanvas, ...options };
        measureWork(pool, "prepareCells", () => runBlocks(pool, size, Math.ceil(size / shoreMaskBlock), fillShoreMask(config),
            (): ShoreMaskTask => ({ kind: "shoreMask", ...config }), undefined, shoreMaskParallelThreshold));
        return { land, shore: shoreDistance(frame, grid.step, land, defined, pool), frame };
    }
    function atSea(level: number, distance: number) {
        return shoreWithin(frameFor(grid, region, distance), mask, { sea: { source, level } });
    }
    switch (f.type) {
        case "noise": case "flat":
            return f.feather ? { feather: shape.boundary().flat() } : {};
        case "coast": {
            const shoreline = flattenPath(f.shore, grid.step / 8).map(s => s.a);
            const { roughness, harbor } = f, binding = typeof roughness === "string" ? bindings.get(roughness) : undefined;
            let reach = 1;
            if (typeof roughness === "number") {
                if (readable.some(value => value !== 0)) reach = Math.max(1, Math.abs(roughness) * 1.7 + 1);
            }
            else {
                for (let k = 0; k < grid.size; k++) if (readable[k]) reach = Math.max(reach, Math.abs(binding![k]) * 1.7 + 1);
            }
            const frame = frameFor(grid, region, coastDistance), scratch = new Float32Array(workBuffer(frame.width * frame.height * 4, shared));
            const edge = polygonField(grid, shoreline, reach, frame, scratch);
            return { coast: shoreWithin(frame, readable, { coast: { edge, reach, harbor, roughness, binding, seed } }) };
        }
        case "cliff": {
            const sea = f.seaLevel, limit = Math.max(sea, .4), { factor } = f, length = region.cells.length;
            const blocks = Math.ceil(length / cellBlock), distances = new Float64Array(workBuffer(blocks * 8, shared));
            const binding = typeof factor === "string" ? bindings.get(factor) : undefined;
            const config = { spec, cells: region.cells, source, readable, seed, limit, factor, binding, distances };
            measureWork(pool, "prepareCells", () => runBlocks(pool, length, blocks, cliffReach(config),
                (): CliffReachTask => ({ kind: "cliffReach", ...config })));
            return { sea: atSea(sea, distances.reduce((max, distance) => Math.max(max, distance), 0)) };
        }
        case "erosion": {
            const eligible = new Uint8Array(workBuffer(grid.size, shared));
            for (const k of region.cells)
                if (regionMaskAt(region, k) && readable[bindingIndex(region, local, k)] && source[k] > f.floor) eligible[k] = 1;
            return { erosion: prepareErosion(grid, eligible, source, f, seed, region.cells, shared) };
        }
        case "islets":
            return { sea: atSea(f.seaLevel, f.reach) };
        default:
            return {};
    }
}

function cliffGain(seed: number) {
    const n1 = noise(seed);
    return (x: number, y: number) => 1 + .3 * n1(x / 12, y / 12);
}

export function evaluateLayerCells(context: LayerCells, grid: Grid, shape: RegionShape) {
    const { node: n, region, fields, readable, local, data, blockSize, output: { cells, values, counts, residuals } } = context;
    const f = n.function, spec = functionTable[f.type], seed = f.seed as number;
    const { values: source, defined: mask } = fields[n.field];
    const input = (v: Expression, k: number) => inputValue(context, v, k);
    function featherWeight(width: number) {
        if (!width) return () => 1;
        const distanceToEdge = signedBoundaryDistance(shape, width, data.feather);
        return (x: number, y: number) => smooth(distanceToEdge(x, y) / width);
    }
    let residual: LayerOutput["residual"];
    type Cell = (k: number, x: number, y: number) => number;
    const stripPoint: Point = [0, 0];
    function stripInput(x: number, y: number): { cross: CrossSection; a: number; b: number } | undefined {
        const c = n.construction;
        if (c.type !== "strip") return;
        stripPoint[0] = x; stripPoint[1] = y;
        const cross = shape.cross?.(stripPoint);
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
    function createCalculator(): Cell | undefined {
        switch (f.type) {
            case "ground": return;
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
                const { land, shore, frame } = data.coast!;
                return k => {
                    const at = shoreIndex(grid, frame, k);
                    return source[k] + (land[at] ? Math.min(shore[at] * landRise, landCap) : -1 - Math.min(-shore[at] * seaFall, seaCap));
                };
            }
            case "mountain": {
                const height = mountainProfile(f, grid.step / 8, seed);
                return (k, x, y) => source[k] <= f.floor ? source[k] : height(x, y, source[k]);
            }
            case "cliff": {
                const sea = f.seaLevel, gain = cliffGain(seed), { shore, frame } = data.sea!;
                return (k, x, y) => source[k] <= sea ? source[k] :
                    Math.min(source[k], Math.max(.4, shore[shoreIndex(grid, frame, k)] * input(f.factor, k) * gain(x, y)));
            }
            case "erosion": {
                const delta = erosionSampler(data.erosion!);
                return (k, x, y) => source[k] + delta(k, x, y) * input(f.strength, k);
            }
            case "islets": {
                const n3 = noise(seed + 202);
                const sea = f.seaLevel, { shore, frame } = data.sea!;
                return (k, x, y) => {
                    const density = input(f.density, k);
                    return source[k] <= sea && -shore[shoreIndex(grid, frame, k)] <= f.reach && density > f.threshold &&
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
    const calculate = createCalculator();
    if (!cells) return (block: number) => {
        const start = block * blockSize, end = Math.min(region.cells.length, start + blockSize);
        for (let i = start; i < end; i++) {
            const k = region.cells[i];
            values[i] = calculate!(k, grid.x(k % grid.width), grid.y(Math.floor(k / grid.width)));
        }
    };
    return (block: number) => {
        const start = block * blockSize, end = Math.min(region.cells.length, start + blockSize);
        let at = start;
        residual = undefined;
        for (let i = start; i < end; i++) {
            const k = region.cells[i];
            if (!spec.initial && !readable[bindingIndex(region, local, k)]) continue;
            const x = grid.x(k % grid.width), y = grid.y(Math.floor(k / grid.width));
            if (calculate) values[at] = calculate(k, x, y);
            else {
                const neighbors = stripInput(x, y);
                if (!neighbors) continue;
                values[at] = calculateStrip(k, neighbors);
            }
            cells[at++] = k;
        }
        counts[block] = at - start;
        const best = residual as LayerOutput["residual"];
        if (best) {
            residuals[3 * block] = best.height;
            residuals[3 * block + 1] = best.point[0];
            residuals[3 * block + 2] = best.point[1];
        }
    };
}

export function evaluateLayer(n: ResolvedGeoNode, { shape, ...region }: Region, state: FieldState, frameFor = shoreFrame, pool?: WorkPool): LayerOutput {
    const { grid, fields } = state, length = region.cells.length, type = n.function.type;
    const samplesStrip = type === "blend" || type === "split" || type === "batter";
    const blockSize = samplesStrip ? 2048 : cellBlock, blocks = Math.ceil(length / blockSize);
    const minimum = samplesStrip ? 16384 : parallelThreshold;
    if (n.function.type === "ground") {
        const value = n.function.value;
        return measureWork(pool, "evaluateCells", () => ({
            cells: region.cells, values: new Float32Array(length).fill(value)
        }));
    }
    const bound = measureWork(pool, "sampleBindings", () => bindInputs(n, region, state, pool));
    const context = { node: n, region, fields, spec: gridSpec(grid), ...bound };
    const data = prepareLayer(context, grid, shape, frameFor, pool);
    return measureWork(pool, "evaluateCells", () => {
        const ref = pool?.size ? shapeWork(shape) : undefined;
        const shared = !!ref && length >= minimum, dense = !samplesStrip && !bound.readable.includes(0);
        const output: CellOutput = {
            cells: dense ? undefined : new Int32Array(workBuffer(length * 4, shared)), values: new Float32Array(workBuffer(length * 4, shared)),
            counts: new Int32Array(workBuffer(blocks * 4, shared)), residuals: new Float64Array(workBuffer(blocks * 24, shared))
        };
        const input = { ...context, data, output, blockSize };
        runBlocks(ref ? pool : undefined, length, blocks, evaluateLayerCells(input, grid, shape),
            (): LayerTask => ({ kind: "layer", shape: ref!.revision, ...input }), ref?.references, minimum);
        const { cells, values, counts, residuals } = output;
        if (!cells) return { cells: region.cells, values };
        let count = 0, residual: LayerOutput["residual"];
        for (let block = 0; block < blocks; block++) {
            const start = block * blockSize, end = start + counts[block];
            if (count !== start) {
                cells.copyWithin(count, start, end);
                values.copyWithin(count, start, end);
            }
            count += counts[block];
            const height = residuals[3 * block];
            if (height && (!residual || height > residual.height))
                residual = { height, point: [residuals[3 * block + 1], residuals[3 * block + 2]] };
        }
        return { cells: cells.subarray(0, count), values: values.subarray(0, count), residual };
    });
}

export function applyLayer(output: LayerOutput, n: Pick<GeoNode, "field" | "function">, state: FieldState) {
    const { values, defined } = state.fields[n.field], initial = functionTable[n.function.type].initial;
    const length = output.cells.length, first = output.cells[0];
    if (length && output.cells[length - 1] - first + 1 === length) {
        values.set(output.values, first);
        if (initial) defined.fill(1, first, first + length);
        return;
    }
    for (let i = 0; i < length; i++) {
        const k = output.cells[i];
        values[k] = output.values[i];
        if (initial) defined[k] = 1;
    }
}