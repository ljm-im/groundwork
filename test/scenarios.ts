import assert from "node:assert/strict";
import { type ClosedCurve, type Construction, type Curve, type Design, type Expression, type GeoFunction, type GeoNode,
    type Held, type Mark, type NodeQuantity, type NodeRecords, type Point, type PointHolder, type ProfileCurve, type ProfileNode,
    type ResolvedDesign, type ScaleMark, type Section, type TextMark } from "../src/core/design/v5.ts";
import { defaultInputRange, heightId, reserved } from "../src/core/design/defaults.ts";
import { geometryAt } from "../src/core/design/curveReferences.ts";
import { writeCurveProfile } from "../src/core/design/polyline.ts";
import { addGeometry, holdPoint } from "../src/core/edit/geoNodes.ts";

export function polygon(points: Point[]): ClosedCurve {
    return { closed: true, nodes: points.map((p, i) => ({ id: String(i), p, mode: "corner" })) };
}
export function openCurve<N extends Expression>(points: Pick<ProfileNode<N>, "p" | "h" | "slope" | "interpolate">[],
    mode: "corner" | "auto" = "corner", prefix = "node-"): ProfileCurve<N> {
    return { closed: false, nodes: points.map((v, i) => ({ id: prefix + i, ...v, mode })) };
}
export function withNodeSlope<N extends Expression, S extends Expression>(curve: ProfileCurve<N>, slope: S): ProfileCurve<N | S> {
    return { ...curve, nodes: curve.nodes.map(node => ({ ...node, slope })) };
}

export function literalCurve(d: Design, value: Held | string): Curve {
    const id = typeof value === "string" ? value : "curve" in value ? value.curve : "";
    const item = geometryAt(d, id);
    assert(item && "curve" in item);
    return item.curve;
}

export function rect(x0: number, y0: number, x1: number, y1: number) {
    return { type: "outline" as const, outlines: [{ curve: polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) }] };
}

export function resolvedRect(x0: number, y0: number, x1: number, y1: number) {
    const { type, outlines } = rect(x0, y0, x1, y1);
    return { type, outlines: outlines.map(item => item.curve) };
}

type CurveTemplate<C extends Curve> = Held<NodeRecords & { ease?: boolean }> | { curve: C; offset?: Point; ease?: boolean };
type FixturePosition = Point | PointHolder;
type FixtureConstruction = Extract<Construction, { type: "strip" }> | { type: "outline"; outlines: CurveTemplate<ClosedCurve>[] };
type Mountain = Extract<GeoFunction, { type: "mountain" }>;
type Slope = Extract<GeoFunction, { type: "slope" }>;
type Coast = Extract<GeoFunction, { type: "coast" }>;
type FixturePeak = Omit<Mountain["peaks"][number], "at"> & { at: FixturePosition };
export type FixtureFunction = Exclude<GeoFunction, { type: "mountain" | "slope" | "coast" }> |
    Omit<Mountain, "ridges" | "valleys" | "peaks"> & { ridges: CurveTemplate<ProfileCurve>[]; valleys: CurveTemplate<ProfileCurve>[]; peaks: FixturePeak[] } |
    Omit<Slope, "center" | "lines"> & { center: FixturePosition; lines: CurveTemplate<ProfileCurve>[] } |
    Omit<Coast, "shore" | "harbor"> & { shore: CurveTemplate<ClosedCurve>; harbor: Omit<Coast["harbor"], "center"> & { center: FixturePosition } };
export type FixtureLayer = Omit<GeoNode, "construction" | "function"> & { construction: FixtureConstruction; function: FixtureFunction };

export function fixtureCurve(d: Design, value: CurveTemplate<Curve>, quantities: readonly NodeQuantity[] = []): Held<NodeRecords & { ease?: boolean }> {
    if ("ref" in value || typeof value.curve === "string") return structuredClone(value) as Held<NodeRecords & { ease?: boolean }>;
    const { curve, ...holder } = value, profile: ProfileCurve = curve as Curve, values: NodeRecords = {};
    const nodes = structuredClone(profile.nodes).map(node => {
        const shape = { ...node };
        delete shape.h;
        delete shape.slope;
        delete shape.interpolate;
        return shape;
    });
    if (quantities.length) writeCurveProfile(values, profile, quantities.filter(q => profile.nodes.some(n => n[q] !== undefined)));
    return { ...holder, ...values, curve: addGeometry(d, { curve: { closed: profile.closed, nodes } }) };
}

