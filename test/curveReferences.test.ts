import assert from "node:assert/strict";
import { test } from "node:test";
import { finishCurveDraft } from "../src/app/state/geoTools.ts";
import { curveGraph } from "../src/core/design/curveReferences.ts";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { numberEdits } from "../src/core/design/numberEdit.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { type CurveRef, type Design, type Point } from "../src/core/design/v5.ts";
import { editCurve, editCurveSource, setCurveReference } from "../src/core/edit/curveEdits.ts";
import { commitControl, copyGeometryItem, geometryPath, geometrySelection, removeCurveNode, removeGeometryItem, resolveGeometrySelection } from "../src/core/edit/geoControls.ts";
import { copyGeo, deleteGeo, removeDeclaration } from "../src/core/edit/geoNodes.ts";
import { History } from "../src/core/edit/history.ts";
import { penNode, retractHandle, translateGeo } from "../src/core/edit/paths.ts";
import { type GeoDraft } from "../src/core/edit/types.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { evaluateStack } from "../src/core/terrain/terrain.ts";
import { layer, literalCurve, openCurve, rect, syntheticDesign } from "./scenarios.ts";

const ring = "geo:T.construction.outlines.0", ridge = "geo:M.ridges.0.line", slope = "geo:S.line";
const reference = (key: string, offset?: Point): CurveRef<never> => ({ ref: "{" + key + "}", ...(offset && { offset }) });
const geo = (d: Design, id: string) => d.geoNodes.find(n => n.id === id)!;

function fixture() {
    const d: Design = syntheticDesign(), t = geo(d, "T");
    t.label = "西台";
    d.curves.ring = { label: "湖", curve: rect(-22, -15, -7, -2).outlines[0] };
    d.curves.line = { label: "路径", curve: openCurve<never>([{ p: [-16, -12] }, { p: [-11, -10] }, { p: [-9, -3] }], "auto", "v") };
    t.construction = { type: "outline", outlines: [reference("curve:ring", [2, -3]), rect(13, 13, 17, 17).outlines[0]] };
    d.geoNodes.splice(1, 0, layer("A", { type: "outline", outlines: [reference(ring, [5, 4])] }, { type: "flat", amount: 3 }));
    t.disabled = true;
    d.geoNodes.push(
        layer("M", rect(-35, -25, 25, 25), { type: "mountain", ridges: [
            { slope: 1.25, line: { ...reference("curve:line", [2, 1]), h: { v0: 9, v2: "{input:A} + 15" } } }
        ], peaks: [] }),
        layer("S", rect(-30, -22, 24, 22), { type: "slope", kind: "path",
            line: { ...reference(ridge, [-1, 3]), h: { v0: 3, v2: 6 } } })
    );
    d.inputs.height = { value: "{geo:M.ridges.0.line.h.v2}", range: defaultInputRange("height") };
    return d;
}

test("Outline-only storage and optional shared curve declarations round-trip", () => {
    const d = syntheticDesign(), text = serializeDesign(d);
    assert(!Object.hasOwn(JSON.parse(text), "curves"));
    assert.deepEqual(parseDesign(text).curves, {});
    const outline = d.geoNodes[0].construction;
    assert(outline.type === "outline");
    Object.assign(outline, { type: "free" });
    assert.throws(() => parseDesign(d), /construction.type 是未知取值/);
    const refs = fixture(), t = geo(refs, "T");
    assert(t.construction.type === "outline");
    t.construction.outlines[0] = reference("curve:ring", [0, 0]);
    assert.deepEqual(JSON.parse(serializeDesign(refs)).geoNodes[2].construction.outlines[0], { ref: "{curve:ring}" });
    assert.deepEqual(parseDesign(serializeDesign(refs)).curves, refs.curves);
});

test("Retracting a handle through a reference edits its source", () => {
    const d = fixture();
    const placement = { kind: "geoNode", id: "S" } as const;
    const before = structuredClone(geo(d, placement.id).function);
    editCurve(d, placement, -1, curve => retractHandle(curve, 1, "in"));

    const source = d.curves.line.curve.nodes[1];
    assert.equal(source.mode, "corner");
    assert(!Object.hasOwn(source, "in"));
    assert(source.out);
    assert.deepEqual(geo(d, placement.id).function, before);
    const resolved = resolveDesign(d);
    const node = geometryPath(geo(resolved, placement.id), -1)!.nodes[1];
    assert.equal(node.mode, "corner");
    assert(!Object.hasOwn(node, "in"));
    assert.deepEqual(node.out, source.out);
});

