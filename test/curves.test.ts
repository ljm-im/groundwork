import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesign } from "../src/core/design/model.ts";
import { DesignError } from "../src/core/design/problems.ts";
import { autoHandle, flattenPath, pathBezier, segmentType, splitBezier, type Bezier } from "../src/core/design/path.ts";
import { numericProfile } from "../src/core/design/polyline.ts";
import { type Curve, type Point } from "../src/core/design/v5.ts";
import { defaultFunction, pathsOf } from "../src/core/edit/geoNodes.ts";
import { copyGeometryItem, insertCurveNode, removeCurveNode } from "../src/core/edit/geoControls.ts";
import { editWholeCurve, insertPathNode, moveHandle, penNode, penPath, setNodeMode, setSegment } from "../src/core/edit/paths.ts";
import { distance, spline } from "../src/core/math/geometry.ts";
import { openCurve, syntheticDesign } from "./scenarios.ts";

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

test("Inserting a node reparameterizes the same cubic to nanometre accuracy", () => {
    const path = line("auto"), index = 1;
    const original = pathBezier(path, index), before = pathBezier(path, index - 1), after = pathBezier(path, index + 1);
    const v = insertPathNode(path, index, at(original, .37), "inserted")!;
    assert.equal(v.mode, "manual");
    assert.equal(path.nodes[index].mode, "corner");
    assert.equal(path.nodes[index + 2].mode, "corner");
    const split = (path.nodes[index].out?.[0] ?? 0) / (original[1][0] - original[0][0]);
    const left = pathBezier(path, index), right = pathBezier(path, index + 1);
    for (let j = 0; j < 50; j++) {
        const t = j / 49, found = t <= split ? at(left, t / split) : at(right, (t - split) / (1 - split));
        assert(distance(at(original, t), found) < 1e-9);
    }
    assert.deepEqual(pathBezier(path, index - 1), before);
    assert.deepEqual(pathBezier(path, index + 2), after);
    const straight = line(), middle = insertPathNode(straight, 0, [3, 5], "inserted");
    assert.deepEqual(middle, { id: "inserted", p: [3, 5], mode: "corner" });
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
    setNodeMode(path, 1, "auto");
    const regular = structuredClone(path);
    moveHandle(regular, 1, "out", [6, 2], false);
    moveHandle(path, 1, "out", [6, 2], true);
    assert.deepEqual(path, regular);
    assert.equal(path.nodes[1].mode, "manual");
    const incoming = path.nodes[1].in;
    moveHandle(path, 1, "out", [7, 1], true);
    assert.deepEqual(path.nodes[1].in, incoming);
    assert.equal(path.nodes[1].mode, "corner");
    const corner = structuredClone(path);
    moveHandle(corner, 1, "out", [8, 1], true);
    moveHandle(path, 1, "out", [8, 1], false);
    assert.deepEqual(path, corner);
    assert.equal(path.nodes[1].mode, "manual");
    moveHandle(path, 0, "out", [3, 1], false);
    assert.equal(path.nodes[0].mode, "corner");
    assert(!Object.hasOwn(path.nodes[0], "in"));
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
    ["points", "已从 v5 移除", c => Object.assign(c, { points: [] })],
    ["smooth", "已从 v5 移除", c => Object.assign(c, { smooth: false })],
    ["nodes[0].next", "已从 v5 移除", c => Object.assign(c.nodes[0], { next: "line" })],
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
test("Curve validation reports the precise field for retired, missing and unused data", () => {
    for (const [path, message, change] of invalid) {
        const d = syntheticDesign(), curve = line();
        d.geoNodes[1].function = { type: "slope", kind: "path", line: curve };
        change(curve);
        assert.throws(() => parseDesign(d), { message: "geoNodes[1].function.line." + path + " " + message });
    }
    const d = syntheticDesign(), n = d.geoNodes[1];
    assert(n.construction.type === "free");
    const path = n.construction.paths[0];
    Object.assign(path.nodes[0], { h: 9 });
    assert.throws(() => parseDesign(d), { message: "geoNodes[1].construction.paths[0].nodes[0].h 这里的节点不能有高度" });
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
    assert(f.type === "mountain" && n.construction.type === "free");
    n.function = f;
    f.ridges.push({ line: ridge, widths: [3, 3], widthNoise: { amount: 0, wavelength: 20 }, heightNoise: { amount: 0, wavelength: 20 } });
    const id = ridge.nodes[0].id;
    ridge.nodes[0].id = n.construction.paths[0].nodes[0].id;
    assert.throws(() => parseDesign(d), error => error instanceof DesignError &&
        error.problems[0].location?.path.join(".") === "function.ridges.0.line.nodes.0.id");
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
    const ids = pathsOf(n).flatMap(path => path.nodes.map(v => v.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.doesNotThrow(() => parseDesign(d));
});