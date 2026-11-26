import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { finishCurveDraft } from "../src/app/state/geoTools.ts";
import { curveGraph, isHolderRef } from "../src/core/design/curveReferences.ts";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { numberEdits } from "../src/core/design/numberEdit.ts";
import { expressionGraph, resolveDesign, writeAt } from "../src/core/design/parameters.ts";
import { type Design, type Point, type ResolvedDesign } from "../src/core/design/v5.ts";
import { editCurveSource, setCurveReference } from "../src/core/edit/curveEdits.ts";
import { commitControl, controlPreview, copyGeometryItem, geometryPath, removeCurveNode, removeGeometryItem, type GeoControl } from "../src/core/edit/geoControls.ts";
import { copyGeo, deleteGeo, removeDeclaration } from "../src/core/edit/geoNodes.ts";
import { History } from "../src/core/edit/history.ts";
import { penNode, retractHandle } from "../src/core/edit/paths.ts";
import { type GeoDraft } from "../src/core/edit/types.ts";
import { Project } from "../src/core/project.ts";
import { layer, literalCurve, openCurve, rect, syntheticDesign } from "./scenarios.ts";

const outline = (id: string, i = 0) => "geo:" + id + ".construction.outlines." + i;
const ridge = (id: string, i = 0) => "geo:" + id + ".ridges." + i;
const shape = (key: string) => key + ".curve";
const ref = (key: string) => ({ ref: "{" + key + "}" });
const selection = (id: string) => ({ kind: "geoNode" as const, id });
const base = rect(-22, -15, -7, -2).outlines[0].curve;
const line = openCurve<number>([{ p: [-16, -12], h: 14 }, { p: [-11, -10] }, { p: [-9, -3], h: 22 }], "auto", "v");
const body: GeoControl = { role: "body", path: 0, index: 0, point: [0, 0] };
const geo = <N extends { id: string }>(d: { geoNodes: N[] }, id: string) => d.geoNodes.find(n => n.id === id)!;
const positions = (d: ResolvedDesign, id: string, path = 0) => geometryPath(geo(d, id), path)!.nodes.map(n => n.p);
const offset = (points: Point[], [x, y]: Point) => points.map(([a, b]): Point => [a + x, b + y]);

function fixture(): Design {
    const d = syntheticDesign();
    const first = geo(d, "T");
    first.construction = { type: "outline", outlines: [{ curve: structuredClone(base), offset: [2, -3] }, rect(13, 13, 17, 17).outlines[0]] };
    first.function = { type: "mountain", ridges: [{ curve: structuredClone(line), offset: [2, 1], slope: "{input:A} / 4" }],
        peaks: [{ at: [-16, -13], height: 18, radius: 4, noise: 0, scale: 1 }] };
    d.geoNodes.push(
        layer("A", { type: "outline", outlines: [ref(outline("T"))] }, { type: "noise", amplitude: 2, scale: 5 }),
        layer("B", { type: "outline", outlines: [ref(outline("A"))] }, { type: "mountain", ridges: [ref(ridge("T"))], peaks: [] }),
        layer("C", { type: "outline", outlines: [{ curve: ref(shape(outline("B"))), offset: [9, 4] }] },
            { type: "slope", kind: "path", line: { curve: { ...ref(shape(ridge("B"))), h: { v0: 3, v2: 6 } }, offset: [1, 4] } }),
        layer("D", rect(-42, -20, 42, 20), { type: "coast", shore: { curve: ref(shape(outline("B"))), offset: [-3, 0] },
            roughness: 0, harbor: { center: [0, 0], span: 3, radius: 0 } })
    );
    return d;
}

