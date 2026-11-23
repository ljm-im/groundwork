import { type Building as Footprint, type ClearingShape, type Disk, type Edge, type Erosion, type Harbor, type Label as MapLabel, type Named, type NoiseSettings, type Planting as PlantingRules, type Point, type RoadClass, type RoadNode as NetworkNode, type Routing, type Section } from "./types.ts";

export { type ClearingShape, type Disk, type Door, type Edge, type Erosion, type Named, type Point, type RoadClass, type RoadMode, type RoadPair, type Routing, type Section, type Segment, type Species } from "./types.ts";
export type Building = Omit<Footprint, "zone">;
export type RoadNode = Omit<NetworkNode, "yard" | "at" | "type"> & { type: Exclude<NetworkNode["type"], "gate"> };
export type Planting = Omit<PlantingRules, "zones">;
export type Label = Omit<MapLabel, "level"> & { var?: string };
export interface Clearing extends Named { shape: ClearingShape; cover?: "ambient" }
export interface Vegetation {
    density: { natural: number };
    rooms: Disk[];
    yardTree: Disk;
    plantings: Planting[];
    clearings: Clearing[];
}

export type Height = number | { var: string; offset?: number };
export type FieldInput = number | { field: string; scale?: number; offset?: number };
export interface Variable { value: number; label?: string; range?: [number, number, number] }
export interface PathNode {
    id: string;
    p: Point;
    mode: "corner" | "auto" | "manual";
    in?: Point;
    out?: Point;
    next?: "line" | "curve" | "arc";
    bulge?: number;
}
export interface Path { closed: true; nodes: PathNode[] }
export interface Polyline { points: { p: Point; h?: Height }[]; smooth?: boolean }
export interface Strip {
    type: "strip";
    of: [string] | [string, string];
    widths: Point;
    range?: { from: string; to: string };
}
export type Construction = { type: "free"; paths: Path[] } | Strip;
interface Noise { amplitude: number; scale?: number }
export interface Ridge { line: Polyline; widths: Point; widthNoise: NoiseSettings; heightNoise: NoiseSettings }
export interface Peak { at: { p: Point; h: Height }; radius: number; noise: number; scale: number }
export type GeoFunction = (
    { type: "ground" | "flat"; value: Height; noise?: Noise } |
    { type: "coast"; shore: Path; roughness: FieldInput; harbor?: Harbor } |
    { type: "mountain"; ridges: Ridge[]; peaks: Peak[]; floor?: Height } |
    { type: "cliff"; factor: FieldInput; seaLevel?: Height } |
    ({ type: "erosion"; strength?: FieldInput; floor?: Height } & Erosion) |
    { type: "islets"; density: FieldInput; reach: number; threshold?: number; seaLevel?: Height } |
    { type: "slope"; kind: "path"; line: Polyline; ease?: boolean; noise?: Noise } |
    { type: "slope"; kind: "radial"; center: Point; radius: number; value: Height; rate: number; noise?: Noise } |
    { type: "add"; amount: Height; feather: number } |
    { type: "blend" | "split" } |
    { type: "batter"; grade: number }
) & { seed?: number };
export interface GeoNode extends Named {
    prompt?: string;
    field?: string;
    construction: Construction;
    function: GeoFunction;
    fill?: string;
    outline?: boolean;
}
export interface Design {
    version: 5;
    prompt?: string;
    seed: number;
    grid: { step: number };
    variables: Record<string, Variable>;
    fields: Record<string, { label?: string; default: number }>;
    geoNodes: GeoNode[];
    buildings: Building[];
    nodes: RoadNode[];
    edges: Edge[];
    roadClasses: Record<string, RoadClass>;
    routing: Routing;
    vegetation: Vegetation;
    sections: Section[];
    labels: Label[];
}

export const elevation = (h: Height, vars: Design["variables"]) => typeof h === "number" ? h : vars[h.var].value + (h.offset ?? 0);