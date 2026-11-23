import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureOptions, readFixture } from "../configs/read-fixture.ts";
import { syntheticDesign, rect, layer, syntheticRoads } from "./scenarios.ts";
import { type Design, type GeoFunction, type Path, type Point } from "../src/core/design/v5.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { History } from "../src/core/edit/history.ts";
import { addField, addVariable, bindField, bindHeight, copyGeo, createStrip, declarationUses, defaultFunction, deleteGeo, dependentStrips, enableGeo,
    nodeIds, rangeUsers, removeDeclaration, reorderGeo, resolved, stripRange } from "../src/core/edit/geoNodes.ts";
import { arcHandle, moveHandle, penNode, setSegment, translateGeo } from "../src/core/edit/paths.ts";
import { geometryPath, insertPathNode } from "../src/core/edit/geoControls.ts";
import { finishDraft, snapPoint, type GeoDraft, type DrawTool } from "../src/app/state/geoTools.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { Island } from "../src/core/island.ts";
import { exportIsland } from "../src/core/export.ts";
import { exportFlights } from "../src/core/roads/flights.ts";
import { longitudinal, profileReading } from "../src/core/roads/longitudinal.ts";
import { sample } from "../src/core/math/geometry.ts";
import { niceStep } from "../src/core/math/interval.ts";

function historyEdit(d: Design, edit: () => void) {
    const before = serializeDesign(d), history = new History(d);
    edit();
    const after = serializeDesign(d);
    assert(history.record(d), "one changed state");
    assert.equal(serializeDesign(history.step(false)), before);
    assert.equal(serializeDesign(history.step(true)), after);
}
function draft(d: Design, tool: DrawTool, options: Partial<GeoDraft> = {}): GeoDraft {
    return { tool, field: "height", ids: [], nodes: [], anchors: [], reverse: false, nextId: nodeIds(d), ...options };
}

test("Closed tools sample the chosen field and insert above the selection with one history step", () => {
    for (const tool of ["rect", "circle", "sector", "pen"] as const) {
        const d = syntheticDesign(), [ground, terrace] = d.geoNodes, field = addField(d);
        d.fields[field].default = 2.74;
        const t = generateTerrain(d), make = draft(d, tool, { ids: [ground.id], field, start: [2, 2], radius: [5, 4], cursor: [2, 6] });
        make.nodes = [penNode(make.nextId(), [1, 1]), penNode(make.nextId(), [5, 1], [6, 2]), penNode(make.nextId(), [4, 6])];
        historyEdit(d, () => {
            const n = finishDraft(d, t, make), path = geometryPath(n, 0)!;
            assert.deepEqual(d.geoNodes, [ground, n, terrace]);
            assert.equal(n.field, field); assert.deepEqual(n.function, { type: "flat", value: 2.7 });
            assert(path.closed);
            assert.deepEqual(path.nodes.map(v => v.next ?? "curve"), { rect: ["line", "line", "line", "line"], circle: ["arc", "arc"], sector: ["line", "arc", "line"], pen: ["curve", "curve", "curve"] }[tool]);
            if (tool === "circle") assert.deepEqual(path.nodes.map(v => v.bulge), [1, 1]);
            if (tool === "pen") {
                assert.equal(path.nodes[1].mode, "manual"); assert.deepEqual(path.nodes[1].in, [-1, -1]);
            }
            assert.equal(new Set(path.nodes.map(v => v.id)).size, path.nodes.length);
        });
        const off = finishDraft(d, t, draft(d, "rect", { start: [100, 100], cursor: [110, 111] }));
        assert.equal(d.geoNodes.at(-1), off); assert.deepEqual(off.function, { type: "flat", value: 0 });
    }
});

