import assert from "node:assert/strict";
import { test } from "node:test";
import { curveGraph, geometryAt, geometryUsers, isHolderRef, placedPoint } from "../src/core/design/curveReferences.ts";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { expressionGraph, resolveDesign } from "../src/core/design/parameters.ts";
import { type Design, type Held, type Point, type ResolvedDesign } from "../src/core/design/v5.ts";
import { moveHandle, moveSection } from "../src/core/edit/controls.ts";
import { setCurveReference } from "../src/core/edit/curveEdits.ts";
import { commitControl, controlPreview, copyGeometryItem, geometryPath, insertCurveNode, removeCurveNode, removeGeometryItem, type GeoControl } from "../src/core/edit/geoControls.ts";
import { copyGeo, createStrip, deleteGeo, holdPoint, removalUses, removeDeclaration, removeUnusedGeometry, setGeometryIndependent } from "../src/core/edit/geoNodes.ts";
import { History } from "../src/core/edit/history.ts";
import { Project } from "../src/core/project.ts";
import { addLayer, fixtureCurve, fixtureMark, fixtureSection, literalCurve, openCurve, rect, syntheticDesign } from "./scenarios.ts";
import { testTerrainClient } from "./computeFixture.ts";

const outline = (id: string, i = 0) => "geo:" + id + ".construction.outlines." + i;
const ridge = (id: string, i = 0) => "geo:" + id + ".ridges." + i;
const ref = (key: string) => ({ ref: "{" + key + "}" });
const selection = (id: string) => ({ kind: "geoNode" as const, id });
const body: GeoControl = { role: "body", path: 0, index: 0, point: [0, 0] };
const vertex = (point: Point, path = 0, index = 0): GeoControl => ({ role: "vertex", path, index, point });
const geo = <N extends { id: string }>(d: { geoNodes: N[] }, id: string) => d.geoNodes.find(n => n.id === id)!;
const positions = (d: ResolvedDesign, id: string, path = 0) => geometryPath(geo(d, id), path)!.nodes.map(n => n.p);
const shifted = (points: Point[], [x, y]: Point) => points.map(([a, b]): Point => [a + x, b + y]);

function owned<T extends Held>(holder: T): Exclude<T, { ref: string }> {
    assert(!isHolderRef(holder));
    return holder as Exclude<T, { ref: string }>;
}

function fixture() {
    const d: Design = syntheticDesign(), t = geo(d, "T"), c = t.construction;
    assert(c.type === "outline");
    const first = owned(c.outlines[0]);
    first.offset = [2, -3];
    c.outlines.push(fixtureCurve(d, rect(13, 13, 17, 17).outlines[0]));
    const ridgeShape = openCurve([{ p: [-16, -12], h: 14, slope: 1 }, { p: [-11, -10] }, { p: [-9, -3], h: 22, slope: 2 }], "corner", "p");
    const primary = owned(fixtureCurve(d, { curve: ridgeShape, offset: [2, 1] }, ["h", "slope"]));
    const peak = holdPoint(d, [-16, -13]);
    t.function = { type: "mountain", valleys: [], ridges: [primary], peaks: [{ at: peak, height: 18, radius: 4, noise: 0, scale: 1 }] };
    d.geoNodes.push(
        addLayer(d, "A", { type: "outline", outlines: [ref(outline("T"))] }, { type: "noise", amplitude: 2, scale: 5 }),
        addLayer(d, "B", { type: "outline", outlines: [ref(outline("A"))] }, { type: "mountain", valleys: [], ridges: [ref(ridge("T"))], peaks: [] }),
        addLayer(d, "C", { type: "outline", outlines: [{ curve: first.curve, offset: [9, 4] }] },
            { type: "slope", kind: "path", lines: [{ curve: primary.curve, h: { p0: 3, p2: 6 }, offset: [1, 4] }], center: [0, 0], radius: 5, value: 2, rate: -.2 }),
        addLayer(d, "D", rect(-42, -20, 42, 20), { type: "coast", shore: { curve: first.curve, offset: [-3, 0] },
            roughness: 0, harbor: { center: [0, 0], span: 3, radius: 0 } })
    );
    return { d, t, first, peak, primary };
}

