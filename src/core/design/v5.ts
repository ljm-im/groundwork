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
export interface CurveNode<N = Expression> {
    id: string;
    p: Point;
    mode: "corner" | "auto" | "manual";
    in?: Point;
    out?: Point;
    bulge?: number;
    h?: N;
}
export interface Curve<N = Expression> { closed: boolean; nodes: CurveNode<N>[] }
export type ClosedCurve = Curve<never> & { closed: true };
export interface HolderRef { ref: string }
export interface CurveRef<N = Expression> { ref: string; h?: Record<string, N> }
export interface SharedCurve { label: string; curve: Curve<never> }
export type CurveValue<N = Expression> = Curve<N> | CurveRef<N>;
export type CurveHolder<C, Extra = object> = { offset?: Point; curve: C } & Extra;
export type Held<C, Extra = object> = CurveHolder<C, Extra> | HolderRef;
type GeometryState = "authored" | "resolved";
type Geometry<C, State, Ref = CurveRef<never>> = State extends "resolved" ? C : Held<C | Ref>;
export interface Strip<N = Expression> {
    type: "strip";
    of: [string] | [string, string];
    widths: [N, N];
    range?: { from: string; to: string };
}
export type Construction<N = Expression, State extends GeometryState = "authored"> = { type: "outline"; outlines: Geometry<ClosedCurve, State>[] } | Strip<N>;
export type Ridge<N, State extends GeometryState = "authored"> = State extends "resolved" ? { curve: Curve<N>; slope: N } : Held<CurveValue<N>, { slope: N }>;
export interface Peak<N> { at: Point; height: N; radius: N; noise: N; scale: N }
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

export type GeoFunction<N = Expression, State extends GeometryState = "authored"> = (
    { type: "ground"; value: N } |
    { type: "flat"; amount: Expression; feather?: N } |
    { type: "coast"; shore: Geometry<ClosedCurve, State>; roughness: Expression; harbor: { center: Point; span: N; radius: N } } |
    { type: "mountain"; ridges: Ridge<N, State>[]; peaks: Peak<N>[]; floor?: N; crestRound?: N; footRound?: N; blend?: N } |
    { type: "cliff"; factor: Expression; seaLevel?: N } |
    ({ type: "erosion"; strength?: Expression; floor?: N; spacing?: N } & NumericProperties<Erosion, N>) |
    { type: "islets"; density: Expression; reach: N; threshold?: N; seaLevel?: N } |
    { type: "slope"; kind: "path"; line: Geometry<Curve<N>, State, CurveRef<N>>; ease?: boolean } |
    { type: "slope"; kind: "radial"; center: Point; radius: N; value: N; rate: N } |
    { type: "noise"; amplitude: Expression; scale: N; octaves?: N; feather?: N; warp?: N; warpScale?: N; carve?: N } |
    { type: "blend" | "split" } |
    { type: "batter"; grade: N }
) & { seed?: N };
export interface GeoNode<N = Expression, State extends GeometryState = "authored"> extends MapLabel {
    disabled?: true;
    prompt?: string;
    field: string;
    construction: Construction<N, State>;
    function: GeoFunction<N, State>;
    fill?: string;
    outline?: boolean;
}
export type PlacedGeoNode = GeoNode<Expression, "resolved">;
export interface FieldDeclaration { label: string; unit?: string; precision?: number }
export interface DesignData<N, State extends GeometryState = "authored"> {
    version: 5;
    prompt?: string;
    grid: { step: number };
    inputs: Record<string, CustomInput<N>>;
    fields: Record<string, FieldDeclaration>;
    curves: Record<string, SharedCurve>;
    geoNodes: GeoNode<N, State>[];
    sections: Section[];
    marks: Mark<N>[];
}

export interface Design extends DesignData<Expression> {}
type ResolveFunction<F> = F extends GeoFunction<number, "resolved"> ? F & Required<Omit<F, "seed" | "ease">> : never;
export type ResolvedFunction = ResolveFunction<GeoFunction<number, "resolved">>;
export type ResolvedGeoNode = Omit<GeoNode<number, "resolved">, "function"> & { function: ResolvedFunction };
export type ResolvedDesign = Omit<DesignData<number, "resolved">, "geoNodes" | "marks"> & { geoNodes: ResolvedGeoNode[]; marks: Required<Mark<number>>[] };