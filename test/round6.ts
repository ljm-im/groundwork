import { type Clearing, type Design, type Planting, type Point, type Polygon } from "../src/core/design/types.ts";
import { type ImportDesign } from "../src/core/design/migrations/legacy.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFixture } from "../configs/read-fixture.ts";
import { distance, mixPoint, nearest, sample } from "../src/core/math/geometry.ts";
import { History } from "../src/core/edit/history.ts";
import { Island } from "../src/core/island.ts";
import { addFeature, clickDrawing, drawingTarget, featureLine, finishExtension, insertVertex, newDrawing } from "../src/core/edit/landforms.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { inClearing, plantTrees } from "../src/core/vegetation/vegetation.ts";
import { insidePolygon, simpleBoundary } from "../src/core/math/polygon.ts";

const raw = await readFixture("round6.json");
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
assert.equal(sha(raw), "b77a8a26cb0260287e3f720392390ed58261b6032936dbe5525084d59020eabe");
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

const woods = d.vegetation.plantings.filter(a => a.natural), [north, grove] = woods;
assert.deepEqual(woods.map(a => [a.name, a.feather, a.density, a.species]), [["北部树林", 6, .95, "forest"], ["家旁密林", 3, .97, "forest"]]);
assert.deepEqual(grove.zones, ["street", "saddle"]);
assert(!("zones" in north) && !("forest" in d.vegetation) && !("grove" in d.vegetation));
assert.equal(d.vegetation.plantings.length, legacy.vegetation.plantings.length + 2);
assert(d.vegetation.plantings.slice(2).every(a => a.natural === false && a.feather === 0));
for (const a of woods) {
    assert(simpleBoundary(a.points));
    const segments = a.points.map((p, i) => distance(p, a.points[(i + 1) % a.points.length])).sort((a, b) => a - b);
    assert(Math.abs(segments[Math.floor(segments.length / 2)] - 4) < .5);
}
for (const name of ["rooms", "yardTree", "density", "clearings"] as const)
    assert.deepEqual(d.vegetation[name], legacy.vegetation[name]);
for (const name of ["nodes", "edges", "buildings", "peaks", "ridges"] as const)
    assert.deepEqual(d[name], legacy[name]);
