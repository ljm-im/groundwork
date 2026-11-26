import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { DesignError } from "../src/core/design/problems.ts";
import { autoHandle, flattenPath, pathBezier, segmentType, splitBezier, type Bezier } from "../src/core/design/path.ts";
import { numericProfile } from "../src/core/design/polyline.ts";
import { type ClosedCurve, type Curve, type Point } from "../src/core/design/v5.ts";
import { defaultFunction, curvesOf } from "../src/core/edit/geoNodes.ts";
import { copyGeometryItem, insertCurveNode, removeCurveNode, removeCurveSegment } from "../src/core/edit/geoControls.ts";
import { arcHandle, editWholeCurve, insertPathNode, moveHandle, penNode, penPath, removePathSegment, segmentRemovalIndex,
    setNodeMode, setSegment } from "../src/core/edit/paths.ts";
import { distance, mixPoint, spline, stations } from "../src/core/math/geometry.ts";
import { literalCurve, openCurve, syntheticDesign } from "./scenarios.ts";

const at = (curve: Bezier, t: number) => splitBezier(curve, t)[0][3];
const points: Point[] = [[1, 2], [5, 8], [10, 0], [14, 4], [22, 1]];
const line = (mode: "corner" | "auto" = "corner") => openCurve(points.map(p => ({ p: [...p] as Point })), mode);

test("An open curve has no closing segment and uses the Catmull-Rom endpoint handles", () => {
    const path = line("auto"), segments = flattenPath(path, .05);
    assert.deepEqual(autoHandle(path, 0, "out"), [4 / 6, 1]);
    assert.deepEqual(autoHandle(path, 4, "in"), [-8 / 6, .5]);
    assert.deepEqual(segments[0].a, points[0]);
    assert.deepEqual(segments.at(-1)?.b, points.at(-1));
    assert(!segments.some(s => s.from === path.nodes.at(-1)?.id));
    assert.equal(flattenPath(line(), .05).length, points.length - 1);
    const divisions = 50, old = spline(points, false, divisions);
    for (let i = 0; i < points.length - 1; i++) for (let j = 0; j <= divisions; j++)
        assert(distance(at(pathBezier(path, i), j / divisions), old[i * divisions + j]) < 1e-9);
});

test("A closed profile interpolates over the seam and an open profile holds the endpoint values", () => {
    const path = openCurve([{ p: [0, 0] }, { p: [10, 0], h: 10 }, { p: [10, 10] }, { p: [0, 10], h: 30 }]);
    const open = numericProfile(path, .125), closed = numericProfile({ ...path, closed: true }, .125);
    assert.deepEqual(path.nodes.map((_, i) => closed.nodeStation(i)), [0, 10, 20, 30]);
    assert.equal(open.value(0), 10);
    assert.equal(open.value(100), 30);
    assert.equal(closed.station(3, .5), 35);
    assert.equal(closed.value(35), 25);
    assert.equal(closed.value(0), 20);
    assert.equal(closed.value(40), 20);
    assert.equal(closed.value(5, true), 13.125);
});

test("Auto smoothing bends both incident lines and freezing its handles preserves that shape", () => {
    const path = line();
    assert.equal(segmentType(path, 0), "line");
    assert.equal(segmentType(path, 1), "line");
    setNodeMode(path, 1, "auto");
    assert.equal(segmentType(path, 0), "curve");
    assert.equal(segmentType(path, 1), "curve");
    const smooth = flattenPath(path, .01);
    assert(smooth.filter(e => e.from === path.nodes[0].id).length > 1);
    assert(smooth.filter(e => e.from === path.nodes[1].id).length > 1);
    setNodeMode(path, 1, "corner");
    assert.deepEqual(flattenPath(path, .01), smooth);
    setNodeMode(path, 1, "auto");
    assert(!Object.hasOwn(path.nodes[1], "in") && !Object.hasOwn(path.nodes[1], "out"));
});

