import { previewLevels } from "../src/app/levelPreview.ts";
import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { Island } from "../src/core/island.js";
import { parseDesign, serializeDesign } from "../src/core/model.js";
import { nearest } from "../src/core/geometry.js";
import { insideYard } from "../src/core/yards.js";

const input = await readFixture("round6.json");
const design = parseDesign(input), island = new Island(design);
const exported = serializeDesign(design);
assert.equal(serializeDesign(parseDesign(exported)), exported);
assert.deepEqual(new Island(parseDesign(input)).trees, island.trees);
const withLegacyField = JSON.parse(exported);
withLegacyField.vegetation.scatterPattern = "obsolete";
assert.equal(serializeDesign(parseDesign(JSON.stringify(withLegacyField))), exported);

const north = design.vegetation.plantings.find(a => a.name === "北部树林");
const oldBoundary = structuredClone(north), before = island.trees;
const scatter = trees => trees.filter(t => !t.planting);
const fixed = scatter(before).length, previous = 507;
assert(Math.abs(fixed - previous) / previous <= .1);
north.points[0][0] += 3;
island.replant();
const distant = trees => scatter(trees).filter(t => [oldBoundary, north].every(area =>
    !insideYard(area, t.point) && nearest(...t.point, area.points, true).distance > 10));
assert(distant(before).length > 0);
assert.deepEqual(distant(island.trees), distant(before));
console.log("固定步长零散树", previous, "→", fixed, "；移动顶点 3 m 后远处相同", distant(before).length);

// The interactive shortcut must produce the full engine's values, including
// stair landings, graded road beds, trees and issue locations at every level.
const reference = new Island(parseDesign(input));
const preview = new Island(parseDesign(input));
for (const [key, [, min, max]] of Object.entries(reference.design.levelControls)) {
    for (const value of [max, min]) {
        reference.design.levels[key] = preview.design.levels[key] = value;
        reference.levels();
        previewLevels(preview, new Set([key]));
        assert.deepEqual(preview.routes, reference.routes);
        assert.deepEqual(preview.graded.heights, reference.graded.heights);
        assert.deepEqual(preview.trees, reference.trees);
        assert.deepEqual(preview.issues, reference.issues);
    }
}