export function fixtureConstruction(d: Design, c: FixtureConstruction): Construction {
    return c.type === "strip" ? structuredClone(c) : { type: "outline", outlines: c.outlines.map(curve => fixtureCurve(d, curve)) };
}

export function fixtureFunction(d: Design, value: FixtureFunction): GeoFunction {
    const f = structuredClone(value);
    const point = (at: FixturePosition) => Array.isArray(at) ? holdPoint(d, at) : at;
    if (f.type === "coast")
        return { ...f, shore: fixtureCurve(d, f.shore), harbor: { ...f.harbor, center: point(f.harbor.center) } };
    if (f.type === "slope")
        return { ...f, center: point(f.center), lines: f.lines.map(curve => fixtureCurve(d, curve, ["h"])) };
    if (f.type === "mountain") {
        const profile = (curve: CurveTemplate<ProfileCurve>) => fixtureCurve(d, curve, ["h", "slope"]);
        return { ...f, ridges: f.ridges.map(profile), valleys: f.valleys.map(profile), peaks: f.peaks.map(peak => ({ ...peak, at: point(peak.at) })) };
    }
    return f;
}

export function layer(id: string, construction: FixtureConstruction, fn: FixtureFunction, field = heightId): FixtureLayer {
    return { id, label: id, construction, function: fn, field };
}

export function placeLayer(d: Design, n: FixtureLayer): GeoNode {
    return { ...n, construction: fixtureConstruction(d, n.construction), function: fixtureFunction(d, n.function) };
}

export function addLayer(d: Design, ...args: Parameters<typeof layer>): GeoNode {
    return placeLayer(d, layer(...args));
}

export function fixtureSection(d: Design, section: Omit<Section<"resolved">, "points"> & { points: [Point, Point] }): Section {
    return { ...section, points: [holdPoint(d, section.points[0]), holdPoint(d, section.points[1])] };
}

type FixtureMark = (Omit<TextMark, "point" | "screen"> | Omit<ScaleMark, "point" | "screen">) & { point: Point; screen?: Point };
export function fixtureMark(d: Design, mark: FixtureMark): Mark {
    return { ...mark, screen: mark.screen ?? (mark.follow === "screen" ? mark.point : [0, 0]),
        point: holdPoint(d, mark.follow === "map" ? mark.point : [0, 0]) };
}

export function overlappingLandforms(): Design {
    const d = syntheticDesign();
    const upper = rect(-20, -15, 16, 6), island = rect(20, -9, 24, -5).outlines[0];
    for (const node of island.curve.nodes) node.id = "island-" + node.id;
    upper.outlines.push(island);
    d.geoNodes.push(
        addLayer(d, "A", rect(-16, -10, 12, 10), {
            type: "mountain", valleys: [], peaks: [],
            ridges: [[[-10, 0], [4, 0]], [[-12, 10], [8, 10]]].map((points, i) => ({
                curve: withNodeSlope(openCurve((points as Point[]).map(p => ({ p, h: 8 })), "corner", "ridge-" + i + "-"), 2)
            }))
        }),
        addLayer(d, "B", upper, { type: "flat", amount: 2 })
    );
    return d;
}

export const coveredLandformPoints: Point[] = [[0, -5], [-1, -10], [-16, -10], [-3, 0]];

export const erosion = { type: "erosion" as const, droplets: 300, inertia: .2, capacity: 2, minCapacity: .04, deposition: .2,
    erosion: .2, evaporation: .05, gravity: 3, lifetime: 14, radius: 2, spacing: 1 };

type SampleDesign = Omit<Design, "inputs"> & Pick<ResolvedDesign, "inputs">;
export function syntheticDesign(layers: "default" | "ground" | "empty" = "default"): SampleDesign {
    const d: SampleDesign = {
        version: 5, grid: { step: 1 }, fields: structuredClone(reserved.field), geometry: {},
        inputs: { seed: { label: "种子", value: 31, range: defaultInputRange("seed") }, A: { value: 7, range: [1, 14, 1] } },
        geoNodes: [], sections: [], marks: []
    };
    if (layers !== "empty") d.geoNodes.push(addLayer(d, "G", rect(-48, -48, 48, 48), { type: "ground", value: 4 }));
    if (layers === "default") d.geoNodes.push(addLayer(d, "T", rect(-21, -14, -7, -2), { type: "flat", amount: "{input:A} - 4" }));
    return d;
}