test("Manual smoothing fills missing handles and aligns both directions while keeping their lengths", () => {
    for (const [incoming, outgoing] of [[undefined, undefined], [[-4, 0], undefined], [[-4, 0], [0, 2]]] as [Point?, Point?][]) {
        const path = line(), i = 1, v = path.nodes[i];
        if (incoming) v.in = incoming;
        if (outgoing) v.out = outgoing;
        const a = incoming ?? autoHandle(path, i, "in"), b = outgoing ?? autoHandle(path, i, "out");
        setNodeMode(path, i, "manual");
        assert.equal(v.mode, "manual");
        assert(Math.abs(Math.hypot(...v.in!) - Math.hypot(...a)) < 1e-10);
        assert(Math.abs(Math.hypot(...v.out!) - Math.hypot(...b)) < 1e-10);
        assert(Math.abs(v.in![0] * v.out![1] - v.in![1] * v.out![0]) < 1e-10);
        assert(v.in![0] * v.out![0] + v.in![1] * v.out![1] < 0);
        if (!incoming) assert(distance(v.out!, b) < 1e-10);
        if (incoming && outgoing) assert(distance(v.out!, [Math.SQRT2, Math.SQRT2]) < 1e-10);
    }
});

test("Straightening, curving and arcing a segment leave the adjacent Béziers untouched", () => {
    for (const type of ["line", "curve", "arc"] as const) {
        const path = line("auto"), i = 1;
        if (type === "curve") setSegment(path, i, "line");
        if (type === "arc") setNodeMode(path, i, "manual");
        const previous = pathBezier(path, i - 1), following = pathBezier(path, i + 1);
        setSegment(path, i, type);
        assert.equal(segmentType(path, i), type);
        for (let j = 0; j < 50; j++) {
            const t = j / 49;
            assert.deepEqual(at(pathBezier(path, i - 1), t), at(previous, t));
            assert.deepEqual(at(pathBezier(path, i + 1), t), at(following, t));
        }
        if (type === "arc") {
            assert.equal(path.nodes[i].mode, "corner");
            assert.equal(path.nodes[i + 1].mode, "auto");
            setNodeMode(path, i, "manual");
            assert.equal(path.nodes[i].mode, "corner");
        }
    }
});

test("Inserting between matching corner or manual nodes preserves the cubic and both node modes", () => {
    for (const mode of ["corner", "manual"] as const) {
        const path = line("auto"), index = 1;
        setNodeMode(path, index, mode);
        setNodeMode(path, index + 1, mode);
        const original = pathBezier(path, index), before = pathBezier(path, index - 1), after = pathBezier(path, index + 1);
        const v = insertPathNode(path, index, at(original, .37), "inserted")!;
        assert.deepEqual(path.nodes.slice(index, index + 3).map(n => n.mode), [mode, mode, mode]);
        const split = (path.nodes[index].out?.[0] ?? 0) / (original[1][0] - original[0][0]);
        const left = pathBezier(path, index), right = pathBezier(path, index + 1);
        for (let j = 0; j < 50; j++) {
            const t = j / 49, found = t <= split ? at(left, t / split) : at(right, (t - split) / (1 - split));
            assert(distance(at(original, t), found) < 1e-9);
        }
        assert.deepEqual(pathBezier(path, index - 1), before);
        assert.deepEqual(pathBezier(path, index + 2), after);
        assert(distance(v.p, at(original, .37)) < 1e-8);
    }
    const straight = line(), middle = insertPathNode(straight, 0, [3, 5], "inserted");
    assert.deepEqual(middle, { id: "inserted", p: [3, 5], mode: "corner" });
});

test("Insertion keeps automatic and mixed endpoints and splits arcs without handles at the new node", () => {
    for (const end of ["auto", "corner", "manual"] as const) {
        const path = line("auto");
        setNodeMode(path, 2, end);
        const point = at(pathBezier(path, 1), .42), v = insertPathNode(path, 1, point, "inserted")!;
        assert.deepEqual(path.nodes.slice(1, 4).map(n => n.mode), ["auto", "auto", end]);
        assert(!Object.hasOwn(v, "in") && !Object.hasOwn(v, "out"));
        assert(distance(v.p, point) < 1e-8);
    }
    for (const modes of [["auto", "auto"], ["auto", "corner"], ["corner", "corner"], ["manual", "manual"]] as const) {
        const path = line(), [a, b] = path.nodes.slice(1);
        [a.mode, b.mode] = modes;
        a.bulge = .7;
        const v = insertPathNode(path, 1, arcHandle(a.p, b.p, a.bulge), "inserted")!;
        assert.deepEqual([a.mode, b.mode], modes);
        assert.equal(v.mode, modes.some(mode => mode === "auto") ? "auto" : "corner");
        assert(!Object.hasOwn(v, "in") && !Object.hasOwn(v, "out"));
        assert.equal(segmentType(path, 1), "arc");
        assert.equal(segmentType(path, 2), "arc");
        assert(Math.abs(Math.atan(a.bulge) + Math.atan(v.bulge!) - Math.atan(.7)) < 1e-10);
    }
});