test("Chained references use the same terrain and masks as equivalent literal curves", () => {
    const d = parseDesign(fixture()), r = resolveDesign(d);
    const a = r.geoNodes[1].construction;
    assert(a.type === "outline");
    assert.deepEqual(a.outlines[0].nodes[0].p, [-15, -14]);
    const m = r.geoNodes[3].function, s = r.geoNodes[4].function;
    assert(m.type === "mountain" && s.type === "slope" && s.kind === "path");
    assert.deepEqual(m.ridges[0].line.nodes.map(v => v.h), [9, undefined, 22]);
    assert.deepEqual(s.line.nodes.map(v => v.h).filter(value => value !== undefined).filter((_, i) => i !== 1), [3, 6]);
    assert.deepEqual(s.line.nodes[0].p, [-15, -8]);
    assert.equal(r.inputs.height.value, 22);
    const literal = structuredClone(d), t = geo(literal, "T"), l = geo(literal, "A"), mountain = geo(literal, "M"), terrainSlope = geo(literal, "S");
    assert(t.construction.type === "outline" && l.construction.type === "outline" && mountain.function.type === "mountain" &&
        terrainSlope.function.type === "slope" && terrainSlope.function.kind === "path");
    const placed = <C extends typeof d.curves.line.curve>(c: C, x: number, y: number): C => ({
        ...c, nodes: c.nodes.map(n => ({ ...n, p: [n.p[0] + x, n.p[1] + y] as Point }))
    });
    const coast = layer("C", rect(-42, -20, 42, 20), { type: "coast", shore: reference(ring), roughness: 0, harbor: { center: [0, 0], span: 3, radius: 0 } });
    d.geoNodes.push(coast);
    literal.geoNodes.push({ ...coast, function: { ...coast.function, type: "coast", shore: placed(literalCurve(d.curves.ring.curve as ReturnType<typeof rect>["outlines"][0]), 2, -3),
        roughness: 0, harbor: { center: [0, 0], span: 3, radius: 0 } } });
    const closed = literalCurve(d.curves.ring.curve as ReturnType<typeof rect>["outlines"][0]);
    t.construction.outlines[0] = placed(closed, 2, -3);
    l.construction.outlines[0] = placed(closed, 7, 1);
    const withHeights = (x: number, y: number, start: number, end: number) => ({
        ...d.curves.line.curve,
        nodes: placed(d.curves.line.curve, x, y).nodes.map((v, i) => ({ ...v, ...(i !== 1 && { h: i === 0 ? start : end }) }))
    });
    mountain.function.ridges[0].line = withHeights(2, 1, 9, 22);
    terrainSlope.function.line = withHeights(1, 4, 3, 6);
    literal.inputs.height.value = 22;
    const cache = new TerrainCache(), output = cache.generate(d), expected = evaluateStack(parseDesign(literal));
    assert.deepEqual(output.fields.height, expected.fields.height);
    for (const [id, region] of output.regions) assert.deepEqual(region.mask, expected.regions.get(id)!.mask);
    d.curves.ring.curve.nodes[0].p = [-25, -14];
    assert.notDeepEqual(cache.generate(d).regions.get("A")!.mask, output.regions.get("A")!.mask);
    assert(cache.recomputed.includes("A"));
});

test("References validate scope, required closure, cycles, offsets and height keys at their placement", () => {
    const d = fixture(), t = geo(d, "T"), m = geo(d, "M");
    assert(t.construction.type === "outline" && m.function.type === "mountain");
    t.construction.outlines[0] = reference("curve:line");
    assert.throws(() => parseDesign(d), /construction.outlines\[0\].ref.*闭合曲线/);
    t.construction.outlines[0] = reference("geo:A.construction.outlines.0");
    assert.throws(() => parseDesign(d), /引用成环：[\s\S]*“A.轮廓 1”[\s\S]*“西台.轮廓 1”/);
    t.construction.outlines[0] = reference("geo:M.ridges.0.slope");
    assert.throws(() => parseDesign(d), /找不到曲线/);
    t.construction.outlines[0] = reference("curve:ring", [Infinity, 2]);
    assert.throws(() => parseDesign(d), /offset.*有限数/);
    t.construction.outlines[0] = Object.assign(reference("curve:ring"), { h: { "0": 1 } });
    assert.throws(() => parseDesign(d), /outlines\[0\].h.*不能有高度/);
    for (const field of [{ closed: true }, { nodes: [] }]) {
        t.construction.outlines[0] = { ...reference("curve:ring"), ...field };
        assert.throws(() => parseDesign(d), /construction.outlines\[0\].*是未知字段/);
    }
    t.construction.outlines[0] = reference("curve:ring");
    m.function.ridges[0].line = { ...reference("curve:line"), h: { missing: 1 } };
    assert.throws(() => parseDesign(d), /function.ridges\[0\].line.h.missing 找不到节点/);
    m.function.ridges[0].line = { ...reference("curve:line"), h: { v2: 1 } };
    Object.assign(d.curves.line.curve.nodes[0], { h: 0 });
    assert.throws(() => parseDesign(d), /curves.line.curve.nodes\[0\].h.*不能有高度/);
});

