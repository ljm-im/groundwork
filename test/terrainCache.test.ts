import { test } from "node:test";
import assert from "node:assert/strict";
import { designFixtures, fixtureOptions, readRegressions } from "../configs/read-fixture.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { type Design } from "../src/core/design/v5.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { syntheticDesign, rect, layer } from "./scenarios.ts";

function compare(cache: TerrainCache, d: Design) {
    const actual = cache.generate(d), expected = generateTerrain(d);
    assert.deepEqual(actual.defined, expected.defined);
    assert.deepEqual(actual.batterResiduals, expected.batterResiduals);
    assert.deepEqual(actual.shore, expected.shore);
    assert.deepEqual(Object.keys(actual.fields), Object.keys(expected.fields));
    for (const field of Object.keys(expected.fields))
        assert.deepEqual(new Uint8Array(actual.fields[field].buffer), new Uint8Array(expected.fields[field].buffer), field);
    return actual;
}

test("Incremental layers match a fresh stack byte for byte after every fixture edit", fixtureOptions("round14-coast.json", "round14-land.json", "regressions.json"), async () => {
    const rules = (await readRegressions()).fixtures;
    for (const fixture of await designFixtures()) {
        const d = parseDesign(fixture.text), cache = new TerrainCache(), raw = new TerrainCache();
        const check = () => {
            compare(raw, { ...d, buildings: [] });
            compare(cache, d);
        };
        const rule = rules[fixture.name.replace("round14-", "").replace(".json", "")];
        const erosion = d.geoNodes.find(n => n.function.type === "erosion")!;
        check();
        for (const [i, key] of rule.variables.entries()) {
            d.variables[key].value += .5;
            check();
            assert.equal(cache.recomputed.includes(erosion.id), i === 1);
        }
        const moved = d.geoNodes.find(n => n.id === rule.move)!.construction;
        assert(moved.type === "free");
        for (const path of moved.paths) for (const v of path.nodes) v.p[0] += 3;
        check();
        assert(erosion.function.type === "erosion");
        erosion.function.droplets += 123;
        check();
        const [i, j] = rule.swap.map(id => d.geoNodes.findIndex(n => n.id === id));
        [d.geoNodes[i], d.geoNodes[j]] = [d.geoNodes[j], d.geoNodes[i]];
        check();
        d.geoNodes = d.geoNodes.filter(n => n.id !== rule.remove &&
            !(n.construction.type === "strip" && n.construction.of.some(id => id === rule.remove)));
        check();
        const index = d.geoNodes.findIndex(n => n.function.type === "noise"), detail = d.geoNodes[index];
        assert(detail?.function.type === "noise" && typeof detail.function.amplitude === "number");
        const initial = detail.function.amplitude;
        for (const offset of [.25, .5, 0]) {
            detail.function.amplitude = initial + offset;
            check();
            assert(cache.recomputed.includes(detail.id) && cache.recomputed.includes(erosion.id));
            assert(d.geoNodes.slice(0, index).every(n => !cache.recomputed.includes(n.id)));
        }
    }
});

test("Cached noise follows its amplitude field and the order of a flat terrace", () => {
    const d = syntheticDesign(), area = rect(2, 0, 18, 14), cache = new TerrainCache();
    d.fields.A = { default: 2 };
    const amplitude = layer("F", area, { type: "flat", value: 1 }, "A");
    const detail = layer("N", area, { type: "noise", amplitude: { field: "A" }, scale: 9 });
    const terrace = layer("P", area, { type: "flat", value: 8 });
    d.geoNodes = [d.geoNodes[0], amplitude, detail, terrace];
    const plain = compare(cache, d), cells = plain.regions.get(terrace.id)!.cells;
    assert(cells.every(k => plain.heights[k] === 8));
    d.geoNodes = [d.geoNodes[0], amplitude, terrace, detail];
    const textured = compare(cache, d);
    assert(cells.some(k => textured.heights[k] !== 8));
    amplitude.function = { type: "flat", value: 0 };
    const muted = compare(cache, d);
    assert.deepEqual(cache.recomputed, [amplitude.id, detail.id]);
    assert(cells.every(k => muted.heights[k] === 8));
});

test("Moved, deleted and reordered writes restore old cells and keep earlier Island snapshots isolated", () => {
    const d = syntheticDesign(), cache = new TerrainCache(), first = compare(cache, d);
    const saved = first.heights.slice();
    d.geoNodes.push(layer("B", rect(-13, -12, 3, 1), { type: "flat", value: 12 }),
        layer("C", rect(-20, -18, 10, 9), { type: "add", amount: -1, feather: 2 }));
    compare(cache, d);
    [d.geoNodes[1], d.geoNodes[2]] = [d.geoNodes[2], d.geoNodes[1]];
    compare(cache, d);
    d.geoNodes.splice(1, 1);
    const result = compare(cache, d);
    assert.deepEqual(first.heights, saved);
    assert.equal(result.buildings[0].data, d.buildings[0]);
    const clone = structuredClone(d), rebound = compare(cache, clone);
    assert.equal(rebound.buildings[0].data, clone.buildings[0]);
    assert.deepEqual(cache.recomputed, []);
    d.geoNodes[0].construction = rect(-50, -33, 52, 34);
    compare(cache, d);
    d.grid.step = .5;
    compare(cache, d);
    cache.clear();
    compare(cache, d);
    assert.equal(cache.recomputed.length, d.geoNodes.length);
});