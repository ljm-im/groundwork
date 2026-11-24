import { type Design, type ResolvedDesign } from "../design/v5.ts";
import { type Region, rasterRegion, shapeLayout } from "../design/regions.ts";
import { type Terrain } from "../design/results.ts";
import { type Grid } from "../math/geometry.ts";
import { resolveDesign } from "../design/parameters.ts";
import { applyLayer, evaluateLayer, type FieldState } from "./functions.ts";
import { shoreDistance } from "./shore.ts";

export function layout(d: ResolvedDesign) {
    const { grid, shapes } = shapeLayout(d);
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

export function finishTerrain(stack: ReturnType<typeof evaluateStack>): Terrain {
    const { grid, defined, regions, batterResiduals, fields } = stack, heights = fields.height;
    const shore = shoreDistance(grid, Uint8Array.from(heights, h => +(h > 0)), defined);
    return { grid, defined, fields, heights, shore, regions, batterResiduals };
}

export function generateTerrain(d: Design) {
    return finishTerrain(evaluateStack(d));
}