test("Strip direction, whole outlines, shared edges, ordering and cascading deletion survive history", () => {
    const d = syntheticDesign(), [lower, upper] = d.geoNodes, t = generateTerrain(d);
    const options = { ids: [upper.id], anchors: ["0", "2"] };
    for (const [anchors, reverse, expected] of [[[], false, undefined], [["0", "2"], false, { from: "0", to: "2" }], [["0", "2"], true, { from: "2", to: "0" }]] as const) {
        historyEdit(d, () => {
            const n = finishDraft(d, t, draft(d, "strip", { ...options, anchors: [...anchors], reverse }));
            assert(n.construction.type === "strip"); assert.deepEqual(n.construction.range, expected);
            assert.deepEqual(n.construction.widths, [0, 6]); assert.equal(n.function.type, "blend");
        });
    }
    assert.throws(() => stripRange(["0"]), /起点和终点/);
    historyEdit(d, () => {
        const n = createStrip(d, [lower.id, upper.id], "height", stripRange(options.anchors));
        assert.equal(d.geoNodes[2], n); assert.equal(n.function.type, "split");
        assert(n.construction.type === "strip"); assert.deepEqual(n.construction.widths, [1, 1]);
    });
    const saved = serializeDesign(d), dependent = dependentStrips(d, upper.id);
    assert.equal(dependent.length, 4);
    assert.throws(() => reorderGeo(d, dependent[0].id, 0), /条带必须在它引用的地件之上/);
    assert.equal(deleteGeo(d, upper.id, false), false); assert.equal(serializeDesign(d), saved);
    historyEdit(d, () => reorderGeo(d, dependent[0].id, d.geoNodes.length - 1));
    historyEdit(d, () => {
        assert(deleteGeo(d, upper.id, true)); assert.deepEqual(d.geoNodes, [lower]);
    });
});

test("Declarations report all writers, nested inputs and labels, and bindings retain their effective values", () => {
    const d = syntheticDesign();
    let variable = "", field = "";
    historyEdit(d, () => {
        variable = addVariable(d, 8);
    });
    historyEdit(d, () => {
        field = addField(d); d.fields[field].default = 3;
    });
    const n = d.geoNodes[1];
    historyEdit(d, () => {
        n.function = { type: "flat", value: bindHeight(variable) };
    });
    historyEdit(d, () => {
        n.function = { type: "flat", value: bindHeight(variable, -2) };
    });
    const fieldInput = (field: string) => new Island(d).inputAt(n.id, field, [0, 0]);
    historyEdit(d, () => {
        assert(n.function.type === "flat");
        n.function.value = resolved(n.function.value, d, fieldInput); assert.equal(n.function.value, 6);
    });
    historyEdit(d, () => {
        n.function = { type: "noise", amplitude: bindField(field), scale: 4 };
    });
    historyEdit(d, () => {
        assert(n.function.type === "noise"); n.function.amplitude = bindField(field, .5, 2);
    });
    const cover = layer("Q", rect(-5, -5, 5, 5), { type: "flat", value: 20 }); cover.field = field;
    d.geoNodes.push(cover);
    assert.equal(new Island(d).terrain.fields[field].includes(20), true);
    historyEdit(d, () => {
        assert(n.function.type === "noise"); n.function.amplitude = resolved(n.function.amplitude, d, fieldInput); assert.equal(n.function.amplitude, 3.5);
    });
    d.geoNodes.pop();
    d.geoNodes.push(layer("B", rect(1, 1, 8, 8), { type: "mountain", ridges: [], peaks: [{ at: { p: [2, 2], h: bindHeight(variable) }, radius: 3, scale: 1, noise: 0 }], floor: bindHeight(variable) }));
    d.labels.push({ name: "C", point: [2, 2], var: variable });
    n.function = { type: "noise", amplitude: bindField(field), scale: 3 }; n.field = field;
    for (const [kind, id, count] of [["variable", variable, 3], ["field", field, 2]] as const) {
        const uses = declarationUses(d, kind, id), before = serializeDesign(d);
        assert.equal(uses.length, count); assert.equal(new Set(uses).size, count);
        assert.throws(() => removeDeclaration(d, kind, id), e => e instanceof Error && uses.every(v => e.message.includes(v)));
        assert.equal(serializeDesign(d), before);
    }
    const other = addVariable(d);
    historyEdit(d, () => removeDeclaration(d, "variable", other));
    assert.throws(() => removeDeclaration(d, "field", "height"), /内置/);
});

test("Copies regenerate paths and preserve references, geometry moves together and range damage stays repairable", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], path = geometryPath(n, 0)!;
    const strip = createStrip(d, [n.id], "height", { from: path.nodes[0].id, to: path.nodes[2].id });
    historyEdit(d, () => {
        const copy = copyGeo(d, n), originalIds = d.geoNodes.filter(v => v !== copy).flatMap(v => geometryPath(v, 0)?.nodes.map(v => v.id) ?? []);
        assert.notEqual(copy.id, n.id); assert.deepEqual(copy.function, n.function); assert.equal(copy.name, n.name + " 副本");
        assert(geometryPath(copy, 0)!.nodes.every(v => !originalIds.includes(v.id))); assert.equal(d.geoNodes[d.geoNodes.indexOf(n) + 1], copy);
        assert.deepEqual(dependentStrips(d, n.id), [strip]); assert.deepEqual(dependentStrips(d, copy.id), []);
    });
    historyEdit(d, () => {
        const copy = copyGeo(d, strip); assert.deepEqual(copy.construction, strip.construction);
    });
    const id = path.nodes[0].id;
    assert.equal(rangeUsers(d, n.id, [id]).length, 2);
    historyEdit(d, () => {
        path.nodes.shift();
    });
    assert.throws(() => parseDesign(d), /range.*找不到/);
    const m = new Island(parseDesign(d, true));
    assert.equal(m.issues.filter(i => i.kind === "geo-reference").length, 2);
    n.function = { type: "slope", kind: "radial", center: [1, 2], radius: 2, rate: .1, value: 3 };
    historyEdit(d, () => {
        translateGeo(n, [4, 5]); assert(n.function.type === "slope" && n.function.kind === "radial"); assert.deepEqual(n.function.center, [5, 7]);
    });
});

