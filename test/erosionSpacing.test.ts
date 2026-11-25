import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { parameters, resolveDesign } from "../src/core/design/parameters.ts";
import { defaultFunction } from "../src/core/edit/geoNodes.ts";
import { createGrid, sample } from "../src/core/math/geometry.ts";
import { erode, erodeAtSpacing } from "../src/core/terrain/erosion.ts";
import { erosion, layer, syntheticDesign } from "./scenarios.ts";

const grid = createGrid({ xMin: 4, xMax: 33, yMin: -20, yMax: 11, step: 1 });
const cells = Int32Array.from({ length: grid.size }, (_, k) => k);
const heights = Float32Array.from(cells, k => {
    const [x, y] = grid.point(k);
    return 5 + x * .32 + Math.sin(y / 3);
});
const eligible = Uint8Array.from(cells, k => +(k % grid.width !== 5 || k < 11 * grid.width));
const config = { ...erosion, radius: 1.25, droplets: 900 }, seed = 84;

test("Erosion at or below the sampling interval uses the original changes bit for bit", () => {
    const expected = erode(grid, eligible, heights, config, seed);
    assert(expected.some(v => v !== 0));
    for (const spacing of [.25, 1]) {
        const delta = erodeAtSpacing(grid, eligible, heights, { ...config, spacing }, seed, cells);
        assert.deepEqual(Float32Array.from(cells, k => delta(k, ...grid.point(k))), expected);
    }
});

test("Coarse erosion averages partial blocks and interpolates changes only onto eligible cells", () => {
    for (const spacing of [2, 3]) {
        const width = Math.ceil(grid.width / spacing), height = Math.ceil(grid.height / spacing);
        const coarse = createGrid({ xMin: grid.xMin, xMax: grid.xMin + width * spacing,
            yMin: grid.yMax - height * spacing, yMax: grid.yMax, step: spacing });
        const mask = new Uint8Array(coarse.size), mean = new Float32Array(coarse.size);
        for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
            let sum = 0, count = 0;
            for (let y = j * spacing; y < Math.min((j + 1) * spacing, grid.height); y++)
                for (let x = i * spacing; x < Math.min((i + 1) * spacing, grid.width); x++) {
                    const k = y * grid.width + x;
                    if (eligible[k]) {
                        sum += heights[k]; count++;
                    }
                }
            if (count) {
                const k = j * width + i;
                mask[k] = 1; mean[k] = sum / count;
            }
        }
        const raw = erode(coarse, mask, mean, config, seed);
        assert(raw.some(v => v !== 0));
        const fn = { ...config, spacing }, a = erodeAtSpacing(grid, eligible, heights, fn, seed, cells);
        const b = erodeAtSpacing(grid, eligible, heights, fn, seed, cells);
        for (const k of cells) {
            const [x, y] = grid.point(k), expected = eligible[k] ? sample(coarse, raw, x, y) : 0;
            assert.equal(a(k, x, y), expected);
            assert.equal(b(k, x, y), expected);
        }
    }
});

test("Erosion spacing defaults to half its own radius and supports an authored number or expression", () => {
    const design = syntheticDesign(), fn = defaultFunction("erosion");
    assert(fn.type === "erosion");
    design.geoNodes.push(layer("E", design.geoNodes[0].construction, fn));
    assert.equal(parameters(design).get("geo:E.spacing")?.value, "{geo:E.radius} / 2");
    assert.equal(Object.hasOwn(fn, "spacing"), false);
    const spacing = () => {
        const result = resolveDesign(parseDesign(design)).geoNodes.at(-1)!.function;
        assert(result.type === "erosion");
        return result.spacing;
    };
    assert.equal(spacing(), 1);
    fn.radius = 6;
    assert.equal(spacing(), 3);
    assert(!serializeDesign(parseDesign(design)).includes("\"spacing\""));
    fn.spacing = .4;
    fn.radius = 8;
    assert.equal(spacing(), .4);
    fn.spacing = "{input:A} / 2";
    assert.equal(spacing(), 3.5);
    fn.spacing = 0;
    assert.throws(spacing, /spacing/);
});