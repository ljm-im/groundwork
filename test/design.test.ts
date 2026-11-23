import { test } from "node:test";
import assert from "node:assert/strict";
import { undeclaredDesignField } from "../configs/fixtureSchema.ts";
import { designFixtures, fixtureOptions, readLegacyFixture } from "../configs/read-fixture.ts";
import { type ImportDesign } from "../src/core/design/migrations/legacy.ts";
import { migrateDesign } from "../src/core/design/migrations/v1ToV2.ts";
import { upgradeLandscape } from "../src/core/design/migrations/v2ToV3.ts";
import { upgradeWoodlands } from "../src/core/design/migrations/v3ToV4.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { type Point } from "../src/core/design/v5.ts";
import { distance } from "../src/core/math/geometry.ts";
import { simpleBoundary } from "../src/core/math/polygon.ts";
import { syntheticDesign, rect, layer } from "./scenarios.ts";

test("Version five opens atomically and older formats have an explicit migration message", () => {
    const d = syntheticDesign(), bytes = serializeDesign(d);
    assert.deepEqual(parseDesign(bytes), d);
    for (const version of [1, 2, 3, 4]) assert.throws(() => parseDesign({ version }), { message: "暂不支持 v4 设计，等待迁移" });
    assert.throws(() => parseDesign({ version: 6 }), { message: "不支持的版本" });
    assert.throws(() => parseDesign({ ...d, grid: null }), /网格/);
    d.edges[0].from = "missing";
    assert.throws(() => parseDesign(d), /端点/);
});

test("Archived fixed roads still migrate through the standalone migration functions", fixtureOptions("v4/round4.json", "v4/street-v1.json"), async () => {
    const d: ImportDesign = JSON.parse(await readLegacyFixture("round4.json"));
    const street: Point[] = JSON.parse(await readLegacyFixture("street-v1.json"));
    d.version = 1; d.edges = []; d.nodes = [{ id: "B", name: "B", type: "endpoint", fixedRoad: "A", vertex: street.length - 1, direction: -15 }];
    d.fixedRoads = [{ id: "A", name: "A", points: street, width: 2, grade: "path" }];
    const result = upgradeWoodlands(upgradeLandscape(migrateDesign(d)));
    assert.equal(result.version, 4);
    assert(!("fixedRoads" in result));
    assert(result.edges.length && result.nodes.length);
    const anchor = result.nodes.find(n => n.id === "B")!;
    assert.deepEqual(anchor.point, street.at(-1));
    assert.equal(anchor.direction, -15);
    assert(!Object.hasOwn(anchor, "fixedRoad") && !Object.hasOwn(anchor, "vertex"));
    assert(result.nodes.some(n => n.point && distance(n.point, street[0]) < 1e-8));
});

test("Legacy woods become named planting regions", fixtureOptions("v4/round6.json"), async () => {
    const d: ImportDesign = JSON.parse(await readLegacyFixture("round6.json"));
    const expected = [d.vegetation.forest!.density, d.vegetation.grove!.density];
    const zones = d.vegetation.grove!.zones;
    const previous = structuredClone(d);
    const result = upgradeWoodlands(d), woods = result.vegetation.plantings.filter(p => p.natural);
    assert.deepEqual(woods.map(p => p.density), expected);
    assert.deepEqual(woods.map(p => p.feather), [6, 3]);
    assert.deepEqual(woods[1].zones, zones);
    assert(woods.every(p => simpleBoundary(p.points) && p.species === "forest" && p.name.length));
    assert.equal(result.vegetation.plantings.length, previous.vegetation.plantings.length + 2);
    assert(!("zones" in woods[0]) && !("forest" in result.vegetation) && !("grove" in result.vegetation));
    assert(result.vegetation.plantings.slice(2).every(a => a.natural === false && a.feather === 0));
    for (const a of woods) {
        const lengths = a.points.map((p, i) => distance(p, a.points[(i + 1) % a.points.length])).sort((x, y) => x - y);
        assert(Math.abs(lengths[Math.floor(lengths.length / 2)] - 4) < .5);
    }
    for (const name of ["rooms", "yardTree", "density", "clearings"] as const) assert.deepEqual(result.vegetation[name], previous.vegetation[name]);
    for (const name of ["nodes", "edges", "buildings", "peaks", "ridges"] as const) assert.deepEqual(result[name], previous[name]);
});