test("Geometry resolves independently for each holder while same-object references keep the source placement and values", () => {
    const { d, first } = fixture();
    d.inputs.grade = { value: "{geo:B.ridges.0.slope.p2}", range: defaultInputRange("grade") };
    const before = structuredClone(d), result = resolveDesign(parseDesign(serializeDesign(d)));
    assert.deepEqual(d, before);
    const base = literalCurve(d, first).nodes.map(n => n.p);
    assert.deepEqual(positions(result, "T"), shifted(base, [2, -3]));
    assert.deepEqual(positions(result, "B"), positions(result, "A"));
    assert.deepEqual(positions(result, "A"), positions(result, "T"));
    assert.deepEqual(positions(result, "C"), shifted(base, [9, 4]));
    assert.deepEqual(positions(result, "D", -1), shifted(base, [-3, 0]));
    const b = geo(result, "B").function, t = geo(result, "T").function, s = geo(result, "C").function;
    assert(b.type === "mountain" && t.type === "mountain" && s.type === "slope");
    assert.deepEqual(b.ridges, t.ridges);
    assert.notEqual(b.ridges[0].curve, t.ridges[0].curve);
    assert.deepEqual(b.ridges[0].curve.nodes.map(n => n.h), [14, undefined, 22]);
    assert.deepEqual(s.lines[0].curve.nodes.map(n => n.h), [3, undefined, 6]);
    const middle = expressionGraph(d).get("geo:C.lines.0.h.p1") as number;
    assert(middle > 3 && middle < 6);
    assert.equal(result.inputs.grade.value, 2);
    first.offset = [0, 0];
    assert.deepEqual(JSON.parse(serializeDesign(d)).geoNodes[1].construction.outlines[0], { curve: first.curve });
});

test("Geometry validates storage, kinds, closure, node IDs and same-object references", () => {
    const { d, first, peak, primary, t } = fixture();
    assert.throws(() => parseDesign({ ...d, curves: {} }), /curves 退役键/);
    const legacy = structuredClone(d);
    Object.assign(legacy.geometry[first.curve], { listed: true });
    assert.throws(() => parseDesign(legacy), /listed 退役键/);
    for (const key of ["h", "slope", "interpolate"]) {
        const curve = literalCurve(d, first);
        Object.assign(curve.nodes[0], { [key]: 1 });
        assert.throws(() => parseDesign(d), new RegExp(key + " 退役键"));
        Reflect.deleteProperty(curve.nodes[0], key);
    }
    const curve = first.curve, p = peak.point;
    first.curve = "missing";
    assert.throws(() => parseDesign(d), /找不到曲线“missing”/);
    first.curve = p;
    assert.throws(() => parseDesign(d), /需要曲线/);
    first.curve = primary.curve;
    assert.throws(() => parseDesign(d), /需要闭合曲线/);
    Object.assign(first, { curve: ref("curve:" + curve) });
    assert.throws(() => parseDesign(d), /退役的曲线格式/);
    first.curve = curve;
    peak.point = "missing";
    assert.throws(() => parseDesign(d), /找不到点“missing”/);
    peak.point = curve;
    assert.throws(() => parseDesign(d), /需要点/);
    peak.point = p;
    primary.h!.missing = 41;
    assert.throws(() => parseDesign(d), /找不到节点“missing”/);
    delete primary.h!.missing;
    assert(t.construction.type === "outline");
    t.construction.outlines[0] = ref(outline("B"));
    assert.throws(() => parseDesign(d), /引用成环.*“T.轮廓 1”/);
    t.construction.outlines[0] = ref(ridge("T"));
    assert.throws(() => parseDesign(d), /只能引用同类轮廓/);
    t.construction.outlines[0] = ref(outline("missing"));
    assert.throws(() => parseDesign(d), /找不到轮廓/);
});

