import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { type ImportDesign } from "../src/core/design/migrations/legacy.ts";
import { type Design, type Edge, type Point, type RoadClass } from "../src/core/design/types.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { createGrid } from "../src/core/math/geometry.ts";
import { profile } from "../src/core/roads/profiles.ts";

export async function referenceDesign() {
    return parseDesign(await readFixture("round4.json"));
}

export function branchJunction(design: Design) {
    const junction = design.nodes.find(n => n.through && design.edges.some(e =>
        e.from === n.id && !n.through!.includes(e.id) && e.via.length > 0));
    assert(junction, "Expected a through junction with an outgoing multi-span branch");
    return junction;
}

export async function oldStreet() {
    const street: unknown = JSON.parse(await readFixture("street-v1.json"));
    assert(Array.isArray(street) && street.every((p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));
    return street;
}

// Validate a copy before replaying the v3 fixture with its original woodland fields.
export function originalWoodland(text: string): ImportDesign {
    const source: unknown = JSON.parse(text);
    function isWoodland(value: unknown): value is ImportDesign {
        return typeof value === "object" && value !== null && "version" in value && value.version === 3 && parseDesign(value).version === 4;
    }
    assert(isWoodland(source));
    return source;
}

// A small square island with one building, one road and a level platform.
export function syntheticDesign(): Design {
    const rule: RoadClass = { name: "A", width: 2, comfort: .12, maxGrade: .45, corridor: 14,
        rampLimit: .16, allowStairs: true, stairLimit: .68, enter: .2, exit: .12, minRun: 3,
        keep: .26, shoulder: 2, minRadius: 4, cornerRadius: 2 };
    return {
        version: 4, seed: 31, grid: { xMin: -48, xMax: 48, yMin: -48, yMax: 48, step: 1 },
        levels: { A: 7 }, levelControls: { A: ["A", 1, 14, 1] },
        coast: { points: [[-36, -36], [36, -36], [36, 36], [-36, 36]], smooth: 1, rockiness: [],
            harbor: { center: [0, 0], radius: 80, span: 9 } },
        peaks: [], ridges: [], zones: [{ id: "Z", name: "Z", priority: 1, height: { level: "A" },
            shape: { type: "ellipse", center: [-14, -8], radii: [7, 5], samples: 32 } }],
        buildings: [{ id: "A", name: "A", shape: "rect", center: [-14, -8], size: [6, 4], angle: 0,
            height: 3, color: "gray", doors: [{ id: "D", wall: 0, t: .5 }] }], yards: [],
        nodes: [{ id: "a", name: "A", type: "endpoint", point: [-10, 21] }, { id: "b", name: "B", type: "endpoint", point: [14, 21] }],
        edges: [{ id: "E", name: "E", from: "a", to: "b", via: [], grade: "stair", width: 2,
            comfort: .24, maxGrade: .68, corridor: 14 }],
        roadClasses: { path: { ...rule }, stair: { ...rule, maxGrade: .68, minRadius: 2, rampLimit: null },
            street: { ...rule, minRadius: 7, allowStairs: false, rampLimit: .09 } },
        routing: { viaTolerance: 1, landing: 3, turnCost: 2, overGradePenalty: 32, minHeight: .5, relaxPasses: 32,
            sampleStep: 1, profilePasses: 1, profileRadius: 1, gradeWindow: 3, roadBedExtra: .2,
            detourLimit: 2, clearance: 1, overlapLength: 3, junctionRadius: 4 },
        erosion: { droplets: 30, inertia: .2, capacity: 2, minCapacity: .04, deposition: .2, erosion: .2,
            evaporation: .05, gravity: 3, lifetime: 14, radius: 2 },
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
    const flat = { grid, heights: new Float32Array(grid.size).fill(5), buildings: [], zones: [] };
    const road = (id: string, from: string, to: string, pts: Point[], extra: Partial<Edge> = {}) => profile(synthetic, flat, {
        id,
        edge: { ...synthetic.edges[0], id, name: id, from, to, width: 2, grade: "path", ...extra },
        points: pts,
        controls: [pts[0], pts.at(-1)!],
        parts: []
    });
    return { synthetic, grid, flat, road };
}