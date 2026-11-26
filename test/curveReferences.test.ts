import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { finishCurveDraft } from "../src/app/state/geoTools.ts";
import { curveGraph, isCurveRef, isHolderRef } from "../src/core/design/curveReferences.ts";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { flattenSegment } from "../src/core/design/path.ts";
import { numberEdits } from "../src/core/design/numberEdit.ts";
import { expressionGraph, resolveDesign, writeAt } from "../src/core/design/parameters.ts";
import { type Design, type Expression, type Point, type ResolvedDesign } from "../src/core/design/v5.ts";
import { editCurveSource, setCurveReference } from "../src/core/edit/curveEdits.ts";
import { commitControl, controlPreview, copyGeometryItem, geometryPath, removeCurveNode, removeGeometryItem, type GeoControl } from "../src/core/edit/geoControls.ts";
import { copyGeo, createStrip, deleteGeo, removeDeclaration } from "../src/core/edit/geoNodes.ts";
import { History } from "../src/core/edit/history.ts";
import { penNode, retractHandle } from "../src/core/edit/paths.ts";
import { type GeoDraft } from "../src/core/edit/types.ts";
import { Project } from "../src/core/project.ts";
import { withNodeSlope, layer, literalCurve, openCurve, rect, syntheticDesign } from "./scenarios.ts";

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
    first.function = { type: "mountain", valleys: [], ridges: [{ curve: withNodeSlope(structuredClone(line), "{input:A} / 4"), offset: [2, 1] }],
        peaks: [{ at: [-16, -13], height: 18, radius: 4, noise: 0, scale: 1 }] };
    d.geoNodes.push(
        layer("A", { type: "outline", outlines: [ref(outline("T"))] }, { type: "noise", amplitude: 2, scale: 5 }),
        layer("B", { type: "outline", outlines: [ref(outline("A"))] }, { type: "mountain", valleys: [], ridges: [ref(ridge("T"))], peaks: [] }),
        layer("C", { type: "outline", outlines: [{ curve: ref(shape(outline("B"))), offset: [9, 4] }] },
            { type: "slope", kind: "path", lines: [{ curve: { ...ref(shape(ridge("B"))), h: { v0: 3, v2: 6 } }, offset: [1, 4] }], center: [0, 0], radius: 5, value: 2, rate: -.2 }),
        layer("D", rect(-42, -20, 42, 20), { type: "coast", shore: { curve: ref(shape(outline("B"))), offset: [-3, 0] },
            roughness: 0, harbor: { center: [0, 0], span: 3, radius: 0 } })
    );
    return d;
}

test("Parsing expands same-object chains and applies each shape placement once", () => {
    const d = fixture();
    d.curves.ring = { label: "环", curve: structuredClone(base) };
    d.inputs.grade = { value: "{geo:B.ridges.0.curve.nodes.0.slope}", range: defaultInputRange("grade") };
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
    assert.equal(s.lines[0].curve.nodes[0].h, 3);
    assert.equal(s.lines[0].curve.nodes[2].h, 6);
    const middle = expressionGraph(d).get("geo:C.lines.0.curve.h.v1") as number;
    assert(middle > 3 && middle < 6);
    assert.equal(s.lines[0].curve.nodes[1].h, undefined);
    assert.deepEqual(s.lines[0].curve.nodes[0].p, [-15, -8]);
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
        item.function.ridges[0] = { curve: withNodeSlope(structuredClone(m), 1.75) };
    }
    const c = geo(literal, "C"), coast = geo(literal, "D").function;
    assert(c.construction.type === "outline" && c.function.type === "slope" && c.function.kind === "path" && coast.type === "coast");
    c.construction.outlines[0] = { curve: shifted(base, [9, 4]) };
    const placed = shifted(line, [1, 4]);
    placed.nodes[0].h = 3;
    placed.nodes[2].h = 6;
    c.function.lines[0] = { curve: placed };
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
    const at = "construction.outlines.0", line = "function.lines.0";
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
    rejects("T", "function.ridges.0", { line: base, slope: 1 }, /ridges\[0\].slope 坡度必须写在节点上/);
    rejects("C", line, { curve: { ...ref(shape(ridge("T"))), offset: [0, 0] } }, /lines\[0\].curve 无效/);
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
    const h = { kind: "curve" as const, id: "x" }, whole: GeoControl = { ...control, role: "curve", path: -1 };
    setCurveReference(d, shape(outline("C")), "curve:x");
    const before = serializeDesign(d);
    assert.equal(controlPreview(d, resolveDesign(d), curveGraph(d), h, whole, false), undefined);
    commitControl(d, h, whole, target, false);
    assert.equal(serializeDesign(d), before);
});