test("Orphans produce named warnings and unrelated edits keep them", () => {
    const { d } = fixture();
    d.geometry.orphan = { label: "孤点", point: [12, 3] };
    d.geometry.independent = { label: "收藏点", point: [12, 3], independent: true };
    const next = structuredClone(d);
    next.geoNodes[0].showLabel = true;
    removeUnusedGeometry(d, next);
    assert.deepEqual(next.geometry, d.geometry);
    const issues = new Project(parseDesign(next)).issues.filter(i => i.kind === "unused-geometry");
    assert.deepEqual(issues.map(i => [i.label, i.message, i.location]), [["孤点", "没有被引用", { kind: "geometry", id: "orphan", path: [] }]]);
});

test("Moving a landform shifts each holder once and preserves every base coordinate", () => {
    const { d, t, first, peak, primary } = fixture(), before = resolveDesign(d), shape = JSON.stringify(d.geometry);
    assert(t.construction.type === "outline");
    t.construction.outlines.push(ref(outline("T")));
    const delta: Point = [3, 4];
    const preview = controlPreview(d, before, curveGraph(d), selection("T"), body, false)!(delta);
    commitControl(d, selection("T"), body, delta, false);
    assert.equal(JSON.stringify(d.geometry), shape);
    assert.deepEqual(first.offset, [5, 1]);
    assert.deepEqual(primary.offset, [5, 5]);
    assert.deepEqual(peak.offset, delta);
    assert.deepEqual(owned(t.construction.outlines[1]).offset, delta);
    const after = resolveDesign(d);
    for (const id of ["A", "B", "T"]) {
        assert.deepEqual(positions(after, id), shifted(positions(before, id), delta));
        assert.deepEqual(geometryPath(preview.nodes.get(id)!.node, 0)!.nodes.map(n => n.p), positions(after, id));
    }
    assert.deepEqual(positions(after, "C"), positions(before, "C"));
    assert.deepEqual(positions(after, "D", -1), positions(before, "D", -1));

    const coast = geo(d, "D").function, slope = geo(d, "C").function;
    assert(coast.type === "coast" && slope.type === "slope");
    slope.kind = "radial";
    for (const id of ["C", "D"]) commitControl(d, selection(id), body, delta, false);
    assert.deepEqual(coast.harbor.center.offset, delta);
    assert.deepEqual(slope.center.offset, delta);
    assert.deepEqual(owned(slope.lines[0]).offset, [4, 8]);
    assert.equal(JSON.stringify(d.geometry), shape);
});

test("Shape drags write local coordinates and update every placement", () => {
    const { d, first } = fixture(), before = resolveDesign(d);
    const start = positions(before, "C")[0], target = shifted([start], [4, -2])[0], h = vertex(start);
    const preview = controlPreview(d, before, curveGraph(d), selection("C"), h, false)!(target);
    commitControl(d, selection("C"), h, target, false);
    const result = resolveDesign(d);
    assert.deepEqual(literalCurve(d, first).nodes[0].p, [target[0] - 9, target[1] - 4]);
    for (const [id, path] of [["T", 0], ["A", 0], ["B", 0], ["C", 0], ["D", -1]] as const) {
        const points = positions(before, id, path);
        assert.deepEqual(positions(result, id, path), [...shifted([points[0]], [4, -2]), ...points.slice(1)]);
        assert.deepEqual(geometryPath(preview.nodes.get(id)!.node, path)!.nodes.map(n => n.p), positions(result, id, path));
    }
    const after = serializeDesign(d), geometry = { kind: "geometry" as const, id: first.curve };
    assert.equal(controlPreview(d, result, curveGraph(d), geometry, body, false), undefined);
    commitControl(d, geometry, body, target, false);
    assert.equal(serializeDesign(d), after);
});