test("Closed segment removal uses the length midpoint and keeps the types of the neighboring segments", () => {
    const d = syntheticDesign(), owner = d.geoNodes[1];
    assert(owner.construction.type === "outline");
    const path = literalCurve(owner.construction.outlines[0]);
    const [a, b, c, last] = path.nodes;
    assert.deepEqual(removePathSegment(path, 0), { id: a.id, p: [-14, -14], mode: "corner" });
    assert.deepEqual(path.nodes.map(n => n.id), [a.id, c.id, last.id]);
    assert.deepEqual(path.nodes.map((_, i) => segmentType(path, i)), ["line", "line", "line"]);
    const reopened = parseDesign(serializeDesign(d)).geoNodes[1].construction;
    assert(reopened.type === "outline");
    assert.deepEqual(reopened.outlines[0], path);
    assert.equal(removePathSegment(path, 0), undefined);
    setSegment(path, 0, "curve");
    assert.equal(segmentType(path, 0), "curve");
    assert.equal(segmentType(path, 2), "line");

    const arc = line();
    arc.closed = true;
    const start = arc.nodes.at(-1)!, end = arc.nodes[0], prev = arc.nodes.at(-2)!;
    start.bulge = -.75;
    end.bulge = .4;
    prev.bulge = .65;
    const midpoint = arcHandle(start.p, end.p, start.bulge);
    assert.equal(removePathSegment(arc, arc.nodes.length - 1), start);
    assert.equal(arc.nodes.at(-1), start);
    assert(!arc.nodes.includes(end));
    assert.deepEqual(start.p, midpoint);
    assert.equal(start.mode, "corner");
    assert.equal(start.bulge, .4);
    assert.equal(prev.bulge, .65);

    const cubic = line();
    cubic.closed = true;
    cubic.nodes[1].out = [10, 7];
    cubic.nodes[2].in = [-1, -1];
    setSegment(cubic, 2, "curve");
    const bezier = pathBezier(cubic, 1), samples = Array.from({ length: 2049 }, (_, i) => at(bezier, i / 2048)), lengths = stations(samples);
    const half = lengths.at(-1)! / 2, index = lengths.findIndex(length => length >= half);
    const expected = mixPoint(samples[index - 1], samples[index], (half - lengths[index - 1]) / (lengths[index] - lengths[index - 1]));
    assert(distance(expected, at(bezier, .5)) > .1);
    assert(distance(removePathSegment(cubic, 1)!.p, expected) < 1e-4);
    assert.deepEqual([segmentType(cubic, 0), segmentType(cubic, 1)], ["line", "curve"]);
    assert(!path.nodes.includes(b));
});

