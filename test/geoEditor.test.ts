import { test } from "node:test";
import { bindField, bindHeight, resolved } from "./expressionHelpers.ts";
import assert from "node:assert/strict";
import { fixtureOptions, readFixture } from "../configs/read-fixture.ts";
import { syntheticDesign, rect, layer } from "./scenarios.ts";
import { type Design, type GeoFunction, type Path, type Point } from "../src/core/design/v5.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { History } from "../src/core/edit/history.ts";
import { addField, addInput, copyGeo, createStrip, removalUses, removalUseName, defaultFunction, deleteGeo, stripUsers, enableGeo,
    nodeIds, rangeUsers, removeDeclaration, reorderGeo, stripRange } from "../src/core/edit/geoNodes.ts";
import { arcHandle, moveHandle, penNode, setSegment, translateGeo } from "../src/core/edit/paths.ts";
import { flattenPath } from "../src/core/design/path.ts";
import { geoControls, geometryPath, insertPathNode, removeGeometryItem } from "../src/core/edit/geoControls.ts";
import { finishDraft, snapPoint, type GeoDraft, type DrawTool } from "../src/app/state/geoTools.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { Project } from "../src/core/project.ts";
import { exportProject } from "../src/core/export.ts";
import { niceStep } from "../src/core/math/interval.ts";

function historyEdit(d: Design, edit: () => void) {
    const before = serializeDesign(d), history = new History(d);
    edit();
    const after = serializeDesign(d);
    assert(history.record(d), "one changed state");
    assert.equal(serializeDesign(history.step(false)), before);
    assert.equal(serializeDesign(history.step(true)), after);
}
function draft(tool: DrawTool, options: Partial<GeoDraft> = {}): GeoDraft {
    return { tool, ids: [], nodes: [], anchors: [], reverse: false, ...options };
}

test("Closed tools add one unit to height and insert above the selection with one history step", () => {
    for (const tool of ["rect", "circle", "sector", "pen"] as const) {
        const d = syntheticDesign(), [ground, terrace] = d.geoNodes;
        const t = generateTerrain(d), make = draft(tool, { ids: [ground.id], start: [2, 2], radius: [5, 4], cursor: [2, 6] });
        make.nodes = [penNode("", [1, 1]), penNode("", [5, 1], [6, 2]), penNode("", [4, 6])];
        historyEdit(d, () => {
            const n = finishDraft(d, t, make), path = geometryPath(n, 0)!;
            assert.deepEqual(d.geoNodes, [ground, n, terrace]);
            assert.equal(n.field, "height"); assert.deepEqual(n.function, { type: "flat", amount: 1, feather: 0 });
            assert(path.closed);
            assert.deepEqual(path.nodes.map(v => v.next ?? "curve"), { rect: ["line", "line", "line", "line"], circle: ["arc", "arc"], sector: ["line", "arc", "line"], pen: ["curve", "curve", "line"] }[tool]);
            if (tool === "circle") assert.deepEqual(path.nodes.map(v => v.bulge), [1, 1]);
            if (tool === "pen") {
                assert.equal(path.nodes[1].mode, "manual"); assert.deepEqual(path.nodes[1].in, [-1, -1]);
            }
            assert.equal(new Set(path.nodes.map(v => v.id)).size, path.nodes.length);
        });
        const off = finishDraft(d, t, draft("rect", { start: [100, 100], cursor: [110, 111] }));
        assert.equal(d.geoNodes.at(-1), off); assert.deepEqual(off.function, { type: "flat", amount: 1, feather: 0 });
    }
});

test("Strip direction, whole outlines, shared edges, ordering and referenced deletion survive history", () => {
    const d = syntheticDesign(), [lower, upper] = d.geoNodes, t = generateTerrain(d);
    const options = { ids: [upper.id], anchors: ["0", "2"] };
    for (const [anchors, reverse, expected] of [[[], false, undefined], [["0", "2"], false, { from: "0", to: "2" }], [["0", "2"], true, { from: "2", to: "0" }]] as const) {
        historyEdit(d, () => {
            const n = finishDraft(d, t, draft("strip", { ...options, anchors: [...anchors], reverse }));
            assert(n.construction.type === "strip"); assert.deepEqual(n.construction.range, expected);
            assert.deepEqual(n.construction.widths, [0, 6]); assert.equal(n.function.type, "blend");
        });
    }
    assert.throws(() => stripRange(["0"]), /起点和终点/);
    historyEdit(d, () => {
        const n = createStrip(d, [lower.id, upper.id], stripRange(options.anchors));
        assert.equal(d.geoNodes[2], n); assert.equal(n.function.type, "split");
        assert(n.construction.type === "strip"); assert.deepEqual(n.construction.widths, [1, 1]);
    });
    const saved = serializeDesign(d), dependent = stripUsers(d, upper.id);
    assert.equal(dependent.length, 4);
    assert.throws(() => reorderGeo(d, dependent[0].id, 0), /条带必须在它引用的地件之上/);
    assert.throws(() => deleteGeo(d, upper.id), /仍被引用/); assert.equal(serializeDesign(d), saved);
    historyEdit(d, () => reorderGeo(d, dependent[0].id, d.geoNodes.length - 1));
    historyEdit(d, () => {
        for (const ref of dependent) assert(deleteGeo(d, ref.id));
        assert(deleteGeo(d, upper.id)); assert.deepEqual(d.geoNodes, [lower]);
    });
});

