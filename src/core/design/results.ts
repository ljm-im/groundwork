import { type Box, type Grid, type Point } from "../math/geometry.ts";
import { type areaBoundary, type buildingShape } from "./shapes.ts";
import { type Edge, type Peak, type Ridge, type Species, type Zone, type ZoneHeight } from "./types.ts";

export interface TerrainZone extends Zone {
    polygon: Point[];
    box: Box;
    stations: Float64Array | null;
    cells: number[];
    marker?: Point;
}
export interface RoutingSurface {
    grid: Grid;
    heights: Float32Array;
    clearance: Float32Array;
    search?: { cost: Float64Array; parent: Int32Array; seen: Int32Array; clock: number };
}
export interface Terrain extends RoutingSurface {
    coast: Point[];
    zones: TerrainZone[];
    ridges: (Ridge & { line: Point[]; index: Uint32Array; fraction: Float64Array; falloff: Float32Array; gain: Float32Array })[];
    peaks: (Peak & { factor: Float32Array })[];
    buildings: ReturnType<typeof buildingShape>[];
    yards: { yard: ReturnType<typeof areaBoundary>; box: Box; cells: number[]; shoulders: [number, number][]; height: ZoneHeight }[];
    pads: number[][];
    land: Uint8Array;
    islet: Uint8Array;
    padMask: Uint8Array;
    zoneAt: Int16Array;
    coefficients: Record<string, Float32Array>;
    rock: Float32Array;
    detail: Float32Array;
    cliff: Float32Array;
    dc: Float32Array;
    erosionWeight: Float32Array;
    natural: Float32Array;
    naturalWeight: Float32Array;
    base: Float32Array;
    flow: Float32Array;
    delta: Float32Array;
}
export interface RoutePart {
    index: number; points: Point[]; round?: boolean; lock?: boolean; failed?: boolean;
}
export interface SmallCorner {
    point: Point; radius: number; requested: number; arcs: { road: string; ends: Point[] }[];
}
export interface Alignment {
    id: string; edge: Edge; points: Point[]; controls: Point[]; parts: RoutePart[];
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
    road?: string; other?: string; node?: string; otherNode?: string; building?: string; zone?: string; label?: string;
}