test("Merged endpoints share insertion's mode rule and keep the outside handles", () => {
    const path = line(), index = 1;
    path.closed = true;
    path.nodes[1].in = [-2, 0];
    path.nodes[2].out = [0, 3];
    const corner = removePathSegment(structuredClone(path), index)!;
    assert.equal(corner.mode, "corner");
    assert.deepEqual(corner.in, [-2, 0]);
    assert.deepEqual(corner.out, [0, 3]);

    const auto = structuredClone(path);
    for (const i of [1, 2]) setNodeMode(auto, i, "auto");
    for (const candidate of [auto, structuredClone(auto)]) {
        if (candidate !== auto) setNodeMode(candidate, 1, "corner");
        const merged = removePathSegment(candidate, index)!;
        assert.equal(merged.mode, "auto");
        assert(!Object.hasOwn(merged, "in") && !Object.hasOwn(merged, "out"));
    }

    const manual = structuredClone(path);
    Object.assign(manual.nodes[1], { mode: "manual", out: [2, 0] });
    Object.assign(manual.nodes[2], { mode: "manual", in: [0, -3] });
    const withArc = structuredClone(manual);
    withArc.nodes[0].bulge = .5;
    const aligned = removePathSegment(manual, index)!;
    assert.equal(aligned.mode, "manual");
    assert(distance(aligned.in!, [-Math.SQRT2, -Math.SQRT2]) < 1e-9);
    assert(distance(aligned.out!, [3 / Math.SQRT2, 3 / Math.SQRT2]) < 1e-9);
    const fallback = removePathSegment(withArc, index)!;
    assert.equal(fallback.mode, "corner");
    assert.equal(fallback.in, undefined);
    assert.deepEqual(fallback.out, [0, 3]);
    assert.equal(withArc.nodes[0].bulge, .5);
});

test("Only the two end segments of an open path can be removed above its node limit", () => {
    const original = line("auto");
    setNodeMode(original, 1, "manual");
    setNodeMode(original, 3, "manual");
    for (const [segment, removed, newEndpoint] of [[0, 0, 1], [3, 4, 3]]) {
        const path = structuredClone(original), expected = path.nodes[newEndpoint];
        assert.equal(segmentRemovalIndex(path, segment), removed);
        assert.equal(removePathSegment(path, segment), expected);
        assert.deepEqual(path.nodes.map(n => n.id), original.nodes.filter((_, i) => i !== removed).map(n => n.id));
        assert.equal(expected.mode, "corner");
        assert.equal(removed === 0 ? expected.in : expected.out, undefined);
    }
    assert.equal(removePathSegment(original, 1), undefined);
    assert.equal(removePathSegment(original, 2), undefined);
    original.nodes.length = 2;
    assert.equal(removePathSegment(original, 0), undefined);
});

test("Segment removal averages heights and shifts references like node removal", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], f = defaultFunction("mountain");
    assert(f.type === "mountain");
    n.function = f;
    const path = line();
    path.closed = true;
    path.nodes[1].h = "{input:A} * 2";
    path.nodes[2].h = 6;
    path.nodes[3].h = 10;
    f.ridges.push({ line: path, slope: 1 });
    const control = { role: "segment" as const, path: -1, index: 1, point: path.nodes[1].p };
    f.floor = "{geo:T.ridges.0.line.nodes.2.h}";
    const before = structuredClone(path);
    assert.throws(() => removeCurveSegment(d, n, control), /仍被引用/);
    assert.deepEqual(path, before);
    f.floor = "{geo:T.ridges.0.line.nodes.3.h}";
    const merged = removeCurveSegment(d, n, control)!;
    assert.equal(merged.id, before.nodes[1].id);
    assert.equal(f.floor, "{geo:T.ridges.0.line.nodes.2.h}");
    delete f.floor;
    const resolved = resolveDesign(d).geoNodes[1].function;
    assert(resolved.type === "mountain");
    assert.equal(resolved.ridges[0].line.nodes[1].h, 10);
    d.inputs.A.value = 9;
    const updated = resolveDesign(d).geoNodes[1].function;
    assert(updated.type === "mountain");
    assert.equal(updated.ridges[0].line.nodes[1].h, 12);
});

test("Merging a closed slope segment includes its interpolated increment", () => {
    const d = syntheticDesign(), n = d.geoNodes[1];
    const path = openCurve([{ p: [0, 0], h: 0 }, { p: [2, 0] }, { p: [6, 0], h: 27 },
        { p: [6, 6], h: 7 }, { p: [0, 6], h: 1 }]);
    path.closed = true;
    n.function = { type: "slope", kind: "path", line: path, ease: true };
    const merged = removeCurveSegment(d, n, { role: "segment", path: -1, index: 0, point: [1, 0] })!;
    assert.equal(merged.h, 3.5);
    assert.doesNotThrow(() => parseDesign(serializeDesign(d)));
});

