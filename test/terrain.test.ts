import { test } from "node:test";
import assert from "node:assert/strict";
import { type Point, type Design } from "../src/core/design/types.ts";
import { type ImportDesign } from "../src/core/design/migrations/legacy.ts";
import { readFixture } from "../configs/read-fixture.ts";
import { distance, sample } from "../src/core/math/geometry.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { routeAll } from "../src/core/roads/routing.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { createHash } from "node:crypto";
import { referenceText } from "./scenarios.ts";

test("A seed reproduces terrain and graded heights", () => {
    const design = parseDesign(referenceText);
    const model = new Island(design);
    const again = new Island(parseDesign(referenceText));
    assert.deepEqual(model.terrain.heights, again.terrain.heights);
    assert.deepEqual(model.graded.heights, again.graded.heights);
    const changed = structuredClone(design);
    changed.seed++;
    assert.notDeepEqual(generateTerrain(changed).heights, model.terrain.heights);
});

test("Half-metre grid, routing and eastern shoreline", () => {
    const again = new Island(parseDesign(referenceText));
    const design = again.design;
    const half = parseDesign(referenceText);
    half.grid.step = .5;
    const fine = generateTerrain(half);
    assert.equal(fine.grid.size, 4 * again.terrain.grid.size);
    assert(fine.heights.every(Number.isFinite));
    assert(Number.isFinite(sample(fine.grid, fine.heights, half.grid.xMax, half.grid.yMax)));
    assert(routeAll(half, fine).every(r => r.parts.every(p => !p.failed)));
    for (const [x, y] of [
        [48, 0],
        [48, 26],
        [40, 46]
    ]) {
        let shore = x;
        while (shore < design.grid.xMax && again.terrain.land[again.terrain.grid.index(shore, y)]) shore++;
        assert(shore - x >= 20 && shore - x <= 25, "默认东坡到海岸应为 20–25 m");
    }
});

test("Street end rise fades radially while distant heights stay fixed", async () => {
    const raw = await readFixture("round6.json");
    const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
    const legacy: ImportDesign = JSON.parse(raw);
    // Replay the historical engine input before the v3-to-v4 defaults are applied.
    const original = new Island(legacy as Design);
    const d = parseDesign(raw), island = new Island(d), terrain = island.terrain, grid = terrain.grid;
    const street = d.zones.find(z => z.id === "street")!, center = street.height.endRise!.center;
    assert.deepEqual(street.height.endRise!.fade, [4, 13]);
    let outer = 0, inner = 0, maxBefore = 0, maxAfter = 0;
    const far = [];
    for (let j = 0; j < grid.height; j++)
        for (let i = 0; i < grid.width; i++) {
            const k = j * grid.width + i, p: Point = [grid.x(i), grid.y(j)], r = distance(center, p);
            if (r >= 13) {
                assert.equal(terrain.heights[k], original.terrain.heights[k]);
                far.push(terrain.heights[k]);
                outer++;
            }
            if (r <= 4) {
                assert.equal(terrain.coefficients.streetEndRise[k], 0);
                inner++;
            }
            if (r > 6)
                continue;
            for (const [u, v] of [[i + 1, j], [i, j + 1]]) {
                if (distance(center, [grid.x(u), grid.y(v)]) > 6)
                    continue;
                const n = v * grid.width + u;
                maxBefore = Math.max(maxBefore, Math.abs(original.terrain.heights[n] - original.terrain.heights[k]));
                maxAfter = Math.max(maxAfter, Math.abs(terrain.heights[n] - terrain.heights[k]));
            }
        }
    assert.equal(inner, 52);
    assert.equal(outer, 51960);
    assert.equal(sha(Buffer.from(Float32Array.from(far).buffer)), "3ae0a8c03035b3b02e237e4b428afd1ed60634a8a5d5384206ae5398055429f8");
    assert(maxBefore > 1.90 && maxAfter <= .4);
    for (const fade of [[-1, 13], [8, 8], [14, 4]] as Point[]) {
        const invalid = structuredClone(d);
        invalid.zones.find(z => z.id === "street")!.height.endRise!.fade = fade;
        assert.throws(() => parseDesign(serializeDesign(invalid)), /半径/);
    }
});