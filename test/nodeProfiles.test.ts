import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { expressionGraph, resolveDesign } from "../src/core/design/parameters.ts";
import { numericProfile } from "../src/core/design/polyline.ts";
import { sampleField } from "../src/core/design/results.ts";
import { type Design, type Expression, type Point } from "../src/core/design/v5.ts";
import { setCurveOverride } from "../src/core/edit/curveEdits.ts";
import { removeCurveNode } from "../src/core/edit/geoControls.ts";
import { defaultFunction } from "../src/core/edit/geoNodes.ts";
import { History } from "../src/core/edit/history.ts";
import { mountainProfile } from "../src/core/terrain/mountain.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { testTerrainClient } from "./computeFixture.ts";
import { fixtureMark, addLayer, openCurve, rect, syntheticDesign, fixtureCurve } from "./scenarios.ts";

test("Each curve quantity interpolates from its own stops and an override keeps the same address", () => {
    const d: Design = syntheticDesign();
    const n = d.geoNodes[1], key = "geo:T.ridges.0";
    const curve = openCurve([
        { p: [0, 0], h: 4, slope: 1 },
        { p: [1, 0], h: 99, slope: 2, interpolate: ["h"] },
        { p: [3, 0], h: 12, slope: 99, interpolate: ["slope"] },
        { p: [4, 0], h: 12, slope: 4 }
    ]);
    n.function = { type: "mountain", ridges: [fixtureCurve(d, { curve }, ["h", "slope"])], valleys: [], peaks: [] };
    d.inputs.reader = { value: "{" + key + ".h.node-1}", range: defaultInputRange("reader") };
    const h = key + ".h.node-1", slope = key + ".slope.node-2";
    const graph = expressionGraph(d), f = resolveDesign(parseDesign(d)).geoNodes[1].function;
    assert(f.type === "mountain");
    const line = f.ridges[0].curve;
    assert.equal(graph.get(h), 4 + 8 * (7 / 27));
    assert.equal(graph.get(h), numericProfile(line, .125).nodeValue(1, true));
    assert.equal(graph.get(slope), numericProfile(line, .125, "slope").nodeValue(2, true));
    assert.notEqual(graph.get(slope), 99);
    assert(graph.slots.get(h)?.output);

    const stored = () => {
        const design = JSON.parse(serializeDesign(d));
        const line = design.geoNodes[1].function.ridges[0];
        return { h: line.h["node-1"], interpolate: line.interpolate?.["node-1"] };
    };
    setCurveOverride(d, key + ".curve", 1, "h", true);
    assert.equal(expressionGraph(d).get("input:reader"), 99);
    assert.equal(stored().interpolate, undefined);
    setCurveOverride(d, key + ".curve", 1, "h", false);
    assert.equal(expressionGraph(d).get("input:reader"), graph.get(h));
    assert.equal(stored().h, 99);
    assert.deepEqual(stored().interpolate, ["h"]);
    setCurveOverride(d, key + ".curve", 1, "h", true);
    assert.equal(expressionGraph(d).get(h), 99);
});

test("Closed profiles interpolate across the join and a single explicit stop remains constant", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], key = "geo:T.valleys.0";
    const curve = openCurve([
        { p: [0, 0], h: 4, slope: .5 }, { p: [2, 0], h: 99, interpolate: ["h"] },
        { p: [2, 2], h: 12 }, { p: [0, 2] }
    ]);
    curve.closed = true;
    n.function = { type: "mountain", ridges: [], valleys: [fixtureCurve(d, { curve }, ["h", "slope"])], peaks: [] };
    const graph = expressionGraph(parseDesign(d));
    assert.equal(graph.get(key + ".h.node-1"), 8);
    assert.equal(graph.get(key + ".h.node-3"), 8);
    for (let i = 0; i < 4; i++) assert.equal(graph.get(key + ".slope.node-" + i), .5);
    const f = resolveDesign(d).geoNodes[1].function;
    assert(f.type === "mountain");
    const slope = numericProfile(f.valleys[0].curve, .125, "slope");
    for (const station of [0, 1, 2.5, 4, 7, 8]) assert.equal(slope.value(station, true), .5);
    const stored = n.function.valleys[0];
    assert("curve" in stored);
    stored.interpolate!["node-0"] = ["h"];
    assert.throws(() => parseDesign(d), /第一个节点必须写明高度/);
});