test("Function defaults preserve construction, mandatory geometry commits only on completion", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], construction = structuredClone(n.construction), t = generateTerrain(d);
    const defaults: GeoFunction[] = [{ type: "ground", value: 0 }, { type: "mountain", peaks: [], ridges: [], floor: -1000 }, { type: "cliff", factor: .6, seaLevel: 0 },
        { type: "islets", density: .5, reach: 12, threshold: .45, seaLevel: 0 }, { type: "flat", value: 3.4 }, { type: "add", amount: 1, feather: 3 },
        { type: "noise", amplitude: 1, scale: 24, octaves: 5, feather: 0 }];
    for (const f of defaults) historyEdit(d, () => {
        n.function = defaultFunction(f.type, 3.4)!; assert.deepEqual(n.function, ["mountain", "cliff", "islets", "noise"].includes(f.type) ? { ...f, seed: "{var:seed}" } : f); assert.deepEqual(n.construction, construction);
    });
    for (const f of [{ type: "blend" }, { type: "split" }, { type: "batter", grade: .5 } ] as const) assert.deepEqual(defaultFunction(f.type), f);
    const erosion = defaultFunction("erosion"); assert(erosion?.type === "erosion" && erosion.strength === 1 && Number(erosion.droplets) > 0 && erosion.floor === -1000);
    const before = serializeDesign(d), pending = draft(d, "shore", { owner: n.id });
    assert.equal(defaultFunction("coast"), undefined); assert.equal(serializeDesign(d), before);
    pending.nodes = geometryPath(n, 0)!.nodes.map(v => penNode(pending.nextId(), [...v.p]));
    historyEdit(d, () => {
        finishDraft(d, t, pending); assert(n.function.type === "coast" && n.function.roughness === 6);
    });
    historyEdit(d, () => {
        finishDraft(d, t, { ...pending, tool: "slopeLine" });
        assert(n.function.type === "slope" && n.function.kind === "path");
        assert.deepEqual(n.function.line.points.map(v => v.h !== undefined), [true, false, false, true]);
    });
});

test("Canceling a required shore or slope in the editor keeps its original function and history", async () => {
    await import("../configs/register-svelte.ts");
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), d = syntheticDesign(), node = d.geoNodes[1];
    Object.assign(editor, { island: new Island(d), map: { draw() {}, clearIssue() {} } });
    editor.history = new History(d);
    editor.select({ kind: "geoNode", id: node.id });
    const saved = serializeDesign(d);
    for (const [type, tool] of [["coast", "shore"], ["slope", "slopeLine"]] as const) {
        editor.switchFunction(node, type);
        assert.equal(editor.map.draft?.tool, tool);
        editor.setTool("select");
        assert.equal(editor.map.draft, undefined);
        assert.equal(serializeDesign(editor.island.design), saved);
        assert.equal(editor.history.index, 0);
    }
});

test("Erosion defaults match the example parameters with unit strength", fixtureOptions("round14-coast.json"), async () => {
    const d = parseDesign(await readFixture("round14-coast.json"));
    const f = d.geoNodes.find(n => n.function.type === "erosion")!.function;
    assert.deepEqual(defaultFunction("erosion"), { ...f, strength: 1, floor: -1000 });
});

