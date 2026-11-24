import { type Design, type ResolvedDesign } from "../design/v5.ts";
import { rasterRegion, shapeLayout } from "../design/regions.ts";
import { type Terrain, type FieldSamples } from "../design/results.ts";
import { heightId } from "../design/defaults.ts";
import { type Grid } from "../math/geometry.ts";
import { resolveDesign } from "../design/parameters.ts";
import { applyLayer, evaluateLayer, type FieldState } from "./functions.ts";
import { shoreDistance } from "./shore.ts";

export function layout(d: ResolvedDesign) {
    const { grid, shapes } = shapeLayout(d);
    const regions = new Map([...shapes].map(([id, shape]) => [id, rasterRegion(grid, shape)]));
    return { grid, regions };
}

export function emptyField(grid: Grid): FieldSamples {
    return { values: new Float32Array(grid.size), defined: new Uint8Array(grid.size) };
}

export function initialFields(d: ResolvedDesign, grid: Grid): FieldState {
    return { grid, fields: Object.fromEntries(Object.keys(d.fields).map(id => [id, emptyField(grid)])) };
}

export function evaluateStack(source: Design) {
    return resolvedStack(resolveDesign(source));
}

function resolvedStack(d: ResolvedDesign) {
    const { grid, regions } = layout(d), state = initialFields(d, grid);
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
    const { grid, regions, batterResiduals, fields } = stack, { values, defined } = fields[heightId];
    const shore = shoreDistance(grid, Uint8Array.from(values, h => +(h > 0)), defined);
    return { grid, fields, shore, regions, batterResiduals };
}

export function generateTerrain(d: Design) {
    return finishTerrain(evaluateStack(d));
}