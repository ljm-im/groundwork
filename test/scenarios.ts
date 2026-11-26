import assert from "node:assert/strict";
import { type CurveRef, type ClosedCurve, type Construction, type Curve, type Design, type Expression, type Held, type GeoFunction, type GeoNode, type Point, type ResolvedDesign } from "../src/core/design/v5.ts";
import { defaultInputRange, heightId, reserved } from "../src/core/design/defaults.ts";

export function polygon(points: Point[]): ClosedCurve {
    return { closed: true, nodes: points.map((p, i) => ({ id: String(i), p, mode: "corner" })) };
}
export function openCurve<N extends Expression>(points: { p: Point; h?: N }[], mode: "corner" | "auto" = "corner", prefix = "node-"): Curve<N> {
    return { closed: false, nodes: points.map((v, i) => ({ id: prefix + i, ...v, mode })) };
}
export function literalCurve<C extends Curve>(value: C | CurveRef | Held<C | CurveRef>): C {
    const curve = "curve" in value ? value.curve : value;
    assert("nodes" in curve);
    return curve;
}
export function rect(x0: number, y0: number, x1: number, y1: number) {
    return { type: "outline" as const, outlines: [{ curve: polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) }] };
}

export function resolvedRect(x0: number, y0: number, x1: number, y1: number) {
    const { type, outlines } = rect(x0, y0, x1, y1);
    return { type, outlines: outlines.map(item => item.curve) };
}
export function layer(id: string, construction: Construction, fn: GeoFunction, field = heightId): GeoNode {
    return { id, label: id, construction, function: fn, field };
}
export function overlappingLandforms(): Design {
    const design = syntheticDesign();
    const upper = rect(-20, -15, 16, 6), island = rect(20, -9, 24, -5).outlines[0];
    for (const node of island.curve.nodes) node.id = "island-" + node.id;
    upper.outlines.push(island);
    design.geoNodes.push(
        layer("A", rect(-16, -10, 12, 10), {
            type: "mountain", peaks: [],
            ridges: [[[-10, 0], [4, 0]], [[-12, 10], [8, 10]]].map((points, i) => ({
                curve: openCurve((points as Point[]).map(p => ({ p, h: 8 })), "corner", "ridge-" + i + "-"),
                slope: 2
            }))
        }),
        layer("B", upper, { type: "flat", amount: 2 })
    );
    return design;
}

export const coveredLandformPoints: Point[] = [[0, -5], [-1, -10], [-16, -10], [-3, 0]];

export const erosion = { type: "erosion" as const, droplets: 300, inertia: .2, capacity: 2, minCapacity: .04, deposition: .2,
    erosion: .2, evaporation: .05, gravity: 3, lifetime: 14, radius: 2 };

type SampleDesign = Pick<Design, "geoNodes" | "marks"> & Omit<ResolvedDesign, "geoNodes" | "marks">;
export function syntheticDesign(): SampleDesign {
    return {
        version: 5, grid: { step: 1 }, fields: structuredClone(reserved.field), curves: {}, inputs: { seed: { label: "种子", value: 31, range: defaultInputRange("seed") }, A: { value: 7, range: [1, 14, 1] } },
        geoNodes: [layer("G", rect(-48, -48, 48, 48), { type: "ground", value: 4 }),
            layer("T", rect(-21, -14, -7, -2), { type: "flat", amount: "{input:A} - 4" })],
        sections: [], marks: []
    };
}