test("Shape edits write through offsets and duplicate placements keep their own offset", () => {
    const d = fixture(), id = { kind: "geoNode", id: "A" } as const;
    const graph = curveGraph(d), slot = graph.slots.get("geo:A.construction.outlines.0")!;
    const p = graph.materialize(slot).nodes[0].p;
    commitControl(d, id, { role: "vertex", path: 0, index: 0, point: p }, [-14, -12], false);
    assert.deepEqual(d.curves.ring.curve.nodes[0].p, [-21, -13]);
    const a = geo(d, "A"), t = geo(d, "T"), shared = structuredClone(d.curves);
    assert(a.construction.type === "outline" && t.construction.type === "outline");
    const other = structuredClone(t.construction);
    const beforeMove = curveGraph(d), aPlacement = beforeMove.materialize(beforeMove.slots.get(slot.key)!);
    commitControl(d, { kind: "geoNode", id: "T" }, { role: "body", path: 0, index: 0, point: [0, 0] }, [8, 7], false);
    const shifted = curveGraph(d);
    assert.deepEqual(shifted.materialize(shifted.slots.get(slot.key)!).nodes.map(n => n.p), aPlacement.nodes.map(n => [n.p[0] + 8, n.p[1] + 7]));
    assert.deepEqual(t.construction.outlines[0], reference("curve:ring", [10, 4]));
    assert.deepEqual(literalCurve(t.construction.outlines[1]).nodes[0].p, [21, 20]);
    assert.deepEqual(d.curves, shared);
    const copy = copyGeo(d, a);
    assert.deepEqual(copy.construction, a.construction);
    translateGeo(copy, [14, 3]);
    assert(a.construction.type === "outline" && copy.construction.type === "outline");
    assert.deepEqual(a.construction.outlines[0], reference(ring, [5, 4]));
    assert.deepEqual(copy.construction.outlines[0], reference(ring, [19, 7]));
    assert.notDeepEqual(t.construction, other);

    const current = curveGraph(d), cp = current.slots.get("geo:" + copy.id + ".construction.outlines.0")!;
    const placed = current.materialize(cp);
    setCurveReference(d, cp.key);
    assert.deepEqual(copy.construction.outlines[0], placed);
    assert.deepEqual(d.curves, shared);
});

test("Moving a landform is inherited all along its curve reference chain", () => {
    const d: Design = syntheticDesign();
    const a = layer("A", rect(-20, -12, -11, -4), { type: "flat", amount: 1 });
    const b = layer("B", { type: "outline", outlines: [reference("geo:A.construction.outlines.0")] }, { type: "flat", amount: 2 });
    const c = layer("C", { type: "outline", outlines: [reference("geo:B.construction.outlines.0", [10, 2])] }, { type: "flat", amount: 3 });
    d.geoNodes.push(a, b, c);
    assert(a.construction.type === "outline" && b.construction.type === "outline" && c.construction.type === "outline");
    const body = { role: "body", path: 0, index: 0, point: [0, 0] } satisfies Parameters<typeof commitControl>[2];
    const positions = () => resolveDesign(d).geoNodes.slice(-3).map(n => {
        assert(n.construction.type === "outline");
        return n.construction.outlines[0].nodes.map(v => v.p);
    });
    const move = (id: string, delta: Point) => commitControl(d, { kind: "geoNode", id }, body, delta, false);
    const translate = (points: Point[], [x, y]: Point): Point[] => points.map(p => [p[0] + x, p[1] + y]);
    const before = positions(), afterA = before.map(p => translate(p, [3, -2]));
    move("A", [3, -2]);
    assert.deepEqual(positions(), afterA);
    assert.deepEqual(b.construction.outlines[0], reference("geo:A.construction.outlines.0"));
    const afterB = [afterA[0], ...afterA.slice(1).map(p => translate(p, [-4, 5]))];
    move("B", [-4, 5]);
    assert.deepEqual(positions(), afterB);
    assert.deepEqual(b.construction.outlines[0], reference("geo:A.construction.outlines.0", [-4, 5]));
    assert.deepEqual(c.construction.outlines[0], reference("geo:B.construction.outlines.0", [10, 2]));

    const [outline] = a.construction.outlines;
    assert("nodes" in outline);
    d.curves.reference = { label: "共享形状", curve: outline };
    a.construction.outlines[0] = reference("curve:reference");
    const shapeBefore = structuredClone(d.curves.reference.curve);
    assert.deepEqual(positions(), afterB);
    commitControl(d, { kind: "curve", id: "reference" }, { ...body, role: "curve", path: -1 }, [7, -3], false);
    assert.deepEqual(d.curves.reference.curve.nodes.map(n => n.p), translate(shapeBefore.nodes.map(n => n.p), [7, -3]));
    assert.deepEqual(a.construction.outlines[0], reference("curve:reference", [-7, 3]));
    assert.deepEqual(positions(), afterB);
    assert.deepEqual(c.construction.outlines[0], reference("geo:B.construction.outlines.0", [10, 2]));
});

