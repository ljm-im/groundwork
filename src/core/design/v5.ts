import { type Point } from "../math/geometry.ts";

export { type Point } from "../math/geometry.ts";
export type Expression = number | string;
type NumericProperties<T, N> = { [K in keyof T]: Exclude<T[K], undefined> extends number ? N : T[K] };
export interface Labeled { id: string; label: string; showLabel?: boolean }
interface MapLabel extends Labeled { labelOffset?: Point }
type GeometryState = "authored" | "resolved";
export interface PointHolder { offset?: Point; point: string }
type Position<State extends GeometryState> = State extends "resolved" ? Point : PointHolder;
export interface Section<State extends GeometryState = "authored"> extends MapLabel {
    points: [Position<State>, Position<State>];
    prompt?: string;
}
export type MarkFollow = "screen" | "map";
type MarkBase<State extends GeometryState> = Labeled & { point: Position<State>; follow: MarkFollow } &
    (State extends "resolved" ? object : { screen: Point });
export type TextMark<N = Expression, State extends GeometryState = "authored"> = MarkBase<State> & {
    kind: "text";
    elevation?: N;
    showElevation?: boolean;
};
export type ScaleMark<N = Expression, State extends GeometryState = "authored"> = MarkBase<State> & { kind: "scale"; length?: N };
export type Mark<N = Expression, State extends GeometryState = "authored"> = TextMark<N, State> | ScaleMark<N, State>;

export const defaultFollow = (kind: Mark["kind"]): MarkFollow => kind === "scale" ? "screen" : "map";

export interface CustomInput<N = Expression> { value: N; label?: string; range: [number, number, number] }
export type NodeQuantity = "h" | "slope";
export interface CurveNode {
    id: string;
    p: Point;
    mode: "corner" | "auto" | "manual";
    in?: Point;
    out?: Point;
    bulge?: number;
}
export interface Curve { closed: boolean; nodes: CurveNode[] }
export type ClosedCurve = Curve & { closed: true };
export interface ProfileNode<N = Expression> extends CurveNode {
    h?: N;
    slope?: N;
    /** Quantities that use interpolation and retain their last authored values. */
    interpolate?: NodeQuantity[];
}
export interface ProfileCurve<N = Expression> extends Curve { nodes: ProfileNode<N>[] }
export interface NodeRecords<N = Expression> {
    h?: Record<string, N>;
    slope?: Record<string, N>;
    interpolate?: Record<string, NodeQuantity[]>;
}
interface GeometryLabel { label: string; listed?: true }
export interface PointGeometry extends GeometryLabel { point: Point }
export interface CurveGeometry extends GeometryLabel { curve: Curve }
export type GeometryObject = PointGeometry | CurveGeometry;
export interface HolderRef { ref: string }
export type CurveHolder<Extra = object> = { offset?: Point; curve: string } & Extra;
export type Held<Extra = object> = CurveHolder<Extra> | HolderRef;
type Geometry<C, State> = State extends "resolved" ? C : Held;
export interface Strip<N = Expression> {
    type: "strip";
    of: [string] | [string, string];
    widths: [N, N];
    range?: { from: string; to: string };
}
export type Construction<N = Expression, State extends GeometryState = "authored"> = { type: "outline"; outlines: Geometry<ClosedCurve, State>[] } | Strip<N>;
type ProfileLine<N, State, Extra = object> = State extends "resolved" ? { curve: ProfileCurve<N> } & Extra : Held<NodeRecords<N> & Extra>;
export interface Peak<N, State extends GeometryState = "authored"> { at: Position<State>; height: N; radius: N; noise: N; scale: N }
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
    { type: "coast"; shore: Geometry<ClosedCurve, State>; roughness: Expression; harbor: { center: Position<State>; span: N; radius: N } } |
    { type: "mountain"; ridges: ProfileLine<N, State>[]; valleys: ProfileLine<N, State>[]; peaks: Peak<N, State>[]; floor?: N; crestRound?: N; footRound?: N; blend?: N } |
    { type: "cliff"; factor: Expression; seaLevel?: N } |
    ({ type: "erosion"; strength?: Expression; floor?: N; spacing: N } & NumericProperties<Erosion, N>) |
    { type: "islets"; density: Expression; reach: N; threshold?: N; seaLevel?: N } |
    { type: "slope"; kind: "path" | "radial"; lines: ProfileLine<N, State, { ease?: boolean }>[]; center: Position<State>; radius: N; value: N; rate: N } |
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
    geometry: Record<string, GeometryObject>;
    geoNodes: GeoNode<N, State>[];
    sections: Section<State>[];
    marks: Mark<N, State>[];
}

export interface Design extends DesignData<Expression> {}
type ResolveFunction<F> = F extends GeoFunction<number, "resolved"> ? F & Required<Omit<F, "seed">> : never;
export type ResolvedFunction = ResolveFunction<GeoFunction<number, "resolved">>;
export type ResolvedGeoNode = Omit<GeoNode<number, "resolved">, "function"> & { function: ResolvedFunction };
export type ResolvedDesign = Omit<DesignData<number, "resolved">, "geoNodes" | "marks"> & { geoNodes: ResolvedGeoNode[]; marks: Required<Mark<number, "resolved">>[] };