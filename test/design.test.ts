import { undeclaredDesignField } from "../configs/fixtureSchema.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { type ImportDesign } from "../src/core/design/migrations/legacy.ts";
import { designFixtures, readFixture } from "../configs/read-fixture.ts";
import { distance, radians } from "../src/core/math/geometry.ts";
import { nodePose, parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { simpleBoundary } from "../src/core/math/polygon.ts";
import { referenceText, oldStreet, originalWoodland } from "./scenarios.ts";

test("Validate references and remove legacy road fields", () => {
    const design = parseDesign(referenceText);
    assert.deepEqual(JSON.parse(serializeDesign(parseDesign(referenceText))), JSON.parse(referenceText));
    const broken = structuredClone(design);
    broken.edges[0].from = "missing";
    assert.throws(() => parseDesign(JSON.stringify(broken)));

    assert(!Object.hasOwn(design, "fixedRoads"));
    assert(design.nodes.every(n => !Object.hasOwn(n, "fixedRoad")));
});

test("Import optional yards and migrate fixed v1 roads", async () => {
    const street = await oldStreet();
    const legacy = parseDesign(referenceText);
    delete legacy.yards;
    legacy.nodes = legacy.nodes.filter(n => n.type !== "gate" && !n.through);
    legacy.edges = legacy.edges.filter(e => [e.from, e.to].every(id => legacy.nodes.some(n => n.id === id)));
    assert.deepEqual(parseDesign(serializeDesign(legacy)), legacy);
    const oldFormat: ImportDesign = parseDesign(referenceText);
    oldFormat.version = 1;
    oldFormat.edges = []; oldFormat.nodes = [{ id: "end", name: "旧街尾", type: "endpoint", fixedRoad: "old", vertex: street.length - 1, direction: -15 }];
    oldFormat.fixedRoads = [{ id: "old", name: "旧环街", points: street, grade: "street", width: 3 }];
    const upgraded = parseDesign(serializeDesign(oldFormat));
    assert.equal(upgraded.version, 4);
    assert(!Object.hasOwn(upgraded, "fixedRoads"));
    assert.deepEqual(nodePose(upgraded, "end").point, street.at(-1)!);
    assert.equal(nodePose(upgraded, "end").angle!, -15 * radians);
    assert.equal(upgraded.edges[0].to, "end");
    assert.deepEqual(parseDesign(serializeDesign(upgraded)), upgraded);
});

test("Legacy woods become named planting regions", async () => {
    const raw = await readFixture("round6.json");
    const d = parseDesign(raw);
    const legacy = originalWoodland(raw);
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
});

test("Migrate a single remaining legacy woodland", async () => {
    const raw = await readFixture("round6.json");
    const legacy = originalWoodland(raw);
    for (const name of ["forest", "grove"] as const) {
        const partial = structuredClone(legacy);
        delete partial.vegetation[name];
        assert.equal(parseDesign(serializeDesign(partial)).vegetation.plantings.length, 3);
    }
});

test("Every migrated fixture field belongs to the v4 Design declaration", async () => {
    for (const fixture of await designFixtures()) {
        if (fixture.name === "street-v1.json") {
            const legacy: ImportDesign = parseDesign(referenceText);
            legacy.version = 1;
            legacy.nodes = [];
            legacy.edges = [];
            legacy.fixedRoads = [{ id: "old", name: "旧环街", points: await oldStreet(), grade: "street", width: 3 }];
            assert.equal(undeclaredDesignField(parseDesign(legacy), fixture.name), undefined);
        }
        else {
            assert.equal(undeclaredDesignField(parseDesign(fixture.text), fixture.name), undefined);
        }
    }
    const design = parseDesign(referenceText);
    Object.assign(design.zones[0].shape, { extraCoordinate: 5 });
    assert.match(undeclaredDesignField(design, "negative") ?? "", /negative\.zones\[0\]\.shape\.extraCoordinate/);
});

test("Import preserves validation messages and compatible unrecognised fields", () => {
    const base = parseDesign(referenceText);
    assert.throws(() => parseDesign({ ...base, version: 9 }), { message: "不支持的版本" });
    assert.throws(() => parseDesign({ ...base, grid: null }), { message: "网格参数无效" });
    assert.throws(() => parseDesign({ ...base, ridges: {} }), { message: "ridges 缺失或含有重复 ID" });
    const compatible = { ...base, levelControls: [], sourceNote: "archived" };
    const bytes = JSON.stringify(compatible, null, 2);
    assert.equal(serializeDesign(parseDesign(bytes)), bytes);
});