test("Parsing expands same-object chains and applies each shape placement once", () => {
    const d = fixture();
    d.curves.ring = { label: "环", curve: structuredClone(base) };
    d.inputs.grade = { value: "{geo:B.ridges.0.slope}", range: defaultInputRange("grade") };
    const before = structuredClone(d), result = resolveDesign(parseDesign(d));
    assert.deepEqual(d, before);
    assert.deepEqual(positions(result, "T"), offset(base.nodes.map(n => n.p), [2, -3]));
    assert.deepEqual(positions(result, "B"), positions(result, "A"));
    assert.deepEqual(positions(result, "A"), positions(result, "T"));
    assert.deepEqual(positions(result, "C"), offset(base.nodes.map(n => n.p), [9, 4]));
    assert.deepEqual(positions(result, "D", -1), offset(base.nodes.map(n => n.p), [-3, 0]));
    const m = geo(result, "B").function, t = geo(result, "T").function, s = geo(result, "C").function;
    assert(m.type === "mountain" && t.type === "mountain" && s.type === "slope" && s.kind === "path");
    assert.deepEqual(m.ridges, t.ridges);
    assert.notEqual(m.ridges[0].curve, t.ridges[0].curve);
    assert.deepEqual(m.ridges[0].curve.nodes.map(n => n.h), [14, undefined, 22]);
    assert.equal(s.line.nodes[0].h, 3);
    assert.equal(s.line.nodes[2].h, 6);
    assert(s.line.nodes[1].h! > 3 && s.line.nodes[1].h! < 6);
    assert.deepEqual(s.line.nodes[0].p, [-15, -8]);
    assert.equal(result.inputs.grade.value, 1.75);
    assert.doesNotMatch(JSON.stringify(result), /"(offset|ref)":/);

    const outlineHolder = geo(d, "T").construction;
    assert(outlineHolder.type === "outline" && !isHolderRef(outlineHolder.outlines[0]));
    outlineHolder.outlines[0].offset = [0, 0];
    assert.deepEqual(JSON.parse(serializeDesign(d)).geoNodes[1].construction.outlines[0], { curve: base });
    assert.doesNotThrow(() => parseDesign(serializeDesign(d)));
});

test("References and a hand-expanded design have identical field, mask and problem hashes", () => {
    const d = fixture(), literal = structuredClone(d), n = geo(literal, "T");
    const shifted = <C extends typeof base | typeof line>(curve: C, [x, y]: Point): C =>
        ({ ...curve, nodes: curve.nodes.map(v => ({ ...v, p: [v.p[0] + x, v.p[1] + y] })) });
    const a = shifted(base, [2, -3]), m = shifted(line, [2, 1]);
    for (const id of ["T", "A", "B"]) {
        const { construction } = geo(literal, id);
        assert(construction.type === "outline");
        construction.outlines[0] = { curve: structuredClone(a) };
    }
    for (const item of [n, geo(literal, "B")]) {
        assert(item.function.type === "mountain");
        item.function.ridges[0] = { curve: structuredClone(m), slope: 1.75 };
    }
    const c = geo(literal, "C"), coast = geo(literal, "D").function;
    assert(c.construction.type === "outline" && c.function.type === "slope" && c.function.kind === "path" && coast.type === "coast");
    c.construction.outlines[0] = { curve: shifted(base, [9, 4]) };
    const placed = shifted(line, [1, 4]);
    placed.nodes[0].h = 3;
    placed.nodes[2].h = 6;
    c.function.line = { curve: placed };
    coast.shore = { curve: shifted(base, [-3, 0]) };
    const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
    const bytes = (field: Float32Array | Uint8Array) => new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
    const hashes = (source: Design) => {
        const project = new Project(parseDesign(source));
        return { fields: Object.values(project.terrain.fields).map(f => digest(bytes(f.values))),
            masks: [...Object.values(project.terrain.fields).map(f => f.defined), ...[...project.terrain.regions.values()].map(r => r.mask)].map(f => digest(bytes(f))),
            issues: digest(JSON.stringify(project.issues)) };
    };
    assert.deepEqual(hashes(d), hashes(literal));
});

test("Curves reject missing, mismatched or cyclic references, invalid translations and unknown heights", () => {
    function rejects(id: string, path: string, value: unknown, error: RegExp) {
        const d = fixture();
        const index = d.geoNodes.findIndex(n => n.id === id);
        writeAt(d, ["geoNodes", index, ...path.split(".").map(k => /^\d+$/.test(k) ? Number(k) : k)], value);
        assert.throws(() => parseDesign(d), error);
    }
    const at = "construction.outlines.0", line = "function.line";
    rejects("A", at, ref(outline("Z")), /找不到轮廓/);
    rejects("T", at, ref(outline("B")), /引用成环.*T.轮廓 1.*B.轮廓 1.*A.轮廓 1/);
    rejects("T", at, { curve: ref(shape(outline("B"))) }, /引用成环/);
    rejects("C", at, ref("geo:D.shore"), /只能引用同类/);
    rejects("C", at, { curve: ref(outline("A")) }, /需要引用曲线/);
    rejects("C", at, { curve: ref(shape(ridge("T"))) }, /需要闭合曲线/);
    rejects("C", at, { curve: ref("curve:absent") }, /找不到曲线/);
    rejects("C", at, { curve: ref(shape(outline("T"))), offset: [Infinity, 0] }, /offset 只能填写两个有限数/);
    rejects("C", at, { curve: ref(shape(outline("T"))), offset: ["{input:A}", 0] }, /offset 只能填写两个有限数/);
    rejects("C", at, { curve: { ...ref(shape(outline("T"))), h: { "0": 9 } } }, /这里的节点不能有高度/);
    rejects("C", line, { curve: { ...ref(shape(ridge("T"))), h: { missing: 1 } } }, /curve.h.missing 找不到节点/);
    rejects("B", "function.ridges.0", { ...ref(ridge("T")), slope: 1 }, /ridges\[0\] 无效/);
    rejects("A", at, { ...ref(outline("T")), offset: [0, 0] }, /outlines\[0\] 无效/);
    rejects("A", at, { ...ref(outline("T")), curve: base }, /outlines\[0\] 无效/);
    rejects("A", at, base, /outlines\[0\].curve 无效/);
    rejects("T", "function.ridges.0", { line: base, slope: 1 }, /ridges\[0\].curve 无效/);
    rejects("C", line, { curve: { ...ref(shape(ridge("T"))), offset: [0, 0] } }, /line.curve 无效/);
});

