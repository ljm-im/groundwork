import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseDesign } from "../src/core/design/model.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { canvasFrame, createGrid, polygonField, type Grid, type GridFrame, type Point } from "../src/core/math/geometry.ts";
import { random } from "../src/core/math/noise.ts";
import { applyLayer, evaluateLayer } from "../src/core/terrain/functions.ts";
import { shoreDistance, shoreFrame } from "../src/core/terrain/shore.ts";
import { initialFields, layout } from "../src/core/terrain/terrain.ts";
import { layer, rect, syntheticDesign } from "./scenarios.ts";

function canvasIndex(grid: Grid, frame: GridFrame, at: number) {
    return (frame.top + Math.floor(at / frame.width)) * grid.width + frame.left + at % frame.width;
}

test("Shore distance crops preserve nearby values through holes and along canvas edges", () => {
    const step = .375, grid = createGrid({ xMin: -8.25, xMax: 10.875, yMin: -9, yMax: 4.875, step });
    const boxes: GridFrame[] = [
        { left: 0, top: 8, width: 5, height: 9 },
        { left: 46, top: 0, width: 5, height: 5 },
        { left: 17, top: 13, width: 9, height: 8 },
        { left: 24, top: 26, width: 7, height: 11 },
        canvasFrame(grid)
    ];
    const defined = Uint8Array.from({ length: grid.size }, (_, k) => {
        const i = k % grid.width, j = Math.floor(k / grid.width);
        return +(!(i >= 9 && i <= 16 && j > 2 && j < 12) && !(i >= 26 && i <= 35 && j > 20 && j < 32));
    });
    const distance = 3.5 * step, padding = Math.ceil(distance / step) + 2;
    let near = 0, far = 0;
    for (const seed of [33, 77, 134]) {
        const next = random(seed), land = Uint8Array.from({ length: grid.size }, (_, k) => {
            const i = k % grid.width;
            return i < 11 ? 0 : i > 40 ? 1 : +(next() > .53);
        });
        const full = shoreDistance(canvasFrame(grid), step, land, defined);
        for (const box of boxes) {
            const frame = shoreFrame(grid, box, distance);
            const copy = (field: Uint8Array) => Uint8Array.from({ length: frame.width * frame.height },
                (_, at) => field[canvasIndex(grid, frame, at)]);
            const local = shoreDistance(frame, step, copy(land), copy(defined));
            for (let j = box.top; j < box.top + box.height; j++) for (let i = box.left; i < box.left + box.width; i++) {
                const expected = full[j * grid.width + i], actual = local[(j - frame.top) * frame.width + i - frame.left];
                if (Math.abs(expected) < padding * step) {
                    assert.equal(actual, expected, [seed, i, j].join(","));
                    near++;
                }
                else {
                    assert(Math.abs(expected) >= distance && Math.abs(actual) >= distance);
                    far++;
                }
            }
        }
    }
    assert(near && far);
});

test("Shore cropping keeps the canvas when Float32 accumulation can exhaust the padding", () => {
    const step = .1, seed = 20000, grid = createGrid({ xMin: 0, xMax: (seed + 10) * step, yMin: 0, yMax: step, step });
    const distance = (seed - 3.25) * step, box = { left: 0, top: 0, width: 1, height: 1 };
    const land = new Uint8Array(grid.size).fill(1), defined = new Uint8Array(grid.size).fill(1);
    land[seed] = 0;
    assert(1 + Math.ceil(distance / step) + 2 <= seed);
    assert(shoreDistance(canvasFrame(grid), step, land, defined)[0] < distance);
    assert.deepEqual(shoreFrame(grid, box, distance), canvasFrame(grid));
});