test("Numeric aliases share slope and stops while independent heights stay at each shape placement", () => {
    const d = fixture(), model = resolveDesign(d), edit = numberEdits(d, model);
    const alias = shape(ridge("B")) + ".nodes.0.slope", slope = edit.slots.get(edit.key(alias))!;
    assert.equal(slope.key, shape(ridge("T")) + ".nodes.0.slope");
    assert(!edit.slots.has(alias));
    assert.equal(edit.get(alias), 1.75);
    const changed = edit.validate(slope.path, 3);
    assert.equal(changed.resolved.length, 2);
    writeAt(d, changed.address, changed.value);
    assert.equal(expressionGraph(d).get(alias), 3);

    const stop = shape(ridge("B")) + ".nodes.0.h", canonical = edit.slots.get(edit.key(stop))!;
    assert.equal(edit.validate(canonical.path, 16).resolved.length, 2);
    const graph = curveGraph(d), at = graph.slots.get("geo:C.lines.0.curve")!;
    assert.equal(graph.offset(at)[0], 1);
    const numbers = expressionGraph(d), height = at.key + ".h.v0";
    assert.equal(numbers.get(height), 3);
    assert.equal(numbers.slots.get(height)?.label, "坡线 1.节点 1.增量");
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
    n.function.ridges.splice(0, 0, { curve: withNodeSlope(d.curves.x.curve, 2) });
    n.function.ridges[1] = { curve: { ...ref("curve:x"), h: { v0: 10, v2: 10 }, slope: { v0: 1, v2: 1 } }, offset: [2, 1] };
    b.function.ridges[0] = ref(ridge("T", 1));
    c.function.lines[0] = { curve: { ...ref(shape(ridge("T", 1))), h: { v0: 0, v2: 2 } } };
    d.inputs.value = { value: "{" + shape(ridge("T", 1)) + ".h.v0}", range: defaultInputRange("value") };
    assert.throws(() => removeDeclaration(d, "curve", "x"), /仍被引用/);
    copyGeometryItem(d, n, ["ridges"], 0);
    assert.deepEqual(b.function.ridges[0], ref(ridge("T", 2)));
    assert.deepEqual(c.function.lines[0], { curve: { ...ref(shape(ridge("T", 2))), h: { v0: 0, v2: 2 } } });
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

test("Landform copies rebase their own numeric references and leave external readers and sources intact", () => {
    const d: Design = syntheticDesign(), original = geo(d, "T");
    d.geoNodes.push(layer("T.external", rect(14, 10, 20, 20), { type: "ground", value: 4 }));
    original.function = { type: "flat", amount: "{geo:T.feather} + {geo:T.external.value}", feather: 2 };
    d.inputs.reader = { value: "{geo:T.amount}", range: defaultInputRange("reader") };
    const copy = copyGeo(d, original);
    assert(copy.function.type === "flat");
    assert.equal(copy.function.amount, "{geo:" + copy.id + ".feather} + {geo:T.external.value}");
    assert.equal(expressionGraph(d).get("geo:" + copy.id + ".amount"), 6);
    assert.equal(d.inputs.reader.value, "{geo:T.amount}");
    assert.throws(() => deleteGeo(d, "T"), /仍被引用/);
    delete d.inputs.reader;
    assert(deleteGeo(d, "T"));
    assert.equal(expressionGraph(d).get("geo:" + copy.id + ".amount"), 6);
});

test("Copies move curve links and node height keys within their own landform", () => {
    const d = syntheticDesign(), original = geo(d, "T"), construction = original.construction;
    assert(construction.type === "outline");
    const first = literalCurve(construction.outlines[0]), nodeId = first.nodes[0].id;
    construction.outlines.push(ref(outline("T")), construction.outlines[0]);
    d.curves.external = { label: "外部曲线", curve: openCurve<never>([{ p: [1, 2] }, { p: [5, 6] }], "corner", "outer-") };
    original.function = { type: "mountain", valleys: [], peaks: [], ridges: [
        { curve: { ...ref(shape(outline("T", 1))), h: { [nodeId]: "{geo:T.ridges.0.curve.slope." + nodeId + "}" }, slope: { [nodeId]: 2 } }, offset: [2, 0] },
        { curve: { ...ref("curve:external"), h: { "outer-0": "{geo:G.value}", "outer-1": 4 },
            slope: { "outer-0": "{" + shape(ridge("T")) + ".h." + nodeId + "}", "outer-1": 2 } } },
        { ...ref(ridge("T")) }
    ] };
    const copy = copyGeo(d, original), c = copy.construction, f = copy.function;
    assert(c.type === "outline" && f.type === "mountain");
    const nextNode = literalCurve(c.outlines[0]).nodes[0].id;
    assert.notEqual(nextNode, nodeId);
    assert.notEqual(literalCurve(c.outlines[2]).nodes[0].id, nextNode);
    assert.deepEqual(c.outlines[1], ref(outline(copy.id)));
    const [a, b] = f.ridges;
    assert(!isHolderRef(a) && isCurveRef(a.curve) && !isHolderRef(b) && isCurveRef(b.curve));
    assert.deepEqual(a.curve, { ...ref(shape(outline(copy.id, 1))), h: { [nextNode]: "{" + shape(ridge(copy.id)) + ".slope." + nextNode + "}" },
        slope: { [nextNode]: 2 } });
    assert.deepEqual(b.curve.h, { "outer-0": "{geo:G.value}", "outer-1": 4 });
    assert.equal(b.curve.slope!["outer-0"], "{" + shape(ridge(copy.id)) + ".h." + nextNode + "}");
    assert.deepEqual(f.ridges[2], ref(ridge(copy.id)));
    const source = (resolveDesign(parseDesign(d)).geoNodes.find(n => n.id === copy.id)!).function;
    assert(source.type === "mountain");
    assert.equal(source.ridges[0].curve.nodes[0].h, 2);
    assert.equal(source.ridges[1].curve.nodes[0].slope, 2);
    assert(deleteGeo(d, "T"));
    assert.doesNotThrow(() => resolveDesign(parseDesign(d)));
});

test("A copied ridge uses its own slope and the shifted index of the following ridge", () => {
    const d = syntheticDesign(), n = geo(d, "T"), link = "{geo:T.ridges.0.curve.nodes.0.slope} + {geo:T.ridges.1.curve.nodes.0.slope}";
    n.function = { type: "mountain", valleys: [], peaks: [], ridges: [
        { curve: withNodeSlope(openCurve<Expression>([{ p: [0, 0], h: link }, { p: [2, 4], h: 7 }]), 2) },
        { curve: withNodeSlope(structuredClone(line), 3) }
    ] };
    copyGeometryItem(d, n, ["ridges"], 0);
    const [original, copy] = n.function.ridges.map(literalCurve);
    assert.equal(original.nodes[0].h, "{geo:T.ridges.0.curve.nodes.0.slope} + {geo:T.ridges.2.curve.nodes.0.slope}");
    assert.equal(copy.nodes[0].h, "{geo:T.ridges.1.curve.nodes.0.slope} + {geo:T.ridges.2.curve.nodes.0.slope}");
    assert.notEqual(original.nodes[0].id, copy.nodes[0].id);
    assert.equal(expressionGraph(d).get("geo:T.ridges.1.curve.nodes.0.h"), 5);
});

test("A strip copy keeps its range on the source landform", () => {
    const d = syntheticDesign(), original = geo(d, "T").construction;
    assert(original.type === "outline");
    const nodes = literalCurve(original.outlines[0]).nodes, range = { from: nodes[0].id, to: nodes[1].id };
    const strip = createStrip(d, ["T"], range), copy = copyGeo(d, strip);
    assert.deepEqual(copy.construction, strip.construction);
    assert.doesNotThrow(() => parseDesign(d));
});

test("A segment drag translates only its two endpoints and keeps node modes and handles", () => {
    const delta: Point = [2, -3];
    for (const mode of ["corner", "manual", "auto"] as const) {
        const d = syntheticDesign(), n = geo(d, "T");
        assert(n.construction.type === "outline");
        const path = literalCurve(n.construction.outlines[0]);
        const a = path.nodes[1], b = path.nodes[2];
        a.mode = b.mode = mode;
        if (mode === "corner") a.bulge = .5;
        if (mode === "manual") {
            Object.assign(a, { in: [-1, -3], out: [2, 6] });
            Object.assign(b, { in: [3, -3], out: [-4, 4] });
        }
        const before = structuredClone(path), samples = flattenSegment(path, 1, .05);
        const control: GeoControl = { role: "segment", path: 0, index: 1, point: [0, 0] };
        commitControl(d, selection(n.id), control, delta, false);
        const edited = literalCurve(n.construction.outlines[0]);
        assert.deepEqual(edited.nodes.map(node => ({ ...node, p: undefined })), before.nodes.map(node => ({ ...node, p: undefined })));
        assert.deepEqual(edited.nodes.map(node => node.p), before.nodes.map((node, i) =>
            i === 1 || i === 2 ? [node.p[0] + delta[0], node.p[1] + delta[1]] : node.p));
        if (mode !== "auto") {
            const after = flattenSegment(edited, 1, .05);
            assert.equal(after.length, samples.length);
            for (const [i, { a, b }] of samples.entries()) for (const [j, next] of [a, b].entries()) {
                const p = j === 0 ? after[i].a : after[i].b;
                assert(Math.hypot(p[0] - next[0] - delta[0], p[1] - next[1] - delta[1]) < 1e-9);
            }
        }
    }
});

test("Dragging a segment at a shape reference previews and edits the source through the placement", () => {
    const d = fixture(), original = resolveDesign(d), copy = structuredClone(geo(d, "C").construction);
    const controls: GeoControl = { role: "segment", path: 0, index: 0, point: [-5, -11] };
    const delta: Point = [3, 4], target: Point = [-2, -7];
    const preview = controlPreview(d, original, curveGraph(d), selection("C"), controls, false)!(target);
    commitControl(d, selection("C"), controls, target, false);
    const after = resolveDesign(d);
    assert.deepEqual(geo(d, "C").construction, copy);
    for (const id of ["T", "A", "B", "C"]) {
        const points = positions(original, id);
        assert.deepEqual(positions(after, id), [...offset(points.slice(0, 2), delta), ...points.slice(2)]);
        assert.deepEqual(geometryPath(preview.nodes.get(id)!.node, 0)!.nodes.map(n => n.p), positions(after, id));
    }
});

test("Deleting an earlier outline shifts indexed same-object and shape links", () => {
    const d = fixture(), t = geo(d, "T"), a = geo(d, "A"), c = geo(d, "C");
    assert(t.construction.type === "outline" && a.construction.type === "outline" && c.construction.type === "outline");
    a.construction.outlines[0] = ref(outline("T", 1));
    c.construction.outlines[0] = { curve: ref(shape(outline("T", 1))) };
    removeGeometryItem(d, t, ["construction", "outlines"], 0);
    assert.deepEqual(a.construction.outlines[0], ref(outline("T", 0)));
    assert.deepEqual(c.construction.outlines[0], { curve: ref(shape(outline("T", 0))) });
    assert.throws(() => removeGeometryItem(d, t, ["construction", "outlines"], 0), /仍被引用/);
});

test("Deleting a source node clears stops in direct and indirect shape references in one history entry", () => {
    const d = fixture(), n = geo(d, "T"), c = geo(d, "C");
    assert(n.function.type === "mountain" && c.function.type === "slope" && c.function.kind === "path");
    const shared = openCurve<never>(line.nodes.map(({ p }) => ({ p })), "auto", "v");
    d.curves.source = { curve: shared, label: "来源" };
    n.function.ridges[0] = { curve: { ...ref("curve:source"), h: { v0: 9, v1: 12, v2: 15 }, slope: { v0: 2, v2: 2 } } };
    assert(!isHolderRef(c.function.lines[0]));
    c.function.lines[0].curve = { ...ref(shape(ridge("B"))), h: { v0: 1, v1: 3, v2: 6 } };
    const history = new History(d);
    const before = serializeDesign(d);
    removeCurveNode(d, { kind: "curve", id: "source" }, { role: "vertex", path: -1, index: 1, point: [0, 0] });
    assert.deepEqual(n.function.ridges[0], { curve: { ...ref("curve:source"), h: { v0: 9, v2: 15 }, slope: { v0: 2, v2: 2 } } });
    assert.deepEqual(c.function.lines[0].curve, { ...ref(shape(ridge("B"))), h: { v0: 1, v2: 6 } });
    assert.doesNotThrow(() => parseDesign(d));
    assert(history.record(d));
    assert.equal(serializeDesign(history.step(false)), before);
});

test("Continue drawing, redrawing and retracting a handle write back through a shape placement", () => {
    for (const endpoint of [0, 2]) for (const closed of [false, true]) {
        const d = fixture(), history = new History(d), before = serializeDesign(d), graph = curveGraph(d), key = "geo:C.lines.0.curve";
        const slot = graph.slots.get(key)!;
        const draft: GeoDraft = { tool: "continueCurve", owner: "C", ids: ["C"], nodes: [penNode("", [5, 7], [7, 8]), penNode("", [2, 8])],
            anchors: [], reverse: false, closed, curve: { key, name: "C.坡线", original: graph.materialize(slot), endpoint, pen: "terrain", requiredClosed: false } };
        const last = finishCurveDraft(d, draft), edited = curveGraph(d).source(slot).curve;
        const added = edited.nodes.filter(n => !n.id.startsWith("v"));
        assert.equal(edited.closed, closed);
        assert.equal(added[endpoint === 0 ? 0 : 1].id, last);
        assert.deepEqual(added.map(n => n.p), endpoint === 0 ? [[1, 4], [4, 3]] : [[4, 3], [1, 4]]);
        assert(added.every(n => Number.isFinite(n.h) && (n.slope === "{input:A} / 4" || n.slope === 1.75)));
        assert(added.some(n => n.interpolate?.includes("h")));
        assert.doesNotThrow(() => parseDesign(d));
        assert(history.record(d));
        assert.equal(serializeDesign(history.step(false)), before);
        editCurveSource(d, key, curve => retractHandle(curve, edited.nodes.findIndex(n => n.id === "v1"), "in"));
        assert.equal(curveGraph(d).source(slot).curve.nodes.find(n => n.id === "v1")?.mode, "corner");
        editCurveSource(d, key, (curve, local) => {
            Object.assign(curve, { closed: false, nodes: [penNode("a", local([6, 4])), penNode("b", local([9, 2]))] });
        });
        const c = geo(d, "C").function;
        assert(c.type === "slope" && c.kind === "path" && !isHolderRef(c.lines[0]));
        assert(isCurveRef(c.lines[0].curve));
        assert.deepEqual(c.lines[0].curve, { ...ref(shape(ridge("B"))), h: { a: 0, b: 2 } });
        assert.deepEqual(positions(resolveDesign(d), "C", -1), [[6, 4], [9, 2]]);
    }
});