test("The open pen and handle drags only store usable handles", () => {
    const path = penPath([
        penNode("A", [0, 0], [2, 1]), penNode("B", [5, 4], [6, 2]), penNode("C", [10, 0], [12, -1])
    ], false);
    assert.deepEqual(path.nodes, [
        { id: "A", p: [0, 0], mode: "corner", out: [2, 1] },
        { id: "B", p: [5, 4], mode: "manual", out: [1, -2], in: [-1, 2] },
        { id: "C", p: [10, 0], mode: "corner", in: [-2, 1] }
    ]);

    moveHandle(path, 0, "out", [3, 1], false);
    assert.equal(path.nodes[0].mode, "corner");
    assert(!Object.hasOwn(path.nodes[0], "in"));
});

for (const mode of ["corner", "auto", "manual"] as const) for (const alt of [false, true]) {
    test("Dragging a " + mode + " handle with Alt=" + alt + " follows its original node type", () => {
        const path = line(), pivot = path.nodes[1];
        Object.assign(pivot, { in: [-2, 1], out: [2, -1] });
        setNodeMode(path, 1, mode);
        const frozen = structuredClone(path);
        if (mode === "auto") setNodeMode(frozen, 1, "manual");
        const other = frozen.nodes[1].in!, delta: Point = [4, 3];
        moveHandle(path, 1, "out", [pivot.p[0] + delta[0], pivot.p[1] + delta[1]], alt);
        assert.deepEqual(pivot.out, delta);
        if (mode === "corner" || alt) {
            assert.equal(pivot.mode, "corner");
            assert.deepEqual(pivot.in, other);
        }
        else {
            assert.equal(pivot.mode, "manual");
            const length = Math.hypot(...other);
            assert(distance(pivot.in!, [-length * .8, -length * .6]) < 1e-10);
        }
    });
}

test("An Alt split survives the next drag, and auto at an arc can only become a corner", () => {
    const path = line("auto"), v = path.nodes[1];
    moveHandle(path, 1, "out", [8, 13], true);
    const other = v.in;
    moveHandle(path, 1, "out", [8, 4], false);
    assert.equal(v.mode, "corner");
    assert.deepEqual(v.in, other);
    path.nodes[0].bulge = .5;
    setNodeMode(path, 1, "auto");
    moveHandle(path, 1, "out", [10, 6], false);
    assert.equal(v.mode, "corner");
    assert.equal(v.in, undefined);
    assert.deepEqual(v.out, [5, -2]);
});

test("Whole-curve operations preserve nodes and report when no edit is needed", () => {
    const curve: Curve = {
        closed: true, nodes: [
            { id: "A", p: [0, 0], h: 4, mode: "manual", in: [-1, 0], out: [2, 0] },
            { id: "B", p: [6, 0], h: 5, mode: "corner", bulge: .4 },
            { id: "C", p: [6, 6], mode: "corner", out: [-1, 0] }
        ]
    };
    const nodes = curve.nodes.map(({ id, p, h }) => [id, p, h]);
    const expected = structuredClone(curve);
    for (const i of expected.nodes.keys()) setNodeMode(expected, i, "auto");
    assert(editWholeCurve(curve, "auto"));
    assert.deepEqual(curve, expected);
    assert.equal(curve.nodes[1].bulge, .4);
    assert(!editWholeCurve(curve, "auto"));
    assert.deepEqual(curve, expected);
    assert(editWholeCurve(curve, "line"));
    assert.deepEqual(curve.nodes.map(({ id, p, h }) => [id, p, h]), nodes);
    assert(curve.nodes.every(node => node.mode === "corner" && !("in" in node || "out" in node || "bulge" in node)));
    const straight = structuredClone(curve);
    assert(!editWholeCurve(curve, "line"));
    assert.deepEqual(curve, straight);
});