test("Declarations report all writers, nested inputs and marks, and bindings retain their effective values", () => {
    const d = syntheticDesign();
    let variable = "", field = "";
    historyEdit(d, () => {
        variable = addInput(d, 8);
    });
    historyEdit(d, () => {
        field = addField(d);
    });
    const n = d.geoNodes[1], fieldBase = layer("F", d.geoNodes[0].construction, { type: "ground", value: 3 }, field);
    d.geoNodes.unshift(fieldBase);
    historyEdit(d, () => {
        n.function = { type: "flat", amount: bindHeight(variable) };
    });
    historyEdit(d, () => {
        n.function = { type: "flat", amount: bindHeight(variable, -2) };
    });
    const fieldInput = (field: string) => new Project(d).inputAt(n.id, field, [0, 0]);
    historyEdit(d, () => {
        assert(n.function.type === "flat");
        n.function.amount = resolved(n.function.amount, d, fieldInput); assert.equal(n.function.amount, 6);
    });
    historyEdit(d, () => {
        n.function = { type: "noise", amplitude: bindField(field), scale: 4 };
    });
    historyEdit(d, () => {
        assert(n.function.type === "noise"); n.function.amplitude = bindField(field, .5, 2);
    });
    const cover = layer("Q", rect(-5, -5, 5, 5), { type: "flat", amount: 17 }); cover.field = field;
    d.geoNodes.push(cover);
    assert.equal(new Project(d).terrain.fields[field].values.includes(20), true);
    historyEdit(d, () => {
        assert(n.function.type === "noise"); n.function.amplitude = resolved(n.function.amplitude, d, fieldInput); assert.equal(n.function.amplitude, 3.5);
    });
    d.geoNodes.pop();
    d.geoNodes.shift();
    d.geoNodes.push(layer("B", rect(1, 1, 8, 8), { type: "mountain", ridges: [], peaks: [{ at: { p: [2, 2], h: bindHeight(variable) }, radius: 3, scale: 1, noise: 0 }], floor: bindHeight(variable) }));
    d.marks.push({ id: "C", label: "C", kind: "text", point: [2, 2], follow: "map", elevation: bindHeight(variable), showElevation: true });
    n.function = { type: "noise", amplitude: bindField(field), scale: 3 }; n.field = field;
    for (const [kind, id, count] of [["input", variable, 3], ["field", field, 2]] as const) {
        const uses = removalUses(d, kind, id).map(removalUseName), before = serializeDesign(d);
        assert.equal(uses.length, count); assert.equal(new Set(uses).size, count);
        assert.throws(() => removeDeclaration(d, kind, id), e => e instanceof Error && uses.every(v => e.message.includes(v)));
        assert.equal(serializeDesign(d), before);
    }
    const other = addInput(d);
    historyEdit(d, () => removeDeclaration(d, "input", other));
    assert.throws(() => removeDeclaration(d, "field", "height"), /内置/);
});

test("Copies regenerate paths and preserve references, geometry moves together and range damage stays repairable", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], path = geometryPath(n, 0)!;
    const strip = createStrip(d, [n.id], { from: path.nodes[0].id, to: path.nodes[2].id });
    historyEdit(d, () => {
        const copy = copyGeo(d, n), originalIds = d.geoNodes.filter(v => v !== copy).flatMap(v => geometryPath(v, 0)?.nodes.map(v => v.id) ?? []);
        assert.notEqual(copy.id, n.id); assert.deepEqual(copy.function, n.function); assert.equal(copy.label, n.label + " 副本");
        assert(geometryPath(copy, 0)!.nodes.every(v => !originalIds.includes(v.id))); assert.equal(d.geoNodes[d.geoNodes.indexOf(n) + 1], copy);
        assert.deepEqual(stripUsers(d, n.id), [strip]); assert.deepEqual(stripUsers(d, copy.id), []);
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
    const m = new Project(parseDesign(d, true));
    assert.equal(m.issues.filter(i => i.kind === "geo-reference").length, 2);
    n.function = { type: "slope", kind: "radial", center: [1, 2], radius: 2, rate: .1, value: 3 };
    historyEdit(d, () => {
        translateGeo(n, [4, 5]); assert(n.function.type === "slope" && n.function.kind === "radial"); assert.deepEqual(n.function.center, [5, 7]);
    });
});

