import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { type Edge, type Point } from "../src/core/design/types.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { createGrid } from "../src/core/math/geometry.ts";
import { profile } from "../src/core/roads/profiles.ts";

export const referenceText = serializeDesign(parseDesign(await readFixture("round4.json")));

export async function oldStreet() {
    const street: unknown = JSON.parse(await readFixture("street-v1.json"));
    assert(Array.isArray(street) && street.every((p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));
    return street;
}

export function syntheticRoads() {
    const synthetic = parseDesign(referenceText);
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