// Recorded on the round-six fixture before the woodland migration.
const counts = woods.map((area, i) => {
    const old = [174, 87][i], current = island.trees.filter(t => insidePolygon(area, t.point)).length;
    assert(Math.abs(current - old) / old <= .15, area.name + " 的树木数量超出 15%");
    return { name: area.name, old, current };
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
    assert(zone == null || grove.zones.includes(zone));
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
for (const name of ["forest", "grove"] as const) {
    const partial = structuredClone(legacy);
    delete partial.vegetation[name];
    assert.equal(parseDesign(serializeDesign(partial)).vegetation.plantings.length, 3);
}
assert.equal(serializeDesign(parseDesign(serializeDesign(d))), serializeDesign(d));
assert.deepEqual(new Island(parseDesign(serializeDesign(d))).trees, island.trees);

// Each committed click uses the same state transition as the canvas event.
const saved = serializeDesign(d), history = new History(d), east = d.ridges.find(r => r.id === "east")!, west = d.ridges.find(r => r.id === "west")!;
const eastMid = featureLine(d, "ridge", east)[12], scale = 8;
let drawing = newDrawing("ridge");
const selected = clickDrawing(d, drawing, eastMid, scale)!;
assert(selected.changed && selected.selection.index === 2 && selected.selection.id === east.id);
assert.equal(east.points.length, 5);
assert.deepEqual(east.points[2].height, { level: "B", offset: 6 });
assert.deepEqual(drawing.points, []);
assert(!clickDrawing(d, drawing, east.points[2].point, scale)!.changed);
assert.equal(east.points.length, 5);
history.record(d);
assert.equal(serializeDesign(history.step(false)!), saved);
assert.deepEqual(history.step(true)!.ridges.find(r => r.id === east.id)!.points, east.points);

for (const atStart of [false, true]) {
    const doc = parseDesign(saved), before = structuredClone(west.points), journal = new History(doc);
    drawing = newDrawing("ridge");
    clickDrawing(doc, drawing, before[atStart ? 0 : before.length - 1].point, scale)!;
    const extra: Point[] = atStart ? [[-43, -70], [-38, -74]] : [[-64, 70], [-58, 72]];
    for (const p of extra)
        clickDrawing(doc, drawing, p, scale)!;
    assert.equal(serializeDesign(doc), saved);
    const heights = extra.map(p => Math.round(sample(grid, terrain.heights, ...p) + 6));
    finishExtension(doc, drawing, heights);
    const added = extra.map((point, i) => ({ point, height: heights[i] }));
    assert.deepEqual(doc.ridges.find(r => r.id === west.id)!.points, atStart ? [...added.reverse(), ...before] : [...before, ...added]);
    journal.record(doc);
    assert.equal(serializeDesign(journal.step(false)!), saved);
    assert.deepEqual(journal.step(true)!, doc);
}

const doc = parseDesign(saved), journal = new History(doc);
drawing = newDrawing("ridge");
clickDrawing(doc, drawing, [30, 7], scale)!;
clickDrawing(doc, drawing, eastMid, scale)!;
assert.equal(drawing.points.length, 2);
assert.equal(doc.ridges.find(r => r.id === "east")!.points.length, 4);
addFeature(doc, "ridge", drawing.points, 11);
journal.record(doc);
assert.equal(serializeDesign(journal.step(false)!), saved);
const near = structuredClone(doc);
const r1 = addFeature(near, "ridge", [[0, 0], [5, 0], [10, 0]]), r2 = addFeature(near, "ridge", [[0, .6], [5, .6], [10, .6]]);
assert.equal(drawingTarget(near, "ridge", [7.5, .5], 10)!.id, r2.id);
assert.equal(drawingTarget(near, "ridge", [0, -1], 10)!.action, "extend");
assert.equal(drawingTarget(near, "ridge", [5, -1], 10)!.action, "select");
assert.equal(drawingTarget(near, "ridge", [5, -1.01], 10)!, null);
assert.equal(drawingTarget(near, "ridge", [7.5, .05], 10)!.id, r1.id);

for (const kind of ["planting", "clearing"] as const) {
    const doc = parseDesign(saved), area = kind === "planting" ? doc.vegetation.plantings.find(a => a.id === "inner-garden")! :
        addFeature(doc, "clearing", [[0, 0], [8, 0], [8, 8], [0, 8]]);
    const journal = new History(doc), original = serializeDesign(doc), vertices = "points" in area ? area.points : (area.shape as Polygon).points;
    const before = structuredClone(vertices), drawing = newDrawing(kind);
    const m = mixPoint(before[1], before[2], .5);
    assert(clickDrawing(doc, drawing, m, 10)!.changed);
    assert.equal(vertices.length, before.length + 1);
    assert.deepEqual(vertices[2], m);
    assert.deepEqual(drawing.points, []);
    journal.record(doc);
    assert.equal(serializeDesign(journal.step(false)!), original);
    const invalidDoc = parseDesign(original), boundary = addFeature(invalidDoc, kind, [[10, 0], [18, 0], [18, 8], [10, 8]]);
    const copy = serializeDesign(invalidDoc);
    assert.throws(() => insertVertex(invalidDoc, { kind, id: boundary.id }, { point: [14, 12], index: 0, fraction: .5 }), /自交/);
    assert.equal(serializeDesign(invalidDoc), copy);
}
console.log("第六轮通过：街尾径向过渡、直接插点、双端延长、边界保护、林区迁移与文件往返");
console.log("街中心最大相邻高差/m", maxBefore.toFixed(3), "→", maxAfter.toFixed(3), "内圈零系数", inner, "外圈相同格点", outer);
console.table(counts);