test("Migrate a single remaining legacy woodland", fixtureOptions("v4/round6.json"), async () => {
    const raw = await readLegacyFixture("round6.json");
    for (const key of ["forest", "grove"] as const) {
        const d: ImportDesign = JSON.parse(raw), count = d.vegetation.plantings.length;
        delete d.vegetation[key];
        assert.equal(upgradeWoodlands(d).vegetation.plantings.length, count + 1);
    }
});

test("Every installed top-level design matches the version five declaration", fixtureOptions("round14-coast.json", "round14-land.json"), async () => {
    for (const f of await designFixtures()) assert.equal(undeclaredDesignField(parseDesign(f.text), f.name), undefined);
    const d = syntheticDesign();
    Object.assign(d.geoNodes[0].construction, { extra: 3 });
    assert.match(undeclaredDesignField(d, "input")!, /input\.geoNodes\[0\]\.construction\.extra/);
});

test("Geo references report their location and reject invalid field writers", () => {
    const d = syntheticDesign(), p = rect(0, 0, 4, 4), n = layer("N", p, { type: "flat", value: 1 });
    d.geoNodes.push(n);
    n.field = "missing";
    assert.throws(() => parseDesign(d), /geoNodes\[2\].*field.*找不到/);
    n.field = "f"; d.fields.f = { default: 2 };
    n.function = { type: "ground", value: 0 };
    assert.throws(() => parseDesign(d), /geoNodes\[2\].*field/);
    n.function = { type: "add", feather: 0, amount: { var: "absent" } };
    assert.throws(() => parseDesign(d), /amount.*找不到变量/);
    n.function = { type: "flat", value: 1 }; n.construction = { type: "strip", of: ["N"], widths: [1, 1] };
    assert.throws(() => parseDesign(d), /of.*找不到下方/);
    n.construction = p; p.paths.push(structuredClone(p.paths[0]));
    assert.throws(() => parseDesign(d), /nodes\[0\].id 重复/);
    p.paths.pop(); n.id = d.geoNodes[0].id;
    assert.throws(() => parseDesign(d), /geoNodes\[2\].id/);
});

test("Noise validates its inputs and rejects the retired inline noise parameter", () => {
    const d = syntheticDesign(), node = d.geoNodes[1];
    const fn = { type: "noise" as const, amplitude: 2, scale: 8 };
    for (const [key, value] of [["scale", 0], ["scale", Infinity], ["octaves", 0], ["octaves", 1.5], ["feather", -1],
        ["amplitude", { field: "missing" }]] as const) {
        node.function = { ...fn, [key]: value };
        assert.throws(() => parseDesign(d), error => error instanceof Error && error.message.includes("geoNodes[1].function." + key));
    }
    for (const surface of [{ type: "ground", value: 1 }, { type: "flat", value: 1 },
        { type: "slope", kind: "radial", value: 1, center: [0, 0], radius: 2, rate: .1 },
        { type: "slope", kind: "path", line: { points: [{ p: [0, 0], h: 1 }, { p: [2, 0], h: 2 }] } }]) {
        Object.assign(node, { function: { ...surface, noise: { amplitude: 1 } } });
        assert.throws(() => parseDesign(d), /geoNodes\[1\]\.function\.noise.*未知字段/);
    }
});

test("Removing a referenced variable lists every layer and label location", () => {
    const d = syntheticDesign();
    delete d.variables.A;
    d.labels = [{ name: "B", point: [1, 1], var: "A" }];
    d.geoNodes.push(layer("C", rect(2, 2, 5, 5), { type: "add", amount: { var: "A" }, feather: 0 }));
    assert.throws(() => parseDesign(d), error => error instanceof Error &&
        ["geoNodes[1].function.value", "geoNodes[2].function.amount", "labels[0].var"].every(p => error.message.includes(p)));
    assert.throws(() => parseDesign({ ...syntheticDesign(), zones: [] }), /zones.*v5/);
});

test("Supported owners preserve optional prompts, whitespace and empty prompt omission", () => {
    const d = syntheticDesign(), before = serializeDesign(d), owners = [d, d.buildings[0], d.edges[0], d.nodes[0], d.geoNodes[0]];
    for (const owner of owners) {
        Object.assign(owner, { prompt: null });
        assert.throws(() => parseDesign(d), /描述必须是字符串/);
        owner.prompt = "  A\n B ";
    }
    assert.deepEqual(parseDesign(serializeDesign(d)), d);
    for (const owner of owners) owner.prompt = "";
    assert.equal(serializeDesign(parseDesign(d)), before);
});