test("Deleting an endpoint promotes its neighbor at the old reading and preserves the unchanged span", () => {
    const d = syntheticDesign();
    const slope = defaultFunction(d, "slope", { center: [2, 0] });
    assert(slope.type === "slope");
    const curve = openCurve([{ p: [-4, 0], h: 0 }, { p: [0, 0], h: 40, interpolate: ["h"] }, { p: [4, 0], h: 8 }]);
    slope.lines.push(fixtureCurve(d, { curve }, ["h"]));
    const n = addLayer(d, "S", rect(0, -2, 4, 2), slope);
    d.geoNodes.push(n);
    const history = new History(d), expected = generateTerrain(d).fields.height;
    removeCurveNode(d, n, { role: "vertex", path: -1, index: 0, point: [-4, 0] });
    assert(n.function.type === "slope" && "curve" in n.function.lines[0]);
    const next = n.function.lines[0];
    assert.equal(next.h?.["node-1"], 4);
    assert.equal(next.interpolate, undefined);
    assert.deepEqual(generateTerrain(parseDesign(d)).fields.height, expected);
    assert(history.record(d));
    assert.deepEqual(generateTerrain(history.step(false)!).fields.height, expected);
});

test("Slope cells use the closest profile and prefer the earlier profile at an equal distance", () => {
    const d = syntheticDesign(), f = defaultFunction(d, "slope", { center: [0, 0] });
    assert(f.type === "slope");
    d.geoNodes[1].function = { type: "flat", amount: 0 };
    const baseline = generateTerrain(d);
    d.geoNodes.push({ ...addLayer(d, "S", rect(-6, -6, 8, 6), f), function: f });
    assert.deepEqual(generateTerrain(parseDesign(d)).fields.height, baseline.fields.height);
    f.lines.push(fixtureCurve(d, { curve: openCurve([{ p: [-1.5, -2.5], h: 0 }, { p: [6.5, -2.5], h: 8 }]) }, ["h"]));
    const one = generateTerrain(parseDesign(d));
    for (let y = -5.5; y < 6; y++) for (let x = -5.5; x < 8; x++)
        assert.equal(sampleField(one, "height", [x, y]), 4 + Math.max(0, Math.min(8, x + 1.5)));
    f.lines.push(fixtureCurve(d, { curve: openCurve([{ p: [-1.5, 1.5], h: 10 }, { p: [6.5, 1.5], h: 18 }]), ease: true }, ["h"]));
    const two = generateTerrain(parseDesign(d));
    assert.equal(sampleField(two, "height", [.5, -1.5]), 6);
    assert.equal(sampleField(two, "height", [.5, -.5]), 6);
    assert.equal(sampleField(two, "height", [.5, .5]), 15.25);
});

test("Valleys can carve below the lower field and the mountain floor still applies", () => {
    const d = syntheticDesign(), f = defaultFunction(d, "mountain");
    assert(f.type === "mountain");
    f.footRound = 0;
    f.valleys.push(fixtureCurve(d, { curve: openCurve([{ p: [-2.5, .5], h: -3, slope: 1 }, { p: [4.5, .5], h: -3, slope: 1 }]) }, ["h", "slope"]));
    d.geoNodes[1].function = { type: "flat", amount: 0 };
    d.geoNodes.push({ ...addLayer(d, "M", rect(-6, -6, 8, 6), f), function: f });
    const carved = generateTerrain(parseDesign(d));
    assert.equal(sampleField(carved, "height", [.5, .5]), -3);
    assert((sampleField(carved, "height", [.5, 2.5]) ?? -Infinity) > -3);
    f.floor = 4;
    assert.equal(sampleField(generateTerrain(parseDesign(d)), "height", [.5, .5]), 4);
});

test("Constant node slope reproduces the former ridge and varying slope produces an intermediate flank", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], slope = .75, radius = 4;
    const ridge = openCurve<number>([{ p: [0, 0], slope, h: 18 }, { p: [10, 0], slope, h: 18 }]);
    n.function = { type: "mountain", crestRound: radius, footRound: 5, ridges: [fixtureCurve(d, { curve: ridge }, ["h", "slope"])], valleys: [], peaks: [] };
    const render = () => {
        const f = resolveDesign(parseDesign(d)).geoNodes[1].function;
        assert(f.type === "mountain");
        return mountainProfile(f, .125, 0);
    };
    const previous = (distance: number, ground: number) => {
        const normal = Math.hypot(1, slope), tangent = radius * (slope / normal), drop = radius * (1 - 1 / normal);
        const top = 18 - (distance < tangent ? radius * (1 - Math.sqrt(1 - (distance / radius) ** 2)) : drop + (distance - tangent) * slope);
        const highest = Math.max(ground, top), gap = Math.abs(ground - top);
        return gap >= 5 ? highest : highest + (5 - gap) ** 2 / 20;
    };
    const fixed = render();
    for (let y = 0; y <= 30; y += .125) assert.equal(fixed(5, y, 4), previous(y, 4));
    const held = n.function.ridges[0];
    assert("curve" in held);
    held.slope!["node-1"] = 1.75;
    const varying = render(), left = varying(0, 5, 4), right = varying(10, 5, 4);
    assert(left > varying(5, 5, 4) && varying(5, 5, 4) > right);
});