test("Curves in the same landform inherit a move once when their source is moved with them", () => {
    const d: Design = syntheticDesign(), a = geo(d, "T");
    assert(a.construction.type === "outline");
    a.construction.outlines.push(reference(ring, [12, 3]));
    const b = layer("A", { type: "outline", outlines: [reference("geo:T.construction.outlines.1", [4, 1])] }, { type: "flat", amount: 2 });
    d.geoNodes.push(b);
    const move = { role: "body", path: 0, index: 0, point: [0, 0] } satisfies Parameters<typeof commitControl>[2];
    commitControl(d, { kind: "geoNode", id: "T" }, move, [4, 6], false);
    assert.deepEqual(a.construction.outlines[1], reference(ring, [12, 3]));
    const r = resolveDesign(d);
    assert.deepEqual(geometryPath(r.geoNodes[1], 0)!.nodes[0].p, [-17, -8]);
    assert.deepEqual(geometryPath(r.geoNodes[1], 1)!.nodes[0].p, [-5, -5]);
    assert.deepEqual(geometryPath(r.geoNodes[2], 0)!.nodes[0].p, [-1, -4]);
});

test("Removing source nodes cleans local heights in a chain and numeric edits target the placement", () => {
    const d = fixture(), s = geo(d, "S"), m = geo(d, "M");
    assert(s.function.type === "slope" && s.function.kind === "path" && m.function.type === "mountain");
    const first = ["geoNodes", 3, "function", "ridges", 0, "line", "h", "v1"];
    const change = numberEdits(d, resolveDesign(d)).validate(first, 12);
    assert.deepEqual(change.resolved.find(edit => edit.value === 12)?.address, ["geoNodes", 3, "function", "ridges", 0, "line", "nodes", 1, "h"]);
    const mr = m.function.ridges[0].line, sr = s.function.line;
    assert("ref" in mr && "ref" in sr && mr.h && sr.h);
    mr.h.v1 = 12;
    sr.h.v1 = 8;
    assert.throws(() => removeDeclaration(d, "curve", "line"), /仍被引用.*M.山脊 1 山脊线/s);
    assert.throws(() => deleteGeo(d, "M"), /仍被引用.*S.坡线/s);
    assert.throws(() => removeGeometryItem(d, m, ["ridges"], 0), /仍被引用.*S.坡线/s);
    removeCurveNode(d, { kind: "curve", id: "line" }, { role: "vertex", path: -1, index: 1, point: [-11, -10] });
    assert.deepEqual(Object.keys(mr.h), ["v0", "v2"]);
    assert.deepEqual(Object.keys(sr.h), ["v0", "v2"]);
    assert.doesNotThrow(() => parseDesign(d));

    const before = structuredClone(resolveDesign(d).geoNodes[3].function);
    setCurveReference(d, ridge);
    const after = resolveDesign(d);
    assert.deepEqual(after.geoNodes[3].function, before);
    assert.equal(d.inputs.height.value, "{geo:M.ridges.0.line.nodes.1.h}");
    assert.equal(after.inputs.height.value, 22);
});