test("Disabled layers match deletion byte for byte and active strips can still use disabled outlines", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], cache = new TerrainCache();
    const extra = layer("X", rect(1, 3, 6, 8), { type: "ground", value: 9 }); d.geoNodes.push(extra); d.fields.f = { default: 3 };
    function same(a: ReturnType<typeof generateTerrain>, b: ReturnType<typeof generateTerrain>) {
        assert.deepEqual(a.defined, b.defined);
        for (const field of Object.keys(a.fields)) assert.deepEqual(new Uint8Array(a.fields[field].buffer), new Uint8Array(b.fields[field].buffer));
    }
    for (const target of [n, d.geoNodes[0], extra]) {
        const without = { ...d, geoNodes: d.geoNodes.filter(v => v !== target) };
        cache.generate(d);
        historyEdit(d, () => enableGeo(target, false));
        same(cache.generate(d), generateTerrain(without));
        historyEdit(d, () => enableGeo(target, true));
        assert(!Object.hasOwn(target, "disabled")); same(cache.generate(d), generateTerrain(d));
        historyEdit(d, () => enableGeo(target, false)); same(cache.generate(d), generateTerrain(d));
        enableGeo(target, true);
    }
    const band = createStrip(d, [n.id], "height");
    enableGeo(n, false);
    const island = new Island(d);
    assert(island.terrain.regions.get(band.id)!.cells.length > 0);
    assert(!island.issues.some(i => i.geoNode === n.id));
    assert(!exportIsland(island, { commit: "", sha256: "" }).issues.some(i => i.geoNode === n.id));
    for (const bad of [false, null, 0, "true"]) assert.throws(() => parseDesign({ ...d, geoNodes: [{ ...n, disabled: bad }] }), /disabled/);
    for (const g of d.geoNodes) enableGeo(g, false);
    assert(!new Island(d).terrain.defined.some(Boolean));
});

test("Curves, handles, tangency, insertion and six-pixel snap use the editable geometry", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], path: Path = geometryPath(n, 0)!, t = generateTerrain(d);
    const near: Point = [path.nodes[0].p[0] + .5, path.nodes[0].p[1] + .5];
    assert.deepEqual(snapPoint(t, d, near, 5), path.nodes[0].p);
    assert.deepEqual(snapPoint(t, d, [-16, -14.5], 5), [-16, -14]);
    historyEdit(d, () => setSegment(path, 1, "tangent"));
    assert.equal(path.nodes[1].next, "arc"); assert(Math.abs(path.nodes[1].bulge! - 1) < 1e-6);
    historyEdit(d, () => {
        insertPathNode(path, 1, arcHandle(path.nodes[1].p, path.nodes[2].p, 1), nodeIds(d)());
    });
    const before = path.nodes.length;
    historyEdit(d, () => {
        setSegment(path, 2, "curve");
    });
    historyEdit(d, () => {
        moveHandle(path, 2, "out", [-10, -8], false);
    });
    assert.equal(path.nodes[2].mode, "manual"); assert.equal(path.nodes.length, before);
    historyEdit(d, () => {
        moveHandle(path, 2, "in", [-11, -8], true);
    }); assert.equal(path.nodes[2].mode, "corner");
});

test("Profile spans share exported steps, omit stair grades and measure the final graded lattice", () => {
    const { grid, road } = syntheticRoads(), r = road("P", "a", "b", [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]);
    const t = generateTerrain(syntheticDesign()); t.grid = grid; t.defined = new Uint8Array(grid.size).fill(1);
    const h = Float32Array.from(t.defined, (_, k) => {
        const [x, y] = grid.point(k); return x * .2 + y * .4;
    });
    Object.assign(r, { s: Float64Array.from([0, 1, 2, 3, 4, 5, 6]), length: 6, h: [0, .3, .7, 1.1, 1.3, 1.31, 1.6],
        points: Array.from({ length: 7 }, (_, i) => [i, 0]), stairs: [false, true, true, false, false, false], peaks: [.3, .4, .4, .25, .26, .01], grades: [.2, .4, .4, .22, .21, .01] });
    r.edge.maxGrade = .2;
    const data = longitudinal(r, t, h);
    assert.deepEqual(data.flights, exportFlights(r)); assert.deepEqual(data.flights.map(f => [f.from, f.to, f.steps]), [[1, 3, 5]]);
    assert.deepEqual(data.excess, [{ start: 0, end: 1, max: .3 }, { start: 3, end: 5, max: .26 }]);
    assert.deepEqual(data.ground, r.points.map(p => sample(grid, h, ...p)));
    assert(Math.abs(profileReading(r, 3.25, t, h, 1).grade - .25) < 1e-9);
    const reading = profileReading(r, 3.5, t, h, 1); assert.equal(reading.ground, sample(grid, h, 3.5, 0)); assert.equal(reading.gap, reading.road - reading.ground!);
    assert.deepEqual([.01, .22, 1.1, 2.3, 5.1, 23].map(niceStep), [.01, .25, 2, 2.5, 10, 25]);
});