test("Moving either alias moves the same holder once and updates preview without moving shape-only placements", () => {
    const d = fixture(), first = geo(d, "T"), n = geo(d, "A"), delta: Point = [5, -2];
    assert(n.construction.type === "outline" && first.construction.type === "outline");
    n.construction.outlines.push(ref(outline("B")));
    const authoredCurve = structuredClone(first.construction.outlines[0]), original = resolveDesign(d);
    const preview = controlPreview(d, original, curveGraph(d), selection("A"), body, false)!(delta);
    commitControl(d, selection("A"), body, delta, false);
    const moved = resolveDesign(d);
    for (const id of ["A", "B", "T"]) {
        assert.deepEqual(positions(moved, id), offset(positions(original, id), delta));
        assert.deepEqual(preview.nodes.get(id)?.node.construction, geo(moved, id).construction);
    }
    assert(!preview.nodes.has("C"));
    assert.deepEqual(geo(moved, "T").function, geo(original, "T").function);
    assert.deepEqual(positions(moved, "C"), positions(original, "C"));
    assert.deepEqual(first.construction.outlines[0], { ...authoredCurve, offset: [7, -5] });

    commitControl(d, selection("T"), body, [3, 4], false);
    const after = resolveDesign(d), f = geo(after, "T").function;
    assert(f.type === "mountain");
    assert.deepEqual(positions(after, "A"), positions(after, "T"));
    assert.deepEqual(positions(after, "B"), offset(positions(moved, "B"), [3, 4]));
    assert.deepEqual(positions(after, "T", -1), offset(positions(moved, "T", -1), [3, 4]));
    assert.deepEqual(f.peaks[0].at, [-13, -9]);
    assert.deepEqual(positions(after, "C"), positions(original, "C"));
    commitControl(d, selection("T"), { ...body, role: "outline" }, [4, 5], false);
    const next = resolveDesign(d);
    assert.deepEqual(geo(next, "T").function, f);
    assert.deepEqual(positions(next, "T", 1), positions(after, "T", 1));
    assert.deepEqual(positions(next, "A"), offset(positions(after, "A"), [4, 5]));
});

test("Shape edits subtract the current holder offset and shared curves cannot move as a whole", () => {
    const d = fixture(), original = resolveDesign(d);
    const control: GeoControl = { role: "vertex", point: positions(original, "C")[0], path: 0, index: 0 };
    const target: Point = [7, -13];
    const preview = controlPreview(d, original, curveGraph(d), selection("C"), control, false)!(target);
    commitControl(d, selection("C"), control, target, false);
    const moved = resolveDesign(d), source = geo(d, "T").construction;
    assert(source.type === "outline" && !isHolderRef(source.outlines[0]));
    assert.deepEqual(source.outlines[0].offset, [2, -3]);
    assert.deepEqual(literalCurve(source.outlines[0]).nodes[0].p, [-2, -17]);
    assert.deepEqual(positions(moved, "T")[0], [0, -20]);
    assert.deepEqual(positions(moved, "C")[0], target);
    assert.deepEqual(preview.nodes.get("T")?.node.construction, geo(moved, "T").construction);

    d.curves.x = { curve: structuredClone(base), label: "X" };
    const h = { kind: "curve" as const, id: "x" }, whole: GeoControl = { ...control, role: "segment", path: -1 };
    setCurveReference(d, shape(outline("C")), "curve:x");
    const before = serializeDesign(d);
    assert.equal(controlPreview(d, resolveDesign(d), curveGraph(d), h, whole, false), undefined);
    commitControl(d, h, whole, target, false);
    assert.equal(serializeDesign(d), before);
});