test("Function defaults preserve construction and drawn geometry retains its authored heights", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], construction = structuredClone(n.construction), t = generateTerrain(d);
    const defaults: GeoFunction[] = [{ type: "ground", value: 0 }, { type: "mountain", peaks: [], ridges: [], floor: -1000 }, { type: "cliff", factor: .6, seaLevel: 0 },
        { type: "islets", density: .5, reach: 12, threshold: .45, seaLevel: 0 }, { type: "flat", amount: 1, feather: 0 }, { type: "noise", amplitude: 1, scale: 24, octaves: 5, feather: 0 }];
    for (const f of defaults) historyEdit(d, () => {
        n.function = defaultFunction(f.type)!; assert.deepEqual(n.function, ["mountain", "cliff", "islets", "noise"].includes(f.type) ? { ...f, seed: "{input:seed}" } : f); assert.deepEqual(n.construction, construction);
    });
    for (const f of [{ type: "blend" }, { type: "split" }, { type: "batter", grade: .5 } ] as const) assert.deepEqual(defaultFunction(f.type), f);
    const erosion = defaultFunction("erosion"); assert(erosion?.type === "erosion" && erosion.strength === 1 && Number(erosion.droplets) > 0 && erosion.floor === -1000);
    const before = serializeDesign(d), pending = draft("shore", { owner: n.id });
    assert.equal(serializeDesign(d), before);
    pending.nodes = geometryPath(n, 0)!.nodes.map(v => penNode("", [...v.p]));
    historyEdit(d, () => {
        finishDraft(d, t, pending); assert(n.function.type === "coast" && n.function.roughness === 6);
    });
    historyEdit(d, () => {
        finishDraft(d, t, { ...pending, tool: "slopeLine" });
        assert(n.function.type === "slope" && n.function.kind === "path");
        assert.deepEqual(n.function.line.points.map(v => v.h !== undefined), [true, false, false, true]);
        assert.deepEqual(n.function.line.points.map(v => v.h), [0, undefined, undefined, 2]);
    });
    historyEdit(d, () => {
        finishDraft(d, t, { ...pending, tool: "center" });
        assert.deepEqual(n.function, { type: "slope", kind: "radial", center: pending.nodes[0].p, radius: 5, value: 2, rate: -.2 });
    });
});

for (const construction of ["free", "strip"] as const) test("Default shore and slope switch immediately on " + construction + " regions", async t => {
    await import("../configs/register-svelte.ts");
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), d = syntheticDesign(), source = d.geoNodes[1];
    t.mock.method(editor, "working", async (_label: string, work: () => void) => work());
    const n = construction === "strip" ? createStrip(d, [source.id], { from: "0", to: "1" }) : source;
    Object.assign(editor, { project: new Project(d), map: { draw() {}, clearIssue() {}, setProject() {} } });
    editor.history = new History(d);
    editor.select({ kind: "geoNode", id: n.id });
    const saved = serializeDesign(d);
    for (const type of ["coast", "slope"] as const) {
        await editor.switchFunction(n, type);
        const f = editor.project.design.geoNodes.find(v => v.id === n.id)!.function;
        assert.equal(editor.tool, "select");
        assert.equal(editor.map.draft, undefined);
        assert.equal(f.type, type);
        if (f.type === "coast") {
            assert(f.shore.nodes.length >= 4);
            if (construction === "free") assert.deepEqual(f.shore.nodes.map(v => v.p), [[-20.3, -13.4], [-7.7, -13.4], [-7.7, -2.5999999999999996], [-20.3, -2.5999999999999996]]);
            else assert.notDeepEqual(f.shore.nodes.map(v => v.p), source.construction.type === "free" && source.construction.paths[0].nodes.map(v => v.p));
        }
        else {
            assert(f.type === "slope" && f.kind === "path");
            assert.deepEqual(f.line.points.map(p => p.h), [0, 2]);
            const shape = editor.project.terrain.regions.get(n.id)!.shape;
            assert(f.line.points.every(v => shape.contains(v.p)));
            if (construction === "free") assert.deepEqual(f.line.points.map(v => v.p), [[-19.6, -8], [-8.4, -8]]);
            await editor.switchFunction(n, "slope", "radial");
            const radial = editor.project.design.geoNodes.find(v => v.id === n.id)!.function;
            assert(radial.type === "slope" && radial.kind === "radial");
            if (construction === "free") assert.deepEqual(radial.center, [-14, -8]);
            await editor.navigate(false);
        }
        assert.equal(editor.history.index, 1);
        await editor.navigate(false);
        assert.equal(serializeDesign(editor.project.design), saved);
    }
});

