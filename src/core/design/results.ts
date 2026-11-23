import { type Grid, type Point } from "../math/geometry.ts";
import { type buildingShape } from "./shapes.ts";
import { type Building, type Edge, type Species } from "./v5.ts";
import { type Region } from "./regions.ts";

export interface RoutingSurface {
    grid: Grid;
    heights: Float32Array;
    clearance: Float32Array;
    defined: Uint8Array;
    search?: { cost: Float64Array; parent: Int32Array; seen: Int32Array; clock: number };
}
export interface Terrain extends RoutingSurface {
    fields: Record<string, Float32Array>;
    shore: Float32Array;
    buildings: ReturnType<typeof buildingShape<Building>>[];
    pads: number[][];
    padMask: Uint8Array;
    regions: Map<string, Region>;
    batterResiduals: Map<string, { height: number; point: Point }>;
}
export interface RoutePart {
    index: number; points: Point[]; round?: boolean; lock?: boolean; failed?: boolean;
}
export interface SmallCorner {
    point: Point; radius: number; requested: number; arcs: { road: string; ends: Point[] }[];
}
export interface Alignment {
    id: string; edge: Edge; points: Point[]; controls: Point[]; parts: RoutePart[];
    offCanvas?: boolean;
    rounds?: [number, number][]; platforms?: number[]; landings?: Point[]; branches?: boolean[];
    smallCorners?: SmallCorner[]; selfOverlaps?: Point[]; constraintKey?: string;
}
export interface Route extends Alignment {
    s: Float64Array; h: number[]; stairs: boolean[]; grades: number[]; peaks: number[]; locations: number[];
    length: number; drop: number; maxGrade: number; stairRuns: number; stairLength: number; detour: number;
}
export interface Graded { heights: Float32Array; weight: Float32Array }
export interface SurfaceCell { type: 0 | 1 | 2 | 3 | 4; slope: number }
export interface Tree { point: Point; radius: number; species: Exclude<Species, "mixed">; wooded: boolean; planting?: string; row?: boolean }
export interface IssueSpan { road: string; from: number; to: number }
export interface Issue {
    kind: string; severity: "error" | "notice"; message: string; point: Point; spans?: IssueSpan[];
    road?: string; other?: string; node?: string; otherNode?: string; building?: string; geoNode?: string; label?: string;
}