import assert from "node:assert/strict";
import { test } from "node:test";
import { directionRay, indexSnapTargets, projectToRay, squareCorner, type SnapLine, type SnapPoint } from "../src/core/edit/snapping.ts";
import { type Point } from "../src/core/math/geometry.ts";

const point = (x: number, y: number, group = "points", index = 0): SnapPoint => ({ point: [x, y], group, index });
const line = (a: Point, b: Point, group = "line"): SnapLine => ({ a, b, group });
const target: Point = [10, 10];

test("Snapping prefers a nearby node, then a curve, then independent alignment guides", () => {
    const a = point(11, 34), b = point(36, 13), c = point(14, 11), near = line([0, 11], [40, 11]);
    const snap = indexSnapTargets([a, b, c], [near], 1);
    assert.deepEqual(snap(target, 1), { point: c.point, snapped: true, guides: [{ kind: "point", point: c.point }] });
    const edges = indexSnapTargets([a, b], [near], 1);
    assert.deepEqual(edges(target, 1), { point: [10, 11], snapped: true });
    assert.deepEqual(edges(target, 1, { exclude: { group: near.group } }), {
        point: [11, 13], snapped: true, guides: [
            { kind: "align", from: a.point, to: [11, 13] },
            { kind: "align", from: b.point, to: [11, 13] }
        ]
    });
    assert.deepEqual(snap(target, 1, { disabled: true }), { point: target });
});

test("Moving and adjacent nodes still guide alignment without collapsing a curve segment", () => {
    const at = point(13, 15, "curve", 1), moving = point(6, 8, "curve", 0);
    const snap = indexSnapTargets([at, moving], [line([0, 10], [40, 10], "curve")], 1);
    assert.deepEqual(snap(target, 1, { exclude: { group: "curve", indices: [0, 1] } }), {
        point: [13, 8], snapped: true, guides: [
            { kind: "align", from: at.point, to: [13, 8] },
            { kind: "align", from: moving.point, to: [13, 8] }
        ]
    });
    const near = indexSnapTargets([at], [], 1);
    assert.deepEqual(near(target, 1, { exclude: { group: "curve", indices: [1] } }), {
        point: [13, 10], snapped: true, guides: [{ kind: "align", from: at.point, to: [13, 10] }]
    });
});

test("Shift projects to the closest of eight directions and chooses snap intersections on the ray", () => {
    const origin: Point = [0, 0], pointer: Point = [21, 19], ray = directionRay(origin, pointer);
    assert.deepEqual(projectToRay(ray, pointer), [20, 20]);
    assert.deepEqual(projectToRay(directionRay(origin, [-8, 2]), [-8, 2]), [-8, 0]);
    assert.deepEqual(projectToRay(directionRay(origin, [2, -8]), [2, -8]), [0, -8]);
    assert.deepEqual(squareCorner([3, 2], [-1, 12]), [-7, 12]);
    const guide = point(22, 43);
    const snap = indexSnapTargets([guide], [line([24, 0], [24, 55])], 1);
    assert.deepEqual(snap(pointer, 1, { ray }), { point: [22, 22], snapped: true,
        guides: [{ kind: "align", from: guide.point, to: [22, 22] }] });
    const closer = indexSnapTargets([guide], [line([21, 0], [21, 55])], 1);
    assert.deepEqual(closer(pointer, 1, { ray }), { point: [21, 21], snapped: true });
    const c = point(22, 21), node = indexSnapTargets([c, guide], [line([21, 0], [21, 55])], 1);
    assert.deepEqual(node(pointer, 1, { ray }), { point: [21.5, 21.5], snapped: true, guides: [{ kind: "point", point: c.point }] });
    assert.deepEqual(node(pointer, 1, { ray, disabled: true }), { point: [20, 20] });
});

test("A fixed snap index measures the threshold in current screen pixels", () => {
    const c = point(15, 10), snap = indexSnapTargets([c], [], 1);
    assert.equal(snap(target, 1).guides?.[0].kind, "point");
    assert.deepEqual(snap(target, 2).point, target);
    assert.equal(snap(target, 2).guides?.[0].kind, "align");
    const edge = indexSnapTargets([], [line([0, 40], [60, 40])], 1);
    assert.deepEqual(edge(target, .1).point, [10, 40]);
    assert.deepEqual(edge(target, 1).point, target);
});