test("Numeric aliases share slope and stops while independent heights stay at each shape placement", () => {
    const d = fixture(), model = resolveDesign(d), edit = numberEdits(d, model);
    const alias = ridge("B") + ".slope", slope = edit.slots.get(edit.key(alias))!;
    assert.equal(slope.key, ridge("T") + ".slope");
    assert(!edit.slots.has(alias));
    assert.equal(edit.get(alias), 1.75);
    const changed = edit.validate(slope.path, 3);
    assert.equal(changed.resolved.length, 2);
    writeAt(d, changed.address, changed.value);
    assert.equal(expressionGraph(d).get(alias), 3);

    const stop = shape(ridge("B")) + ".nodes.0.h", canonical = edit.slots.get(edit.key(stop))!;
    assert.equal(edit.validate(canonical.path, 16).resolved.length, 2);
    const graph = curveGraph(d), at = graph.slots.get("geo:C.line.curve")!;
    assert.equal(graph.offset(at)[0], 1);
    const numbers = expressionGraph(d), height = at.key + ".h.v0";
    assert.equal(numbers.get(height), 3);
    assert.equal(numbers.slots.get(height)?.label, "节点 1.增量");
});

test("References can be copied or unlinked without moving and indexed references follow list edits", () => {
    const d = fixture(), n = geo(d, "T"), a = geo(d, "A"), b = geo(d, "B"), c = geo(d, "C");
    assert(n.construction.type === "outline" && a.construction.type === "outline" && b.construction.type === "outline" &&
        n.function.type === "mountain" && b.function.type === "mountain" && c.function.type === "slope" && c.function.kind === "path");
    const before = resolveDesign(d), copy = copyGeo(d, a);
    assert.deepEqual(copy.construction, a.construction);
    const old = shape(outline("C"));
    setCurveReference(d, old);
    assert.deepEqual(positions(resolveDesign(d), "C"), positions(before, "C"));
    setCurveReference(d, shape(outline("B")));
    assert.deepEqual(positions(resolveDesign(d), "B"), positions(before, "B"));
    assert.notEqual(b.construction.outlines[0], n.construction.outlines[0]);
    assert.throws(() => deleteGeo(d, "T"), /仍被引用/);
    d.curves.x = { curve: openCurve<never>(line.nodes.map(({ p }) => ({ p })), "corner", "v"), label: "X" };
    n.function.ridges.splice(0, 0, { curve: d.curves.x.curve, slope: 2 });
    n.function.ridges[1] = { curve: { ...ref("curve:x"), h: { v0: 10 } }, offset: [2, 1], slope: 1 };
    b.function.ridges[0] = ref(ridge("T", 1));
    c.function.line = { curve: ref(shape(ridge("T", 1))) };
    d.inputs.value = { value: "{" + shape(ridge("T", 1)) + ".h.v0}", range: defaultInputRange("value") };
    assert.throws(() => removeDeclaration(d, "curve", "x"), /仍被引用/);
    copyGeometryItem(d, n, ["ridges"], 0);
    assert.deepEqual(b.function.ridges[0], ref(ridge("T", 2)));
    assert.deepEqual(c.function.line, { curve: ref(shape(ridge("T", 2))) });
    assert.equal(d.inputs.value.value, "{" + shape(ridge("T", 2)) + ".h.v0}");
    removeGeometryItem(d, n, ["ridges"], 0);
    assert.throws(() => removeGeometryItem(d, n, ["ridges"], 1), /仍被引用/);
    const beforeUnlink = resolveDesign(d);
    setCurveReference(d, shape(ridge("B")));
    assert.deepEqual(b.function.ridges[0], n.function.ridges[1]);
    assert.notEqual(b.function.ridges[0], n.function.ridges[1]);
    assert.deepEqual(resolveDesign(d), beforeUnlink);
    delete d.inputs.value;
    setCurveReference(d, shape(ridge("T", 1)));
    assert.deepEqual(positions(resolveDesign(d), "T", -2), positions(beforeUnlink, "T", -2));
    assert.deepEqual(literalCurve(n.function.ridges[1]).nodes[0].h, 10);
});

