import { type Construction, type Design, type Edge, type GeoFunction, type GeoNode, type Path, type Point, type RoadClass, type ResolvedDesign } from "../src/core/design/v5.ts";
import { createGrid } from "../src/core/math/geometry.ts";
import { profile } from "../src/core/roads/profiles.ts";

export function polygon(points: Point[]): Path {
    return { closed: true, nodes: points.map((p, i) => ({ id: String(i), p, mode: "corner", next: "line" })) };
}
export function rect(x0: number, y0: number, x1: number, y1: number): Construction & { type: "free" } {
    return { type: "free", paths: [polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])] };
}
export function layer(id: string, construction: Construction, fn: GeoFunction, field?: string): GeoNode {
    return { id, name: id, construction, function: fn, ...(field && { field }) };
}
export const erosion = { type: "erosion" as const, droplets: 300, inertia: .2, capacity: 2, minCapacity: .04, deposition: .2,
    erosion: .2, evaporation: .05, gravity: 3, lifetime: 14, radius: 2 };

type SampleDesign = Pick<Design, "geoNodes"> & Omit<ResolvedDesign, "geoNodes">;
export function syntheticDesign(): SampleDesign {
    const rule: RoadClass = { name: "A", width: 2, comfort: .12, maxGrade: .45, corridor: 14,
        rampLimit: .16, allowStairs: true, stairLimit: .68, enter: .2, exit: .12, minRun: 3,
        keep: .26, shoulder: 2, minRadius: 4, cornerRadius: 2 };
    return {
        version: 5, grid: { step: 1 }, fields: {}, variables: { seed: { value: 31 }, A: { value: 7, range: [1, 14, 1] } },
        geoNodes: [layer("G", rect(-48, -48, 48, 48), { type: "ground", value: 4 }),
            layer("T", rect(-21, -14, -7, -2), { type: "flat", value: "{var:A}" })],
        buildings: [{ id: "A", name: "A", shape: "rect", center: [-14, -8], size: [6, 4], angle: 0,
            height: 3, color: "gray", doors: [{ id: "D", wall: 0, t: .5 }] }],
        nodes: [{ id: "a", name: "A", type: "endpoint", point: [-10, 21] }, { id: "b", name: "B", type: "endpoint", point: [14, 21] }],
        edges: [{ id: "E", name: "E", from: "a", to: "b", via: [], grade: "stair", width: 2,
            comfort: .24, maxGrade: .68, corridor: 14 }],
        roadClasses: { path: { ...rule }, stair: { ...rule, maxGrade: .68, minRadius: 2, rampLimit: null },
            street: { ...rule, minRadius: 7, allowStairs: false, rampLimit: .09 } },
        routing: { viaTolerance: 1, landing: 3, turnCost: 2, overGradePenalty: 32, minHeight: .5, relaxPasses: 32,
            sampleStep: 1, profilePasses: 1, profileRadius: 1, gradeWindow: 3, roadBedExtra: .2,
            detourLimit: 2, clearance: 1, overlapLength: 3, junctionRadius: 4 },
        vegetation: { density: { natural: .28 }, rooms: [], yardTree: { center: [-14, -8], radius: 1 },
            plantings: [], clearings: [] }, sections: [], labels: []
    };
}

export function syntheticRoads() {
    const synthetic = syntheticDesign();
    synthetic.nodes = ["a", "b", "c", "d"].map((id, i) => ({ id, name: id, type: "junction", point: [
        [0, 0],
        [20, 0],
        [0, 2],
        [20, 2]
    ][i] as Point }));
    const grid = createGrid({ xMin: -10, xMax: 35, yMin: -10, yMax: 20, step: 1 });
    const flat = { grid, heights: new Float32Array(grid.size).fill(5), buildings: [], defined: new Uint8Array(grid.size).fill(1) };
    const road = (id: string, from: string, to: string, pts: Point[], extra: Partial<Edge> = {}) => profile(synthetic, flat, {
        id,
        edge: { ...synthetic.edges[0], id, name: id, from, to, width: 2, grade: "path", ...extra },
        points: pts,
        controls: [pts[0], pts.at(-1)!],
        parts: []
    });
    return { synthetic, grid, flat, road };
}

export function junctionDesign(): SampleDesign {
    const d = syntheticDesign();
    d.geoNodes = d.geoNodes.slice(0, 1);
    const west = d.buildings[0];
    west.center = [25, 10]; west.doors[0].wall = 3;
    const points: Point[] = [[-21, 10], [0, 10], [0, -20]];
    d.nodes = points.map((point, i) => ({ id: String(i), name: String(i), type: "endpoint", point }));
    d.nodes[1].type = "junction"; d.nodes[1].through = ["A", "B"];
    d.nodes.push({ id: "D", name: "D", type: "door", building: west.id, door: west.doors[0].id });
    const edge = { ...d.edges[0], grade: "path", mode: "smooth" as const };
    d.edges = [{ ...edge, id: "A", from: "0", to: "1" }, { ...edge, id: "B", from: "1", to: "D" },
        { ...edge, id: "C", from: "1", to: "2", via: [[0, -5]] }];
    return d;
}
export function branchJunction(d: Design) {
    return d.nodes.find(n => n.through)!;
}