test("Shared profiles edit independently and synchronize node records without rewriting stable references", () => {
    const { d, primary, t } = fixture(), f = t.function;
    assert(f.type === "mountain");
    const second = { curve: primary.curve, h: { p0: 10, p2: 30 }, slope: { p0: .8, p2: .8 }, offset: [4, 1] as Point };
    f.ridges.push(second);
    primary.h!.p0 = 15;
    assert.equal(expressionGraph(d).get("geo:T.ridges.1.h.p0"), 10);
    d.inputs.end = { value: "{geo:T.ridges.0.h.p2} + {geo:T.ridges.1.h.p2}", range: defaultInputRange("end") };
    const added = insertCurveNode(d, t, { role: "segment", path: -1, index: 0, point: [-12, -10.2] })!;
    assert(added);
    const { id } = added, other = geo(d, "C").function;
    assert(other.type === "slope");
    for (const holder of [primary, owned(f.ridges[1]), owned(other.lines[0])]) {
        assert(Number.isFinite(holder.h?.[id]));
        assert(holder.interpolate?.[id].includes("h"));
    }
    assert.equal(expressionGraph(d).get("input:end"), 52);
    assert.equal(d.inputs.end.value, "{geo:T.ridges.0.h.p2} + {geo:T.ridges.1.h.p2}");
    d.inputs.removed = { value: "{geo:B.ridges.0.h." + id + "}", range: defaultInputRange("removed") };
    assert.throws(() => removeCurveNode(d, t, vertex(added.p, -1, 1)), /仍被引用.*removed/s);
    delete d.inputs.removed;
    removeCurveNode(d, t, vertex(added.p, -1, 1));
    for (const holder of [primary, owned(f.ridges[1]), owned(other.lines[0])]) assert(!Object.hasOwn(holder.h!, id));
    assert.equal(expressionGraph(d).get("input:end"), 52);
    assert.doesNotThrow(() => parseDesign(d));
});

test("Curve switching keeps the offset, interpolates new nodes, and unlinks without changing readings", () => {
    const d: Design = syntheticDesign(), t = geo(d, "T");
    const source = owned(fixtureCurve(d, { curve: openCurve([{ p: [0, 0], h: 10, slope: 2 }, { p: [4, 0], h: 30, slope: 4 }]), offset: [2, 3] }, ["h", "slope"]));
    t.function = { type: "mountain", ridges: [source], valleys: [], peaks: [] };
    d.geometry.next = { label: "另一条", independent: true, curve: openCurve([{ p: [0, 0] }, { p: [2, 0] }, { p: [4, 0] }], "corner", "next-") };
    const before = structuredClone(d), key = ridge("T") + ".curve";
    setCurveReference(d, key, "curve:next");
    removeUnusedGeometry(before, d);
    assert(!Object.hasOwn(d.geometry, source.curve));
    assert(t.function.type === "mountain");
    const held = owned(t.function.ridges[0]);
    assert.deepEqual(held, { curve: "next", offset: [2, 3], h: { "next-0": 10, "next-1": 20, "next-2": 30 },
        slope: { "next-0": 2, "next-1": 3, "next-2": 4 }, interpolate: { "next-1": ["h", "slope"] } });
    const placed = geo(resolveDesign(d), "T").function;
    setCurveReference(d, key);
    const unlinked = owned(t.function.ridges[0]);
    assert.notEqual(unlinked.curve, held.curve);
    assert.equal(geometryAt(d, unlinked.curve)?.independent, undefined);
    assert.deepEqual({ ...unlinked, curve: held.curve }, held);
    assert.deepEqual(geo(resolveDesign(d), "T").function, placed);

    const a = addLayer(d, "A", rect(5, 5, 10, 10), { type: "mountain", ridges: [ref(ridge("T"))], valleys: [], peaks: [] });
    d.geoNodes.push(a);
    setCurveReference(d, ridge("A") + ".curve");
    assert(a.function.type === "mountain");
    const fromAlias = owned(a.function.ridges[0]);
    assert.notEqual(fromAlias.curve, unlinked.curve);
    assert.deepEqual({ ...fromAlias, curve: unlinked.curve }, unlinked);
    assert.deepEqual(geo(resolveDesign(d), "A").function, placed);
});

