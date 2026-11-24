import { type Point } from "../math/geometry.ts";

export { type Point } from "../math/geometry.ts";
export type Expression = number | string;
type NumericProperties<T, N> = { [K in keyof T]: Exclude<T[K], undefined> extends number ? N : T[K] };
export interface Labeled { id: string; label: string; showLabel?: boolean }
interface MapLabel extends Labeled { labelOffset?: Point }
export interface Section extends MapLabel {
    points: [Point, Point];
    prompt?: string;
}
export type MarkFollow = "screen" | "map";
interface MarkBase extends Labeled { point: Point; follow: MarkFollow }
export interface TextMark<N = Expression> extends MarkBase {
    kind: "text";
    elevation?: N;
    showElevation?: boolean;
}
export interface ScaleMark<N = Expression> extends MarkBase { kind: "scale"; length?: N }
export type Mark<N = Expression> = TextMark<N> | ScaleMark<N>;

export const defaultFollow = (kind: Mark["kind"]): MarkFollow => kind === "scale" ? "screen" : "map";

export interface CustomInput<N = Expression> { value: N; label?: string; range: [number, number, number] }
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
export interface Erosion {
    /** Number of simulated droplets. */
    droplets: number;
    /** Fraction of the previous direction retained. */
    inertia: number;
    /** Sediment capacity multiplier. */
    capacity: number;
    /** Minimum sediment carrying capacity. */
    minCapacity: number;
    /** Fraction of surplus sediment deposited per step. */
    deposition: number;
    /** Fraction of the sediment deficit eroded per step. */
    erosion: number;
    /** Fraction of water lost per step. */
    evaporation: number;
    /** Acceleration coefficient used to update droplet speed. */
    gravity: number;
    /** Maximum droplet travel distance in metres. */
    lifetime: number;
    /** Erosion brush radius in metres. */
    radius: number;
}

export type GeoFunction<N = Expression> = (
    { type: "ground"; value: N } |
    { type: "flat"; amount: Expression; feather?: N } |
    { type: "coast"; shore: Path; roughness: Expression; harbor: { center: Point; span: N; radius: N } } |
    { type: "mountain"; ridges: Ridge<N>[]; peaks: Peak<N>[]; floor?: N } |
    { type: "cliff"; factor: Expression; seaLevel?: N } |
    ({ type: "erosion"; strength?: Expression; floor?: N } & NumericProperties<Erosion, N>) |
    { type: "islets"; density: Expression; reach: N; threshold?: N; seaLevel?: N } |
    { type: "slope"; kind: "path"; line: Polyline<N>; ease?: boolean } |
    { type: "slope"; kind: "radial"; center: Point; radius: N; value: N; rate: N } |
    { type: "noise"; amplitude: Expression; scale: N; octaves?: N; feather?: N } |
    { type: "blend" | "split" } |
    { type: "batter"; grade: N }
) & { seed?: N };
export interface GeoNode<N = Expression> extends MapLabel {
    disabled?: true;
    prompt?: string;
    field: string;
    construction: Construction<N>;
    function: GeoFunction<N>;
    fill?: string;
    outline?: boolean;
}
export interface FieldDeclaration { label: string; unit?: string; precision?: number }
export interface DesignData<N> {
    version: 5;
    prompt?: string;
    grid: { step: number };
    inputs: Record<string, CustomInput<N>>;
    fields: Record<string, FieldDeclaration>;
    geoNodes: GeoNode<N>[];
    sections: Section[];
    marks: Mark<N>[];
}

export interface Design extends DesignData<Expression> {}
type ResolveFunction<F> = F extends GeoFunction<number> ? F & Required<Omit<F, "seed" | "ease">> : never;
export type ResolvedFunction = ResolveFunction<GeoFunction<number>>;
export type ResolvedGeoNode = Omit<GeoNode<number>, "function"> & { function: ResolvedFunction };
export type ResolvedDesign = Omit<DesignData<number>, "geoNodes" | "marks"> & { geoNodes: ResolvedGeoNode[]; marks: Required<Mark<number>>[] };