test("Round-tripping indexed outline links keeps same-object and curve paths distinct", () => {
    const d = fixture(), t = geo(d, "T"), a = geo(d, "A"), c = geo(d, "C");
    assert(t.construction.type === "outline" && a.construction.type === "outline" && c.construction.type === "outline");
    a.construction.outlines[0] = ref(outline("T", 1));
    c.construction.outlines[0] = { curve: ref(shape(outline("T", 1))) };
    copyGeometryItem(d, t, ["construction", "outlines"], 0);
    assert.deepEqual(a.construction.outlines[0], ref(outline("T", 2)));
    assert.deepEqual(c.construction.outlines[0], { curve: ref(shape(outline("T", 2))) });
    assert.notDeepEqual(literalCurve(t.construction.outlines[0]).nodes.map(n => n.id), literalCurve(t.construction.outlines[1]).nodes.map(n => n.id));
    removeGeometryItem(d, t, ["construction", "outlines"], 0);
    assert.deepEqual(a.construction.outlines[0], ref(outline("T", 1)));
    assert.deepEqual(c.construction.outlines[0], { curve: ref(shape(outline("T", 1))) });
    assert.throws(() => removeGeometryItem(d, t, ["construction", "outlines"], 1), /仍被引用/);
});

test("Deleting a source node clears stops in direct and indirect shape references in one history entry", () => {
    const d = fixture(), n = geo(d, "T"), c = geo(d, "C");
    assert(n.function.type === "mountain" && c.function.type === "slope" && c.function.kind === "path");
    const shared = openCurve<never>(line.nodes.map(({ p }) => ({ p })), "auto", "v");
    d.curves.source = { curve: shared, label: "来源" };
    n.function.ridges[0] = { curve: { ...ref("curve:source"), h: { v0: 9, v1: 12 } }, slope: 2 };
    assert(!isHolderRef(c.function.line));
    c.function.line.curve = { ...ref(shape(ridge("B"))), h: { v1: 3, v2: 6 } };
    const history = new History(d);
    const before = serializeDesign(d);
    removeCurveNode(d, { kind: "curve", id: "source" }, { role: "vertex", path: -1, index: 1, point: [0, 0] });
    assert.deepEqual(n.function.ridges[0], { curve: { ...ref("curve:source"), h: { v0: 9 } }, slope: 2 });
    assert.deepEqual(c.function.line.curve, { ...ref(shape(ridge("B"))), h: { v2: 6 } });
    assert.doesNotThrow(() => parseDesign(d));
    assert(history.record(d));
    assert.equal(serializeDesign(history.step(false)), before);
});

test("Continue drawing, redrawing and retracting a handle write back through a shape placement", () => {
    for (const endpoint of [0, 2]) for (const closed of [false, true]) {
        const d = fixture(), history = new History(d), before = serializeDesign(d), graph = curveGraph(d), key = "geo:C.line.curve";
        const slot = graph.slots.get(key)!;
        const draft: GeoDraft = { tool: "continueCurve", owner: "C", ids: ["C"], nodes: [penNode("", [5, 7], [7, 8]), penNode("", [2, 8])],
            anchors: [], reverse: false, closed, curve: { key, name: "C.坡线", original: graph.materialize(slot), endpoint, pen: "terrain", requiredClosed: false } };
        const last = finishCurveDraft(d, draft), edited = curveGraph(d).source(slot).curve;
        const added = edited.nodes.filter(n => !n.id.startsWith("v"));
        assert.equal(edited.closed, closed);
        assert.equal(added[endpoint === 0 ? 0 : 1].id, last);
        assert.deepEqual(added.map(n => n.p), endpoint === 0 ? [[1, 4], [4, 3]] : [[4, 3], [1, 4]]);
        assert(added.every(n => !Object.hasOwn(n, "h")));
        assert.doesNotThrow(() => parseDesign(d));
        assert(history.record(d));
        assert.equal(serializeDesign(history.step(false)), before);
        editCurveSource(d, key, curve => retractHandle(curve, edited.nodes.findIndex(n => n.id === "v1"), "in"));
        assert.equal(curveGraph(d).source(slot).curve.nodes.find(n => n.id === "v1")?.mode, "corner");
        editCurveSource(d, key, (curve, local) => {
            Object.assign(curve, { closed: false, nodes: [penNode("a", local([6, 4])), penNode("b", local([9, 2]))] });
        });
        const c = geo(d, "C").function;
        assert(c.type === "slope" && c.kind === "path" && !isHolderRef(c.line));
        assert.deepEqual(c.line.curve, ref(shape(ridge("B"))));
        assert.deepEqual(positions(resolveDesign(d), "C", -1), [[6, 4], [9, 2]]);
    }
});