test("Copies keep node IDs, rebase internal holders and retain geometry shared outside the copy", () => {
    const { d, t, first, primary, peak } = fixture();
    // These aliases reference the original holders, so they keep the originals in use.
    assert(t.construction.type === "outline" && t.function.type === "mountain");
    const own = owned(t.construction.outlines[1]);
    t.construction.outlines.push(ref(outline("T", 1)));
    d.geometry[primary.curve].independent = true;
    t.function.ridges.push(ref(ridge("T")));
    t.function.floor = "{geo:T.ridges.1.h.p0}";
    const copy = copyGeo(d, t), c = copy.construction, f = copy.function;
    assert(c.type === "outline" && f.type === "mountain");
    assert.deepEqual(c.outlines[0], first);
    assert.deepEqual(f.ridges[0], primary);
    assert.notEqual(owned(c.outlines[1]).curve, own.curve);
    assert.deepEqual(literalCurve(d, c.outlines[1]), literalCurve(d, own));
    assert.deepEqual(c.outlines[2], ref(outline(copy.id, 1)));
    assert.notEqual(f.peaks[0].at.point, peak.point);
    assert.deepEqual(placedPoint(d, f.peaks[0].at), placedPoint(d, peak));
    assert.deepEqual(f.ridges[1], ref(ridge(copy.id)));
    assert.equal(f.floor, "{geo:" + copy.id + ".ridges.1.h.p0}");
    assert.equal(expressionGraph(d).get("geo:" + copy.id + ".floor"), 14);

    const strip = createStrip(d, [t.id], { from: literalCurve(d, first).nodes[0].id, to: literalCurve(d, first).nodes[1].id });
    assert.deepEqual(copyGeo(d, strip).construction, strip.construction);
    assert.doesNotThrow(() => parseDesign(d));
});

test("Subitem edits shift holder indices and keep node IDs and quantities", () => {
    const { d, t, primary } = fixture();
    assert(t.function.type === "mountain");
    const other = { ...structuredClone(primary), h: { p0: 10, p2: 20 } };
    t.function.ridges.push(other);
    primary.h!.p0 = "{geo:T.ridges.1.h.p0}";
    d.inputs.reader = { value: "{geo:T.ridges.1.h.p2}", range: defaultInputRange("reader") };
    copyGeometryItem(d, t, ["ridges"], 0);
    const [a, b, c] = t.function.ridges.map(owned);
    assert.equal(a.curve, b.curve, "Outside holders keep using the same geometry");
    assert.equal(a.h!.p0, "{geo:T.ridges.2.h.p0}");
    assert.deepEqual(a, b);
    assert.equal(c.h!.p2, 20);
    assert.equal(d.inputs.reader.value, "{geo:T.ridges.2.h.p2}");
    removeGeometryItem(d, t, ["ridges"], 1);
    assert.equal(d.inputs.reader.value, "{geo:T.ridges.1.h.p2}");
    assert.doesNotThrow(() => parseDesign(d));
});

test("Moving a section changes its placements, while a point edit reaches every holder", () => {
    const d: Design = syntheticDesign(), shared = holdPoint(d, [3, 4]);
    const start = { ...shared, offset: [5, -3] as Point }, end = holdPoint(d, [17, 9]);
    d.sections.push({ id: "S", label: "S", points: [start, end] });
    const mark = { id: "A", label: "A", kind: "text", follow: "map", point: { ...shared }, screen: [40, 50] } as const;
    d.marks.push({ ...mark, screen: [...mark.screen] });
    const before = structuredClone(d.geometry);
    moveSection(d, "S", [2, 3]);
    assert.deepEqual(d.geometry, before);
    assert.deepEqual(resolveDesign(d).sections[0].points, [[10, 4], [19, 12]]);
    assert.deepEqual(resolveDesign(d).marks[0].point, [3, 4]);

    moveHandle(d, { kind: "section", id: "S", role: "vertex", index: 0, point: [10, 4] }, [11, 7]);
    assert.deepEqual(geometryAt(d, shared.point), { ...before[shared.point], point: [4, 7] });
    assert.deepEqual(resolveDesign(d).sections[0].points, [[11, 7], [19, 12]]);
    assert.deepEqual(resolveDesign(d).marks[0].point, [4, 7]);
});

