import { type Design, type ResolvedDesign } from "../design/v5.ts";
import { type Region, type RegionShape } from "../design/regions.ts";
import { type Terrain } from "../design/results.ts";
import { resolveDesign } from "../design/parameters.ts";
import { buildingShape } from "../design/shapes.ts";
import { eachCell, sampleDefined, type Grid } from "../math/geometry.ts";
import { canvasGrid, makeShape, rasterRegion } from "./regions.ts";
import { applyLayer, evaluateLayer, type FieldState } from "./functions.ts";
import { shoreDistance } from "./shore.ts";

export function layout(d: ResolvedDesign) {
    const shapes = new Map<string, RegionShape>();
    for (const n of d.geoNodes) shapes.set(n.id, makeShape(n, shapes, d.grid.step / 8));
    const grid = canvasGrid(d, shapes);
    const regions = new Map([...shapes].map(([id, shape]) => [id, rasterRegion(grid, shape)]));
    return { grid, regions };
}

export function initialFields(d: ResolvedDesign, grid: Grid, regions: Map<string, Region>): FieldState {
    const defined = new Uint8Array(grid.size);
    for (const n of d.geoNodes)
        if (!n.disabled && n.function.type === "ground") for (const k of regions.get(n.id)!.cells) defined[k] = 1;
    const fields = Object.fromEntries(Object.entries(d.fields).map(([key, f]) => [key, Float32Array.from(defined, v => v ? f.default : 0)]));
    fields.height = new Float32Array(grid.size);
    return { grid, defined, fields, heightDefined: new Uint8Array(grid.size) };
}

export function evaluateStack(source: Design) {
    return resolvedStack(resolveDesign(source));
}

function resolvedStack(d: ResolvedDesign) {
    const { grid, regions } = layout(d), state = initialFields(d, grid, regions);
    const batterResiduals: Terrain["batterResiduals"] = new Map();
    for (const n of d.geoNodes) {
        if (n.disabled) continue;
        const result = evaluateLayer(n, regions.get(n.id)!, state);
        applyLayer(result, n, state);
        if (result.residual) batterResiduals.set(n.id, result.residual);
    }
    return { ...state, regions, batterResiduals };
}

export function finishTerrain(d: ResolvedDesign, stack: ReturnType<typeof evaluateStack>): Terrain {
    const { grid, defined, regions, batterResiduals } = stack;
    const heights = stack.fields.height.slice(), fields = { ...stack.fields, height: heights };
    const buildings = d.buildings.map(b => buildingShape(b)), padMask = new Uint8Array(grid.size);
    const shore = shoreDistance(grid, Uint8Array.from(heights, h => +(h > 0)), defined);
    const clearance = new Float32Array(grid.size).fill(1e5);
    const pads = buildings.map(b => {
        const data = b.data, cells: number[] = [], pad = data.pad ?? (b.polygon ? 1.3 : data.radius! + 1.3);
        eachCell(grid, b.box, Math.max(16, pad), (k, x, y) => {
            if (!defined[k]) return;
            const gap = b.signedDistance(x, y);
            clearance[k] = Math.min(clearance[k], gap - (data.blockMargin ?? 0));
            if (b.polygon ? gap < pad : Math.hypot(x - data.center[0], y - data.center[1]) <= pad) {
                cells.push(k);
                padMask[k] = 1;
            }
        });
        if (cells.length) {
            const center = data.summit ? sampleDefined(grid, heights, defined, ...data.center) : undefined;
            const h = center ?? cells.reduce((sum, k) => sum + heights[k], 0) / cells.length;
            for (const k of cells) heights[k] = h;
        }
        return cells;
    });
    return { grid, defined, fields, stackHeights: stack.fields.height, heights, shore, clearance, padMask, pads, buildings, regions, batterResiduals };
}

export function generateTerrain(d: Design) {
    const numeric = resolveDesign(d);
    return finishTerrain(numeric, resolvedStack(numeric));
}