test("Copy and remove adjust indexed references without changing their source, even with duplicate node IDs", () => {
    const d = fixture(), t = geo(d, "T");
    assert(t.construction.type === "outline");
    const old = "geo:T.construction.outlines.1", a = geo(d, "A");
    assert(a.construction.type === "outline");
    a.construction.outlines[0] = reference(old);
    copyGeometryItem(d, t, ["construction", "outlines"], 0);
    assert.deepEqual(a.construction.outlines[0], reference("geo:T.construction.outlines.2"));
    assert.deepEqual(t.construction.outlines[1], t.construction.outlines[0]);
    const display = resolveDesign(d).geoNodes.find(n => n.id === "T")!;
    const part = geometrySelection(display, { role: "vertex", path: 1, index: 0 })!;
    assert.equal(resolveGeometrySelection(display, part)?.path, 1);
    removeGeometryItem(d, t, ["construction", "outlines"], 0);
    assert.deepEqual(a.construction.outlines[0], reference(old));
    assert.throws(() => removeGeometryItem(d, t, ["construction", "outlines"], 1), /仍被引用.*A.轮廓 1/s);
    const m = geo(d, "M"), s = geo(d, "S");
    assert(m.function.type === "mountain" && s.function.type === "slope" && s.function.kind === "path");
    m.function.ridges.unshift({ line: structuredClone(d.curves.line.curve), slope: 2 });
    s.function.line = reference("geo:M.ridges.1.line");
    d.inputs.height.value = "{geo:M.ridges.1.line.h.v2}";
    copyGeometryItem(d, m, ["ridges"], 0);
    assert.deepEqual(s.function.line, reference("geo:M.ridges.2.line"));
    assert.equal(d.inputs.height.value, "{geo:M.ridges.2.line.h.v2}");
    removeGeometryItem(d, m, ["ridges"], 0);
    assert.deepEqual(s.function.line, reference("geo:M.ridges.1.line"));
});

test("Continue drawing prepends or appends source nodes, keeps heights sparse and groups undo", () => {
    for (const endpoint of [0, 2]) for (const closed of [false, true]) {
        const d = fixture(), before = serializeDesign(d), history = new History(d), graph = curveGraph(d), slot = graph.slots.get(slope)!;
        const draft: GeoDraft = { tool: "continueCurve", owner: "S", ids: ["S"], nodes: [penNode("", [5, 7], [7, 8]), penNode("", [2, 8])],
            anchors: [], reverse: false, closed, curve: { key: slope, name: "S.坡线", original: graph.materialize(slot), endpoint, pen: "terrain", requiredClosed: false } };
        const last = finishCurveDraft(d, draft);
        const authored = d.curves.line.curve, added = authored.nodes.filter(n => !n.id.startsWith("v"));
        assert.equal(authored.closed, closed);
        assert.equal(added.length, 2);
        assert.equal(added[endpoint === 0 ? 0 : 1].id, last);
        assert.deepEqual(added.map(n => n.p), endpoint === 0 ? [[1, 4], [4, 3]] : [[4, 3], [1, 4]]);
        assert(added.every(n => !Object.hasOwn(n, "h")));
        const n = added.find(v => v.mode === "manual")!;
        assert.deepEqual(n.out, endpoint === 0 ? [-2, -1] : [2, 1]);
        assert.deepEqual(authored.nodes.filter(n => n.id.startsWith("v")).map(n => n.id), ["v0", "v1", "v2"]);
        assert.doesNotThrow(() => parseDesign(d));
        assert(history.record(d));
        assert.equal(serializeDesign(history.step(false)), before);
    }
});

test("Redrawing through a reference updates the source and discards per-placement heights for removed IDs", () => {
    const d = fixture(), m = geo(d, "M"), s = geo(d, "S");
    assert(m.function.type === "mountain" && s.function.type === "slope" && s.function.kind === "path");
    delete d.inputs.height;
    editCurveSource(d, slope, (curve, local) => {
        curve.nodes = [penNode("replacement-a", local([6, 4])), penNode("replacement-b", local([9, 2]))];
    });
    assert.deepEqual(d.curves.line.curve.nodes.map(n => n.p), [[5, 0], [8, -2]]);
    assert.deepEqual(m.function.ridges[0].line, reference("curve:line", [2, 1]));
    assert.deepEqual(s.function.line, reference(ridge, [-1, 3]));
    assert.deepEqual(geometryPath(resolveDesign(d).geoNodes[4], -1)?.nodes.map(n => n.p), [[6, 4], [9, 2]]);
});