test("Editor deletes exclusive geometry in one undo step and blocks deleting in-use geometry", async () => {
    await import("../configs/register-svelte.ts");
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d: Design = syntheticDesign(), t = geo(d, "T");
    assert(t.construction.type === "outline");
    const outline = owned(t.construction.outlines[0]).curve, peak = holdPoint(d, [-4, 1]);
    const center = holdPoint(d, [-4, 2]);
    d.geometry[center.point].independent = true;
    t.function = { type: "slope", kind: "radial", center, radius: 2, value: 2, rate: -.2, lines: [
        { ...owned(fixtureCurve(d, { curve: openCurve([{ p: [-4, 2] }, { p: [-4, 3] }]) })), h: { "node-0": 0, "node-1": 1 } }
    ] };
    d.sections.push(fixtureSection(d, { id: "S", label: "S", points: [[0, 0], [3, 4]] }));
    const replaced = d.sections[0].points[0].point;
    d.sections[0].points[0] = peak;
    delete d.geometry[replaced];
    d.marks.push(fixtureMark(d, { id: "A", label: "A", kind: "text", follow: "map", point: [1, 2] }));
    const editor = new Editor(testTerrainClient());
    Object.assign(editor, { map: { frame() {}, visibleMarkPoint: (mark: { point: Point }) => mark.point, world: (x: number, y: number) => [x, y] } });
    await editor.replace(d, true);
    editor.history = new History(editor.project.design);
    const before = serializeDesign(editor.project.design);
    assert.throws(() => removeDeclaration(d, "geometry", outline), /仍被引用/);
    assert.equal(removalUses(d, "geometry", center.point).length, 1);
    editor.removeElement({ kind: "geometry", id: outline });
    assert.equal(editor.removal?.detail, "以下位置仍在使用它，请先修改。");
    assert.equal(editor.removal?.items?.[0].text, "“T.轮廓 1”");
    await editor.edit(draft => {
        assert(deleteGeo(draft, "T"));
    });
    const next = editor.project.design;
    assert(!geometryAt(next, outline));
    assert(geometryAt(next, center.point));
    assert.equal(geometryUsers(next).size, 4);
    await editor.navigate(false);
    assert.equal(serializeDesign(editor.project.design), before);

    const point = editor.project.design.marks[0].point;
    const read = () => editor.project.resolved.marks[0].point;
    await editor.setMarkFollow("A", "screen");
    assert.deepEqual(read(), [1, 2]);
    assert.deepEqual(editor.project.design.marks[0].screen, [1, 2]);
    await editor.setMarkFollow("A", "map");
    assert.deepEqual(read(), [1, 2]);
    assert.deepEqual(editor.project.design.marks[0].point, point);
    assert.deepEqual(JSON.parse(serializeDesign(editor.project.design)).marks[0].screen, [1, 2]);
});

test("Dragging a geometry curve moves every placement without changing the holders", () => {
    const { d, first } = fixture(), before = resolveDesign(d), holders = structuredClone(d.geoNodes);
    const selected = { kind: "geometry" as const, id: first.curve };
    const control: GeoControl = { role: "curve", path: -1, index: 0, point: [5, 6] };
    const at: Point = [8, 10], delta: Point = [3, 4];
    const preview = controlPreview(d, before, curveGraph(d), selected, control, false)!(at);
    commitControl(d, selected, control, at, false);
    const after = resolveDesign(d);
    assert.deepEqual(d.geoNodes, holders);
    assert.deepEqual(preview.geometry, d.geometry[first.curve]);
    for (const id of ["T", "A", "B", "C"]) {
        const expected = shifted(positions(before, id), delta);
        assert.deepEqual(positions(after, id), expected);
        assert.deepEqual(geometryPath(preview.nodes.get(id)!.node, 0)!.nodes.map(n => n.p), expected);
    }
});