test("Erosion defaults match the example parameters with unit strength", fixtureOptions("round14-coast.json"), async () => {
    const d = parseDesign(await readFixture("round14-coast.json"));
    const f = d.geoNodes.find(n => n.function.type === "erosion")!.function;
    assert.deepEqual(defaultFunction("erosion"), { ...f, strength: 1, floor: -1000 });
});

test("Disabled layers match deletion byte for byte and active strips can still use disabled outlines", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], cache = new TerrainCache();
    const extra = layer("X", rect(1, 3, 6, 8), { type: "ground", value: 9 }); d.geoNodes.push(extra); d.fields.f = { label: "F" };
    function same(a: ReturnType<typeof generateTerrain>, b: ReturnType<typeof generateTerrain>) {
        assert.deepEqual(a.fields.height.defined, b.fields.height.defined);
        for (const field of Object.keys(a.fields)) {
            assert.deepEqual(new Uint8Array(a.fields[field].values.buffer), new Uint8Array(b.fields[field].values.buffer));
            assert.deepEqual(a.fields[field].defined, b.fields[field].defined);
        }
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
    const band = createStrip(d, [n.id]);
    enableGeo(n, false);
    const project = new Project(d);
    assert(project.terrain.regions.get(band.id)!.cells.length > 0);
    assert(!project.issues.some(i => i.geoNode === n.id));
    assert(!exportProject(project, { commit: "", sha256: "" }).issues.some(i => i.geoNode === n.id));
    for (const bad of [false, null, 0, "true"]) assert.throws(() => parseDesign({ ...d, geoNodes: [{ ...n, disabled: bad }] }), /disabled/);
    for (const g of d.geoNodes) enableGeo(g, false);
    assert(!new Project(d).terrain.fields.height.defined.some(Boolean));
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

test("Contour intervals round up to readable steps", () => {
    assert.deepEqual([.01, .22, 1.1, 2.3, 5.1, 23].map(niceStep), [.01, .25, 2, 2.5, 10, 25]);
});

test("Removing a mountain member keeps references to siblings and reports references to the removed member", () => {
    const d = syntheticDesign(), m = d.geoNodes[1];
    m.function = { type: "mountain", ridges: [], peaks: [2, 4, 6].map(h => ({ at: { p: [h, 3], h }, radius: 2, scale: 3, noise: 0 })) };
    d.inputs.B = { range: defaultInputRange("B"), value: 1 };
    const v: Design = d;
    v.inputs.B.value = "{geo:T.peaks.2.at.h} - {geo:T.peaks.0.radius}";
    const before = serializeDesign(d);
    assert.throws(() => removeGeometryItem(d, m, ["peaks"], 0), /仍被引用[\s\S]*“B”/);
    assert.equal(serializeDesign(d), before);
    removeGeometryItem(d, m, ["peaks"], 1);
    assert.equal(v.inputs.B.value, "{geo:T.peaks.1.at.h} - {geo:T.peaks.0.radius}");
    assert.equal(new Project(d).resolved.inputs.B.value, 4);
});

test("An arc with omitted bulge uses the editor's quarter-turn in sampling and handles", () => {
    const d = syntheticDesign(), n = d.geoNodes[0], construction = n.construction;
    assert(construction.type === "free");
    const path = construction.paths[0], v = path.nodes[0];
    v.next = "arc";
    const omitted = flattenPath(path, .02), control = geoControls(n).find(h => h.role === "arc");
    assert(control);
    setSegment(path, 0, "arc");
    assert.deepEqual(flattenPath(path, .02), omitted);
    assert.deepEqual(geoControls(n).find(h => h.role === "arc"), control);
    delete v.bulge;
    assert.doesNotThrow(() => parseDesign(d));
    v.bulge = 0;
    assert.throws(() => parseDesign(d), /bulge/);
});