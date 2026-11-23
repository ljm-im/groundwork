import { syntheticDesign } from "./scenarios.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Point } from "../src/core/design/v5.ts";
import { type Tree } from "../src/core/design/results.ts";
import { fixtureOptions, readFixture } from "../configs/read-fixture.ts";
import { nearest, stations } from "../src/core/math/geometry.ts";
import { exportIsland } from "../src/core/export.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { insidePolygon } from "../src/core/math/polygon.ts";
import { addFeature } from "../src/core/edit/landforms.ts";
import { terrainSurface } from "../src/core/terrain/surface.ts";
import { inClearing, maxTreeSlope, plantTrees, treesClearOfRoads, visibleTrees } from "../src/core/vegetation/vegetation.ts";

test("Grove openings, avenue spacing and clearance from roads and buildings", () => {
    const d = syntheticDesign();
    const row = addFeature(d, "planting", [[8, -34], [34, -34], [34, -12], [8, -12]]);
    Object.assign(row, { rows: true, species: "avenue", density: 1, clump: 0, feather: 0, spacing: 5 });
    const island = new Island(d), rows = island.trees.filter(t => t.planting === row.id && t.row);
    const boundary = [...row.points, row.points[0]], chain = stations(boundary), length = chain.at(-1)!;
    const spacing = length / Math.round(length / row.spacing);
    assert(rows.length >= 3);
    for (const t of rows) {
        const foot = nearest(...t.point, boundary), station = chain[foot.segment] + foot.t * (chain[foot.segment + 1] - chain[foot.segment]);
        assert.equal(t.species, "avenue");
        assert(foot.distance < 1e-8 && Math.abs(station / spacing - .5 - Math.round(station / spacing - .5)) < 1e-7);
    }
    for (const t of island.trees) {
        for (const r of island.routes) assert(nearest(...t.point, r.points).distance - r.edge.width / 2 >= 1.5);
        for (const b of island.terrain.buildings) assert(b.signedDistance(...t.point) >= 2);
    }
    const clearing = addFeature(d, "clearing", [[6, -36], [36, -36], [36, -10], [6, -10]]);
    clearing.cover = "ambient";
    island.replant();
    const within = () => island.trees.filter(t => inClearing(clearing.shape!, t.point));
    assert(within().length > 0 && within().every(t => !t.planting));
    delete clearing.cover;
    island.replant();
    assert.equal(within().length, 0);
});

test("Feathered rows follow a synthetic boundary in either winding", () => {
    const rowDesign = syntheticDesign(), terrain = new Island(rowDesign).terrain;
    const rowArea = addFeature(rowDesign, "planting", [[-3, -17], [15, -17], [15, -1], [-3, -1]]);
    Object.assign(rowArea, { rows: true, density: 1, clump: 0, feather: 2, spacing: 5 });
    for (let pass = 0; pass < 2; pass++) {
        const rows = plantTrees(rowDesign, terrain).filter(t => t.planting === rowArea.id && t.row);
        assert(rows.length > 0);
        assert(rows.every(t => insidePolygon(rowArea, t.point) && nearest(...t.point, rowArea.points, true).distance > 0));
        rowArea.points.reverse();
    }
    const added = addFeature(rowDesign, "planting", [[1, 1], [6, 1], [3, 5]]);
    added.rows = true;
    added.density = .8;
    assert.deepEqual(parseDesign(serializeDesign(rowDesign)), rowDesign);
});

test("Trees avoid steep finished grass, rocky ground and water while planted trees may grow on sand or paving", () => {
    const island = new Island(syntheticDesign()), terrain = island.terrain, { grid } = terrain;
    const points: Point[] = [-28.5, -20.5, -12.5, -4.5, 3.5, 18.5, 24.5].map(x => [x, 4.5]);
    const [grass, sand, rock, sea, paved, slope, steepPaving] = points.map(p => grid.index(...p));
    terrain.padMask.fill(0);
    terrain.padMask[paved] = terrain.padMask[steepPaving] = 1;
    terrain.shore.fill(20);
    terrain.shore[sand] = 3;
    const graded = { weight: new Float32Array(grid.size), heights: terrain.heights.map((_, k) => 1 + .625 * Math.max(0, grid.point(k)[0] - 8)) };
    graded.heights[sea] = -1;
    graded.heights[rock + 1] += 3;
    const surfaceAt = terrainSurface(terrain, graded.heights);
    assert.deepEqual([grass, sand, rock, sea, paved, slope, steepPaving].map(k => surfaceAt(k)!.type), [3, 1, 2, 0, 4, 3, 4]);
    assert(surfaceAt(slope)!.slope > maxTreeSlope && surfaceAt(steepPaving)!.slope > maxTreeSlope);
    const candidates: Tree[] = points.flatMap(point => [undefined, "A"].map(planting => ({ point, planting, species: "small", radius: 1, wooded: false })));
    const kept = visibleTrees(candidates, terrain, graded, [], surfaceAt);
    assert.deepEqual(kept, [candidates[0], candidates[1], candidates[3], candidates[9]]);
    const boundary = (k: number) => ({ ...surfaceAt(k)!, slope: maxTreeSlope });
    assert.equal(visibleTrees(candidates.slice(-2), terrain, graded, [], boundary).length, 1);
});

test("The installed design exports the same trees as the editor on permitted final surfaces", fixtureOptions("round14-coast.json"), async () => {
    const island = new Island(parseDesign(await readFixture("round14-coast.json")));
    const surfaceAt = terrainSurface(island.terrain, island.graded.heights);
    const out = exportIsland(island, { sha256: "", commit: "" });
    assert(out.trees.length > 0);
    assert.equal(out.trees.length, island.trees.length);
    const clear = treesClearOfRoads(island.treeCandidates, island.terrain, island.graded, island.routes);
    assert.deepEqual(island.trees, clear.filter(tree => {
        const { type, slope } = surfaceAt(island.terrain.grid.index(...tree.point))!;
        return slope <= maxTreeSlope && (tree.planting ? [1, 3, 4].includes(type) : type === 3);
    }));
    for (const [i, tree] of island.trees.entries()) {
        const k = island.terrain.grid.index(...tree.point), cell = surfaceAt(k)!, exported = out.trees[i];
        assert(tree.planting ? cell.type !== 0 && cell.type !== 2 : cell.type === 3);
        assert(cell.slope <= maxTreeSlope);
        assert.equal(out.terrain.surface[Math.floor(k / island.terrain.grid.width)][k % island.terrain.grid.width], cell.type);
        assert.deepEqual(exported.position.slice(0, 2), tree.point.map(v => Number(v.toFixed(3)) || 0));
        assert.equal(exported.type, "tree." + tree.species);
    }
});

test("Editing a woodland leaves distant scattered trees in place", () => {
    const design = syntheticDesign();
    const north = addFeature(design, "planting", [[12, -31], [30, -32], [31, -12], [12, -10]]);
    north.natural = true;
    const island = new Island(design);
    const oldBoundary = structuredClone(north), before = island.trees;
    const scatter = (trees: Tree[]) => trees.filter(t => !t.planting);
    north.points[0][0] += 3;
    island.replant();
    const distant = (trees: Tree[]) => scatter(trees).filter(t => [oldBoundary, north].every(area =>
        !insidePolygon(area, t.point) && nearest(...t.point, area.points, true).distance > 10));
    assert(distant(before).length > 0);
    assert.deepEqual(distant(island.trees), distant(before));
});