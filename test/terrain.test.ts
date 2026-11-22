import { test } from "node:test";
import assert from "node:assert/strict";
import { type Point, type Design } from "../src/core/design/types.ts";
import { fixtureOptions, readFixture, readRegressions } from "../configs/read-fixture.ts";
import { distance, sample } from "../src/core/math/geometry.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { routeAll } from "../src/core/roads/routing.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { createHash } from "node:crypto";
import { referenceDesign, originalWoodland, syntheticDesign } from "./scenarios.ts";

test("A seed reproduces terrain and graded heights", () => {
    const design = syntheticDesign();
    const model = new Island(design);
    const again = new Island(syntheticDesign());
    assert.deepEqual(model.terrain.heights, again.terrain.heights);
    assert.deepEqual(model.graded.heights, again.graded.heights);
    const changed = structuredClone(design);
    changed.seed++;
    assert.notDeepEqual(generateTerrain(changed).heights, model.terrain.heights);
});

test("Half-metre grid, routing and eastern shoreline", fixtureOptions("round4.json", "regressions.json"), async () => {
    const again = new Island(await referenceDesign());
    const design = again.design;
    const half = structuredClone(design);
    half.grid.step = .5;
    const fine = generateTerrain(half);
    assert.equal(fine.grid.size, 4 * again.terrain.grid.size);
    assert(fine.heights.every(Number.isFinite));
    assert(Number.isFinite(sample(fine.grid, fine.heights, half.grid.xMax, half.grid.yMax)));
    assert(routeAll(half, fine).every(r => r.parts.every(p => !p.failed)));
    const { shoreline, shoreDistance: [min, max] } = (await readRegressions()).round4;
    for (const [x, y] of shoreline) {
        let shore = x;
        while (shore < design.grid.xMax && again.terrain.land[again.terrain.grid.index(shore, y)]) shore++;
        assert(shore - x >= min && shore - x <= max, "Shoreline outside the survey range");
    }
});

test("Street end rise fades radially while distant heights stay fixed", fixtureOptions("round6.json", "regressions.json"), async () => {
    const raw = await readFixture("round6.json");
    const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
    const legacy = originalWoodland(raw);
    // Replay the historical engine input before the v3-to-v4 defaults are applied.
    const original = new Island(legacy as Design);
    const d = parseDesign(raw), island = new Island(d), terrain = island.terrain, grid = terrain.grid;
    const rise = d.zones.find(z => z.height.endRise)!.height.endRise!;
    const { center, fade, level } = rise;
    assert.deepEqual(fade, [4, 13]);
    const expected = (await readRegressions()).round6;
    let outer = 0, inner = 0, maxBefore = 0, maxAfter = 0;
    const far = [];
    for (let j = 0; j < grid.height; j++)
        for (let i = 0; i < grid.width; i++) {
            const k = j * grid.width + i, p: Point = [grid.x(i), grid.y(j)], r = distance(center, p);
            if (r >= fade[1]) {
                assert.equal(terrain.heights[k], original.terrain.heights[k]);
                far.push(terrain.heights[k]);
                outer++;
            }
            if (r <= fade[0]) {
                assert.equal(terrain.coefficients[level][k], 0);
                inner++;
            }
            if (r > expected.nearRadius)
                continue;
            for (const [u, v] of [[i + 1, j], [i, j + 1]]) {
                if (distance(center, [grid.x(u), grid.y(v)]) > expected.nearRadius)
                    continue;
                const n = v * grid.width + u;
                maxBefore = Math.max(maxBefore, Math.abs(original.terrain.heights[n] - original.terrain.heights[k]));
                maxAfter = Math.max(maxAfter, Math.abs(terrain.heights[n] - terrain.heights[k]));
            }
        }
    assert.equal(inner, expected.innerSamples);
    assert.equal(outer, expected.outerSamples);
    assert.equal(sha(Buffer.from(Float32Array.from(far).buffer)), expected.farDigest);
    assert(maxBefore > expected.minOriginalRise && maxAfter <= expected.maxMigratedRise);
    for (const fade of [[-1, 13], [8, 8], [14, 4]] as Point[]) {
        const invalid = structuredClone(d);
        invalid.zones.find(z => z.height.endRise)!.height.endRise!.fade = fade;
        assert.throws(() => parseDesign(serializeDesign(invalid)), /半径/);
    }
});