test("Polygon fields keep identical signed distances in clipped frames", () => {
    const step = .3, grid = createGrid({ xMin: -9.12, xMax: 9.78, yMin: -9.02, yMax: 8.08, step });
    const frame = { left: 21, top: 17, width: 18, height: 14 };
    const polygons: Point[][] = [
        [[-5, -2], [.6, -3], [1.4, 2.4], [-.8, 4], [-4, 2]],
        [[4, -1], [7, -1], [7, 2], [4, 2]],
        [[-7, -7], [7, -7], [7, 7], [-7, 7]]
    ];
    for (const polygon of polygons) for (const reach of [0, 2.7]) {
        const full = polygonField(grid, polygon, reach);
        const expected = Float32Array.from({ length: frame.width * frame.height }, (_, at) => full[canvasIndex(grid, frame, at)]);
        assert.deepEqual(polygonField(grid, polygon, reach, frame), expected);
    }
});

test("Cropped coast, cliff and islets match the full-canvas stack bit for bit", () => {
    const design = syntheticDesign(), canvas = rect(-169, -106, 169, 106);
    design.fields.B = { label: "B" };
    design.geoNodes = [
        layer("A", canvas, { type: "ground", value: -2 }),
        layer("B", canvas, { type: "ground", value: 1 }, "B"),
        layer("H", rect(-3, -3, 3, 3), { type: "ground", value: 4 }, "B")
    ];
    const islands: Point[] = [[-123, -62], [0, 62], [123, -48]];
    for (const [i, [x, y]] of islands.entries()) {
        const region = rect(x - 14, y - 14, x + 14, y + 14);
        const inner = rect(x - 8, y - 8, x + 8, y + 8);
        const path = inner.outlines[0], shore = { ...path, nodes: path.nodes.map(node => ({ ...node, id: "shore-" + node.id })) };
        design.geoNodes.push(
            layer("G" + i, inner, { type: "ground", value: 5 + i }),
            layer("N" + i, rect(x - 13, y - 13, x - 3, y + 13), { type: "ground", value: 0 }, "B"),
            layer("P" + i, rect(x + 3, y - 13, x + 13, y + 13), { type: "ground", value: 2 }, "B"),
            layer("C" + i, region, { type: "coast", shore, roughness: "{field:B} * 3",
                harbor: { center: [x, y], radius: 2, span: 4 }, seed: 23 + i }),
            layer("L" + i, rect(x - 6, y - 2, x + 6, y), { type: "ground", value: .25 }),
            layer("D" + i, region, { type: "cliff", factor: "{field:B} - 1", seaLevel: .1, seed: 31 + i }),
            layer("I" + i, region, { type: "islets", reach: 8 + i, density: .85, threshold: .1, seed: 41 + i })
        );
    }
    const resolved = resolveDesign(parseDesign(design)), { grid, regions } = layout(resolved);
    const factors = new Set<number>(), framed = new Set<string>();
    let lowLand = false;
    function run(frameFor: typeof shoreFrame, cropped: boolean) {
        const state = initialFields(resolved, grid);
        for (const node of resolved.geoNodes) {
            const region = regions.get(node.id)!;
            if (node.function.type === "cliff") for (const k of region.cells) {
                const height = state.fields.height.values[k];
                if (height > .1) {
                    factors.add(Math.sign(state.fields.B.values[k] - 1));
                    if (height < .4) lowLand = true;
                }
            }
            const output = evaluateLayer(node, region, state, (g, r, d) => {
                const frame = frameFor(g, r, d);
                if (cropped && frame.width * frame.height < grid.size) framed.add(node.id);
                return frame;
            });
            applyLayer(output, node, state);
        }
        const digest = (field: Float32Array | Uint8Array) => createHash("sha256").update(field).digest("hex");
        return Object.fromEntries(Object.entries(state.fields).map(([id, field]) => [id, [digest(field.values), digest(field.defined)]]));
    }
    assert.deepEqual(run(shoreFrame, true), run(canvasFrame, false));
    assert.equal(framed.size, 3 * islands.length);
    assert.deepEqual([...factors].sort((a, b) => a - b), [-1, 0, 1]);
    assert(lowLand);
});