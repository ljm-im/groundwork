import { type ClosedCurve, type Construction, type Curve, type Design, type Expression, type GeoFunction, type GeoNode, type Point, type ResolvedDesign } from "../src/core/design/v5.ts";
import { defaultInputRange, heightId, reserved } from "../src/core/design/defaults.ts";

export function polygon(points: Point[]): ClosedCurve {
    return { closed: true, nodes: points.map((p, i) => ({ id: String(i), p, mode: "corner" })) };
}
export function openCurve<N extends Expression>(points: { p: Point; h?: N }[], mode: "corner" | "auto" = "corner", prefix = "node-"): Curve<N> {
    return { closed: false, nodes: points.map((v, i) => ({ id: prefix + i, ...v, mode })) };
}
export function rect(x0: number, y0: number, x1: number, y1: number): Construction & { type: "free" } {
    return { type: "free", paths: [polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])] };
}
export function layer(id: string, construction: Construction, fn: GeoFunction, field = heightId): GeoNode {
    return { id, label: id, construction, function: fn, field };
}
export const erosion = { type: "erosion" as const, droplets: 300, inertia: .2, capacity: 2, minCapacity: .04, deposition: .2,
    erosion: .2, evaporation: .05, gravity: 3, lifetime: 14, radius: 2 };

type SampleDesign = Pick<Design, "geoNodes" | "marks"> & Omit<ResolvedDesign, "geoNodes" | "marks">;
export function syntheticDesign(): SampleDesign {
    return {
        version: 5, grid: { step: 1 }, fields: structuredClone(reserved.field), inputs: { seed: { label: "种子", value: 31, range: defaultInputRange("seed") }, A: { value: 7, range: [1, 14, 1] } },
        geoNodes: [layer("G", rect(-48, -48, 48, 48), { type: "ground", value: 4 }),
            layer("T", rect(-21, -14, -7, -2), { type: "flat", amount: "{input:A} - 4" })],
        sections: [], marks: []
    };
}