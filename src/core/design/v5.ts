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
export interface CurveRef<N = Expression> { ref: string; offset?: Point; h?: Record<string, N> }
export interface SharedCurve { label: string; curve: Curve<never> }
export type CurveValue<N = Expression, Ref = CurveRef<N>> = Curve<N> | Ref;
type ClosedValue<Ref> = ClosedCurve | (Ref & CurveRef<never>);
export interface Strip<N = Expression> {
    type: "strip";
    of: [string] | [string, string];
    widths: [N, N];
    range?: { from: string; to: string };
}
export type Construction<N = Expression, Ref = CurveRef<N>> = { type: "outline"; outlines: ClosedValue<Ref>[] } | Strip<N>;
export interface Ridge<N, Ref = CurveRef<N>> { line: CurveValue<N, Ref>; slope: N }
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

export type GeoFunction<N = Expression, Ref = CurveRef<N>> = (
    { type: "ground"; value: N } |
    { type: "flat"; amount: Expression; feather?: N } |
    { type: "coast"; shore: ClosedValue<Ref>; roughness: Expression; harbor: { center: Point; span: N; radius: N } } |
    { type: "mountain"; ridges: Ridge<N, Ref>[]; peaks: Peak<N>[]; floor?: N; crestRound?: N; footRound?: N; blend?: N } |
    { type: "cliff"; factor: Expression; seaLevel?: N } |
    ({ type: "erosion"; strength?: Expression; floor?: N; spacing?: N } & NumericProperties<Erosion, N>) |
    { type: "islets"; density: Expression; reach: N; threshold?: N; seaLevel?: N } |
    { type: "slope"; kind: "path"; line: CurveValue<N, Ref>; ease?: boolean } |
    { type: "slope"; kind: "radial"; center: Point; radius: N; value: N; rate: N } |
    { type: "noise"; amplitude: Expression; scale: N; octaves?: N; feather?: N; warp?: N; warpScale?: N; carve?: N } |
    { type: "blend" | "split" } |
    { type: "batter"; grade: N }
) & { seed?: N };
export interface GeoNode<N = Expression, Ref = CurveRef<N>> extends MapLabel {
    disabled?: true;
    prompt?: string;
    field: string;
    construction: Construction<N, Ref>;
    function: GeoFunction<N, Ref>;
    fill?: string;
    outline?: boolean;
}
export interface FieldDeclaration { label: string; unit?: string; precision?: number }
export interface DesignData<N, Ref = CurveRef<N>> {
    version: 5;
    prompt?: string;
    grid: { step: number };
    inputs: Record<string, CustomInput<N>>;
    fields: Record<string, FieldDeclaration>;
    curves: Record<string, SharedCurve>;
    geoNodes: GeoNode<N, Ref>[];
    sections: Section[];
    marks: Mark<N>[];
}

export interface Design extends DesignData<Expression> {}
type ResolveFunction<F> = F extends GeoFunction<number, never> ? F & Required<Omit<F, "seed" | "ease">> : never;
export type ResolvedFunction = ResolveFunction<GeoFunction<number, never>>;
export type ResolvedGeoNode = Omit<GeoNode<number, never>, "function"> & { function: ResolvedFunction };
export type ResolvedDesign = Omit<DesignData<number, never>, "geoNodes" | "marks"> & { geoNodes: ResolvedGeoNode[]; marks: Required<Mark<number>>[] };