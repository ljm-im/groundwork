import { type ImportDesign } from "../src/core/design/migrations/legacy.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Clearing, type Planting, type Polygon } from "../src/core/design/types.ts";
import { type Tree } from "../src/core/design/results.ts";
import { readFixture } from "../configs/read-fixture.ts";
import { nearest, stations } from "../src/core/math/geometry.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, serializeDesign, clearingShape } from "../src/core/design/model.ts";
import { insidePolygon } from "../src/core/math/polygon.ts";
import { addFeature, deleteFeature } from "../src/core/edit/landforms.ts";
import { inClearing, plantTrees } from "../src/core/vegetation/vegetation.ts";

test("Grove openings, avenue spacing and clearance from roads and buildings", async () => {
    const original = await readFixture("round5.json");
    const author = parseDesign(original), baseline = new Island(author);
    const current = await readFixture("round5-default.json");
    const design = parseDesign(current), island = new Island(design);
    const clearing = author.vegetation.clearings.find(c => c.id === "grove-opening")!;
    assert(clearing && !("view" in author.vegetation));
    assert(!author.labels.some(label => label.name === "家的视线"));
    const garden = new Island(parseDesign(original));
    deleteFeature(garden.design, { kind: "clearing", id: clearing.id });
    garden.replant();
    const openingTrees = (trees: Tree[]) => trees.filter(t => inClearing(clearingShape(author, clearing), t.point) && t.wooded);
    assert(openingTrees(garden.trees).length > openingTrees(baseline.trees).length);
    const inner = design.vegetation.plantings.find(a => a.id === "inner-garden")!;
    const avenue = design.vegetation.plantings.find(a => a.id === "ring-avenue")!;
    assert.equal(inner.density, .35);
    assert.equal(avenue.spacing, 6);
    const small = island.trees.filter(t => t.planting === inner.id);
    assert(small.every(t => inClearing({ type: "polygon", points: inner.points }, t.point)));
    assert.deepEqual(new Set(small.map(t => t.species)), new Set(["small", "shrub"]));
    const rows = island.trees.filter(t => t.planting === avenue.id && t.row);
    assert(rows.length >= 3 && rows.every(t => t.species === "avenue"));
    const boundary = [...avenue.points, avenue.points[0]], chain = stations(boundary), length = chain.at(-1)!;
    const spacing = length / Math.round(length / avenue.spacing);
    assert(Math.abs(spacing - 6) < .3);
    for (const t of rows) {
        const foot = nearest(...t.point, boundary), station = chain[foot.segment] + foot.t * (chain[foot.segment + 1] - chain[foot.segment]);
        assert(foot.distance < 1e-8 && Math.abs((station / spacing - .5) - Math.round(station / spacing - .5)) < 1e-7);
    }
    let minRoad = Infinity, minBuilding = Infinity;
    for (const t of island.trees) {
        for (const r of island.routes)
            minRoad = Math.min(minRoad, nearest(...t.point, r.points).distance - r.edge.width / 2);
        for (const b of island.terrain.buildings)
            minBuilding = Math.min(minBuilding, b.signedDistance(...t.point));
    }
    assert(minRoad >= 1.5 && minBuilding >= 2);
    const added = addFeature(garden.design, "planting", [[3, 38], [10, 42], [11, 35]]);
    added.rows = true;
    added.density = .8;
    assert.deepEqual(parseDesign(serializeDesign(garden.design)), garden.design);
});

test("Woodland density, clearing overlays and feathered rows", async () => {
    const raw = await readFixture("round6.json");
    const d = parseDesign(raw);
    const legacy: ImportDesign = JSON.parse(raw);
    const island = new Island(d), terrain = island.terrain, grid = terrain.grid;
    const woods = d.vegetation.plantings.filter(a => a.natural), [north, grove] = woods;
    // Recorded on the round-six fixture before the woodland migration.
    woods.forEach((area, i) => {
        const old = [174, 87][i], current = island.trees.filter(t => insidePolygon(area, t.point)).length;
        assert(Math.abs(current - old) / old <= .15, area.name + " 的树木数量超出 15%");
    });
    const opening = d.vegetation.clearings.find(c => c.cover === "ambient")!;
    assert.deepEqual(opening.shape, legacy.vegetation.clearings.find(c => c.id === opening.id)!.shape);
    const clearingTest = new Island(structuredClone(d));
    const overlay: Clearing & { shape: Polygon } = { id: "cover-check", name: "空地测试", cover: "ambient", shape: { type: "polygon", points: north.points } };
    clearingTest.design.vegetation.clearings.push(overlay);
    clearingTest.replant();
    const within = () => clearingTest.trees.filter(t => inClearing(overlay.shape, t.point));
    assert(within().length > 0 && within().every(t => !t.planting));
    delete overlay.cover;
    clearingTest.replant();
    assert.equal(within().length, 0);
    assert(!island.trees.some(t => t.planting && inClearing(opening.shape!, t.point)));
    for (const t of island.trees.filter(t => t.planting === grove.id)) {
        const zone = terrain.zones[terrain.zoneAt[grid.index(...t.point)]]?.id;
        assert(zone == null || grove.zones!.includes(zone));
    }
    // A row with a feathered edge still follows the boundary in either winding.
    const rowDesign = structuredClone(d);
    const rowArea: Planting = { ...north, id: "row-check", rows: true, density: 1, clump: 0, natural: false,
        feather: 2, spacing: 6, points: [[-32, 57], [-4, 57], [-4, 73], [-32, 73]] };
    rowDesign.vegetation.plantings = [rowArea];
    for (let pass = 0; pass < 2; pass++) {
        const rows = plantTrees(rowDesign, terrain).filter(t => t.planting === rowArea.id && t.row);
        assert(rows.length > 0);
        assert(rows.every(t => insidePolygon(rowArea, t.point) && nearest(...t.point, rowArea.points, true).distance > 0));
        rowArea.points.reverse();
    }
});

test("Editing a woodland leaves distant scattered trees in place", async () => {
    const input = await readFixture("round6.json");
    const design = parseDesign(input), island = new Island(design);
    const north = design.vegetation.plantings.find(a => a.name === "北部树林")!;
    const oldBoundary = structuredClone(north), before = island.trees;
    const scatter = (trees: Tree[]) => trees.filter(t => !t.planting);
    const fixed = scatter(before).length, previous = 507;
    assert(Math.abs(fixed - previous) / previous <= .1);
    north.points[0][0] += 3;
    island.replant();
    const distant = (trees: Tree[]) => scatter(trees).filter(t => [oldBoundary, north].every(area =>
        !insidePolygon(area, t.point) && nearest(...t.point, area.points, true).distance > 10));
    assert(distant(before).length > 0);
    assert.deepEqual(distant(island.trees), distant(before));
});