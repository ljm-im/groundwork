import { type Building as Footprint, type ClearingShape, type Disk, type Edge as Road, type Erosion, type Label as MapLabel, type Named, type Planting as PlantingRules, type Point, type RoadClass, type RoadNode as NetworkNode, type Routing, type Section } from "./types.ts";

export { type ClearingShape, type Disk, type Ellipse, type Polygon, type Sector, type Erosion, type Named, type Point, type RoadClass, type RoadMode, type RoadPair, type Routing, type Section, type Segment, type Species } from "./types.ts";
export type Expression = number | string;
type NumericProperties<T, N> = { [K in keyof T]: Exclude<T[K], undefined> extends number ? N : T[K] };
export type Door<N = number> = NumericProperties<Footprint["doors"][number], N>;
export type Building<N = number> = NumericProperties<Omit<Footprint, "zone" | "size" | "doors">, N> & { size?: [N, N]; doors: Door<N>[] };
export type Edge<N = number> = NumericProperties<Road, N>;
export type RoadNode<N = number> = NumericProperties<Omit<NetworkNode, "yard" | "at" | "type">, N> & { type: Exclude<NetworkNode["type"], "gate">; directionMode?: "auto" | "manual" };
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

export interface Variable<N = Expression> { value: N; label?: string; range?: [number, number, number] }
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
export interface Polyline<N = Expression> { points: { p: Point; h?: N }[]; smooth?: boolean }
export interface Strip<N = Expression> {
    type: "strip";
    of: [string] | [string, string];
    widths: [N, N];
    range?: { from: string; to: string };
}
export type Construction<N = Expression> = { type: "free"; paths: Path[] } | Strip<N>;
export interface RidgeNoise<N> { amount: N; wavelength: N }
export interface Ridge<N> { line: Polyline<N>; widths: [N, N]; widthNoise: RidgeNoise<N>; heightNoise: RidgeNoise<N> }
export interface Peak<N> { at: { p: Point; h: N }; radius: N; noise: N; scale: N }
export type GeoFunction<N = Expression> = (
    { type: "ground" | "flat"; value: N } |
    { type: "coast"; shore: Path; roughness: Expression; harbor?: { center: Point; span: N; radius: N } } |
    { type: "mountain"; ridges: Ridge<N>[]; peaks: Peak<N>[]; floor?: N } |
    { type: "cliff"; factor: Expression; seaLevel?: N } |
    ({ type: "erosion"; strength?: Expression; floor?: N } & NumericProperties<Erosion, N>) |
    { type: "islets"; density: Expression; reach: N; threshold?: N; seaLevel?: N } |
    { type: "slope"; kind: "path"; line: Polyline<N>; ease?: boolean } |
    { type: "slope"; kind: "radial"; center: Point; radius: N; value: N; rate: N } |
    { type: "add"; amount: N; feather: N } |
    { type: "noise"; amplitude: Expression; scale: N; octaves?: N; feather?: N } |
    { type: "blend" | "split" } |
    { type: "batter"; grade: N }
) & { seed?: N };
export interface GeoNode<N = Expression> extends Named {
    disabled?: true;
    prompt?: string;
    field?: string;
    construction: Construction<N>;
    function: GeoFunction<N>;
    fill?: string;
    outline?: boolean;
}
export interface DesignData<N> {
    version: 5;
    prompt?: string;
    grid: { step: number };
    variables: Record<string, Variable<N>>;
    fields: Record<string, { label?: string; default: N }>;
    geoNodes: GeoNode<N>[];
    buildings: Building<N>[];
    nodes: RoadNode<N>[];
    edges: Edge<N>[];
    roadClasses: Record<string, RoadClass>;
    routing: NumericProperties<Routing, N>;
    vegetation: Vegetation;
    sections: Section[];
    labels: Label[];
}

export interface Design extends DesignData<Expression> {}
export type ResolvedDesign = DesignData<number>;
export type NetworkDesign = Pick<ResolvedDesign, "nodes" | "edges" | "buildings" | "roadClasses" | "routing">;