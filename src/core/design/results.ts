import { type Grid, type Point } from "../math/geometry.ts";
import { type Region } from "./regions.ts";

export interface Terrain {
    grid: Grid;
    heights: Float32Array;
    fields: Record<string, Float32Array>;
    shore: Float32Array;
    defined: Uint8Array;
    regions: Map<string, Region>;
    batterResiduals: Map<string, { height: number; point: Point }>;
}
export interface SurfaceCell { type: 0 | 1 | 2 | 3; slope: number }
export interface Issue {
    kind: string; severity: "error" | "notice"; message: string; point: Point; geoNode?: string; label?: string;
}