test("Geometry reference count includes the independent reference and prunes one edit at a time", () => {
    const d = syntheticDesign(), holder = geo(d, "T").construction;
    assert(holder.type === "outline");
    const id = owned(holder.outlines[0]).curve, orphan = holdPoint(d, [0, 0]).point, standalone = holdPoint(d, [2, 4]).point;
    setGeometryIndependent(d, standalone, true);
    setGeometryIndependent(d, id, true);
    const used = structuredClone(d);
    setGeometryIndependent(used, id, false);
    removeUnusedGeometry(d, used);
    assert(geometryAt(used, id));
    assert.equal(geometryAt(used, id)?.independent, undefined);
    assert.throws(() => removeDeclaration(used, "geometry", id), /仍被引用/);
    assert.throws(() => removeDeclaration(used, "geometry", orphan), /只能删除独立/);

    const next = structuredClone(used);
    assert(deleteGeo(next, "T"));
    removeUnusedGeometry(used, next);
    assert(!geometryAt(next, id));
    assert(geometryAt(next, orphan));
    assert(geometryAt(next, standalone)?.independent);

    const unchecked = structuredClone(next);
    setGeometryIndependent(unchecked, standalone, false);
    removeUnusedGeometry(next, unchecked);
    assert(!geometryAt(unchecked, standalone));
    const removed = structuredClone(next);
    removeDeclaration(removed, "geometry", standalone);
    removeUnusedGeometry(next, removed);
    assert.deepEqual(removed, unchecked);
});

test("A map curve pick uses the same edit as the geometry row and Ctrl starts a redraw", async () => {
    await import("../configs/register-svelte.ts");
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const { draftPointer } = await import("../src/app/state/geoTools.ts");
    const { ProjectMap } = await import("../src/render/map.ts");
    const d = syntheticDesign();
    d.geometry.next = { label: "备选轮廓", independent: true, curve: rect(10, 10, 20, 20).outlines[0].curve };
    const editor = new Editor(testTerrainClient());
    const map = { scale: 8, frame() {}, canvas: { focus() {} }, pickCurve: ProjectMap.prototype.pickCurve };
    Object.assign(editor, { map });
    await editor.replace(d, true);
    editor.history = new History(editor.project.design);
    const before = serializeDesign(editor.project.design), key = outline("T") + ".curve";
    editor.select(selection("T"));
    await editor.changeCurveReference(editor.curves.slots.get(key)!, "curve:next", true);
    const replaced = serializeDesign(editor.project.design);
    await editor.navigate(false);
    assert.equal(serializeDesign(editor.project.design), before);

    editor.layers.geometry = true;
    const at: Point = [15, 10], click = { ctrlKey: false, shiftKey: false, altKey: false };
    editor.select(selection("T"));
    editor.pickOrRedrawCurve(key, "曲线");
    draftPointer(editor, "down", at, click);
    draftPointer(editor, "up", at, click);
    await editor.finishWork();
    assert.equal(serializeDesign(editor.project.design), replaced);

    await editor.navigate(false);
    editor.select(selection("T"));
    editor.pickOrRedrawCurve(key, "曲线");
    const ctrl = { ...click, ctrlKey: true };
    draftPointer(editor, "down", at, ctrl);
    draftPointer(editor, "up", at, ctrl);
    assert.deepEqual(editor.geoDraft?.nodes.map(node => node.p), [at]);
    assert.equal(serializeDesign(editor.project.design), before);
    editor.cancelDrawing();
    editor.dispose();
});