test("Visibility switches block readers while dormant values and newly authored erosion spacing persist", async () => {
    await import("../configs/register-svelte.ts");
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d: Design = syntheticDesign();
    const n = d.geoNodes[1], input = (value: Expression) => ({ value, range: defaultInputRange("reader") });
    d.marks.push(fixtureMark(d, { id: "R", kind: "scale", label: "A", point: [5, 5], follow: "map", length: 17 }));
    d.inputs.reader = input("{mark:R.length}");
    const editor = new Editor(testTerrainClient());
    Object.assign(editor, { map: { frame() {}, visibleMarkPoint: (mark: { point: Point }) => mark.point, world: (x: number, y: number) => [x, y] } });
    await editor.replace(d, true);
    editor.history = new History(d);
    editor.setMarkFollow("R", "screen");
    assert.equal(editor.removal?.title, "无法改为跟随屏幕");
    assert.equal(editor.project.design.marks[0].follow, "map");

    await editor.edit(draft => {
        draft.inputs.reader.value = "{geo:T.feather}";
    });
    await editor.setMarkFollow("R", "screen");
    assert(!editor.numberEdits.slots.has("mark:R.length"));
    assert.equal(JSON.parse(serializeDesign(editor.project.design)).marks[0].length, 17);
    editor.switchFunction(n, "erosion");
    assert.equal(editor.removal?.title, "无法切换函数");
    assert.equal(editor.project.design.geoNodes[1].function.type, "flat");
    await editor.edit(draft => {
        delete draft.inputs.reader;
    });
    await editor.switchFunction(n, "erosion");
    assert.equal(JSON.parse(serializeDesign(editor.project.design)).geoNodes[1].function.spacing, "{geo:T.radius} / 2");

    await editor.switchFunction(n, "slope", "radial");
    await editor.edit(draft => {
        const f = draft.geoNodes[1].function;
        assert(f.type === "slope");
        f.radius = 12;
        f.lines.push(fixtureCurve(draft, { curve: openCurve([{ p: [-20, -6], h: 1 }, { p: [-8, -6], h: 7 }]) }, ["h"]));
        draft.inputs.reader = input("{geo:T.radius}");
    });
    const authored = () => JSON.parse(serializeDesign(editor.project.design)).geoNodes[1].function;
    const radial = authored();
    editor.switchFunction(n, "slope", "path");
    assert.equal(editor.removal?.title, "无法切换坡面形式");
    assert.deepEqual(authored(), radial);
    assert(!editor.numberEdits.slots.has("geo:T.lines.0.h.node-0"));
    await editor.edit(draft => {
        delete draft.inputs.reader;
    });
    await editor.switchFunction(n, "slope", "path");
    assert.deepEqual(authored(), { ...radial, kind: "path" });
    assert(!editor.numberEdits.slots.has("geo:T.radius"));
    await editor.edit(draft => {
        draft.inputs.reader = input("{geo:T.lines.0.h.node-0}");
    });
    editor.switchFunction(n, "slope", "radial");
    assert.equal(editor.removal?.title, "无法切换坡面形式");
    await editor.edit(draft => {
        delete draft.inputs.reader;
    });
    await editor.switchFunction(n, "slope", "radial");
    assert.deepEqual(authored(), radial);
});

test("The parser rejects removed holder fields and a missing mandatory slope-line increment", () => {
    const d = syntheticDesign(), n = d.geoNodes[1];
    const curve = openCurve([{ p: [0, 0], h: 0 }, { p: [2, 0] }]);
    const f = defaultFunction(d, "slope", { center: [0, 0] });
    assert(f.type === "slope");
    f.lines.push(fixtureCurve(d, { curve }, ["h"]));
    n.function = f;
    assert.throws(() => parseDesign(d), /首尾节点必须写明增量/);
    const line = f.lines[0];
    assert("curve" in line);
    line.h!["node-1"] = 2;
    for (const [key, value] of [["line", f.lines[0]], ["ease", true]] as const)
        assert.throws(() => parseDesign({ ...d, geoNodes: [d.geoNodes[0], { ...n, function: { ...f, [key]: value } }] }), /请在 lines 中写入坡线及其设置/);
});