type Invalid = [string, string, (curve: Curve) => void];
const invalid: Invalid[] = [
    ["nodes", "曲线至少需要两个节点", c => c.nodes.splice(1)],
    ["nodes", "闭合曲线至少需要三个节点", c => {
        c.closed = true;
        c.nodes.splice(2);
    }],
    ["nodes[0].in", "开放曲线的首节点没有前一段", c => c.nodes[0].in = [0, 0]],
    ["nodes[4].out", "开放曲线的末节点没有后一段", c => c.nodes[4].out = [0, 0]],
    ["nodes[4].bulge", "开放曲线的末节点没有后一段", c => c.nodes[4].bulge = .5],
    ["nodes[1].out", "和圆弧相邻的一侧不能有控制柄", c => Object.assign(c.nodes[1], { bulge: .5, out: [2, 1] })],
    ["nodes[2].in", "和圆弧相邻的一侧不能有控制柄", c => {
        c.nodes[1].bulge = .5;
        c.nodes[2].in = [-2, -1];
    }],
    ["nodes[2].mode", "手动平滑节点不能和圆弧相邻", c => {
        setNodeMode(c, 2, "manual");
        c.nodes[1].bulge = .5;
    }],
    ["nodes[1].in", "手动平滑节点需要两侧控制柄", c => {
        setNodeMode(c, 1, "manual");
        delete c.nodes[1].in;
    }],
    ["nodes[1].out", "手动平滑节点需要两侧控制柄", c => {
        setNodeMode(c, 1, "manual");
        delete c.nodes[1].out;
    }],
    ["nodes[1].in", "自动平滑节点不存储控制柄", c => Object.assign(c.nodes[1], { mode: "auto", in: [-2, -1] })],
    ["nodes[1].out", "自动平滑节点不存储控制柄", c => Object.assign(c.nodes[1], { mode: "auto", out: [2, 1] })]
];
test("Curve validation reports the precise field for missing and invalid data", () => {
    for (const [path, message, change] of invalid) {
        const d = syntheticDesign(), curve = line();
        d.geoNodes[1].function = { type: "slope", kind: "path", line: curve };
        change(curve);
        assert.throws(() => parseDesign(d), { message: "geoNodes[1].function.line." + path + " " + message });
    }
    const d = syntheticDesign(), n = d.geoNodes[1];
    assert(n.construction.type === "outline");
    const path = literalCurve<ClosedCurve>(n.construction.outlines[0]);
    Object.assign(path.nodes[0], { h: 9 });
    assert.throws(() => parseDesign(d), { message: "geoNodes[1].construction.outlines[0].nodes[0].h 这里的节点不能有高度" });
    delete path.nodes[0].h;
    const shore = structuredClone(path);
    shore.nodes.forEach(v => v.id += "-shore");
    n.function = defaultFunction("coast", { shore, center: [0, 0] });
    Object.assign(shore.nodes[0], { h: 9 });
    assert.throws(() => parseDesign(d), { message: "geoNodes[1].function.shore.nodes[0].h 这里的节点不能有高度" });
});

test("Curve node IDs and positional height references survive insertion, removal and ridge copies", () => {
    const d = syntheticDesign(), n = d.geoNodes[1];
    const ridge = openCurve([{ p: [-20, -7], h: 2 }, { p: [-15, -8], h: 3 }, { p: [-10, -9], h: 5 }]);
    const f = defaultFunction("mountain");
    assert(f.type === "mountain" && n.construction.type === "outline");
    n.function = f;
    f.ridges.push({ line: ridge, slope: 2 });
    const id = ridge.nodes[0].id;
    ridge.nodes[0].id = ridge.nodes[1].id;
    assert.throws(() => parseDesign(d), error => error instanceof DesignError &&
        error.problems[0].location?.path.join(".") === "function.ridges.0.line.nodes.1.id");
    ridge.nodes[0].id = id;
    ridge.closed = true;
    assert.doesNotThrow(() => parseDesign(d));
    ridge.closed = false;
    n.function.floor = "{geo:T.ridges.0.line.nodes.2.h}";
    const added = insertCurveNode(d, n, { role: "segment", path: -1, index: 0, point: [-17.5, -7.5] })!;
    assert.equal(n.function.floor, "{geo:T.ridges.0.line.nodes.3.h}");
    removeCurveNode(d, n, { role: "vertex", path: -1, index: 1, point: added.p });
    assert.equal(n.function.floor, "{geo:T.ridges.0.line.nodes.2.h}");
    copyGeometryItem(d, n, ["ridges"], 0);
    const ids = curvesOf(n).flatMap(path => literalCurve(path).nodes.map(v => v.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.doesNotThrow(() => parseDesign(d));
});