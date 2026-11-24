import { sampleDefined, type Grid, type Point } from "../math/geometry.ts";
import { type Location } from "./problems.ts";
import { type Region } from "./regions.ts";

export interface FieldSamples { values: Float32Array; defined: Uint8Array }

export interface Terrain {
    grid: Grid;
    fields: Record<string, FieldSamples>;
    shore: Float32Array;
    regions: Map<string, Region>;
    batterResiduals: Map<string, { height: number; point: Point }>;
}
export interface SurfaceCell { type: 0 | 1 | 2 | 3; slope: number }
export interface Issue {
    kind: string; severity: "error" | "warning"; message: string; point: Point; geoNode?: string; label?: string; location?: Location;
}
export function sampleField(t: Terrain, id: string, p: Point) {
    if (!Object.hasOwn(t.fields, id)) return;
    const { values, defined } = t.fields[id];
    return sampleDefined(t.grid, values, defined, ...p);
}