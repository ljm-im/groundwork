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
    const exclude = { group: near.group };
    assert.deepEqual(edges(target, 1, { exclude }), { point: target });
    assert.deepEqual(edges(target, 1, { alignmentPoints: [a.point, b.point], exclude }), {
        point: [11, 13], snapped: true, guides: [
            { kind: "align", from: a.point, to: [11, 13] },
            { kind: "align", from: b.point, to: [11, 13] }
        ]
    });
});

test("An explicitly related point aligns an axis without collapsing a curve segment", () => {
    const at = point(13, 15, "curve", 1), moving = point(6, 8, "curve", 0);
    const snap = indexSnapTargets([at, moving], [line([0, 10], [40, 10], "curve")], 1);
    const exclude = { group: "curve", indices: [0, 1] };
    assert.deepEqual(snap(target, 1, { alignmentPoints: [at.point], exclude }), {
        point: [13, 10], snapped: true, guides: [{ kind: "align", from: at.point, to: [13, 10] }]
    });
    assert.deepEqual(snap([12, 15], 1, { alignmentPoints: [at.point], exclude }), { point: [12, 15], snapped: true,
        guides: [{ kind: "align", from: at.point, to: [12, 15] }] });
});

test("Direction constraints project to the closest of eight directions or a square corner", () => {
    const origin: Point = [0, 0], pointer: Point = [21, 19], ray = directionRay(origin, pointer);
    assert.deepEqual(projectToRay(ray, pointer), [20, 20]);
    assert.deepEqual(projectToRay(directionRay(origin, [-8, 2]), [-8, 2]), [-8, 0]);
    assert.deepEqual(projectToRay(directionRay(origin, [2, -8]), [2, -8]), [0, -8]);
    assert.deepEqual(squareCorner([3, 2], [-1, 12]), [-7, 12]);
});

test("A fixed snap index measures the threshold in current screen pixels", () => {
    const c = point(15, 10), snap = indexSnapTargets([c], [], 1);
    assert.equal(snap(target, 1).guides?.[0].kind, "point");
    assert.deepEqual(snap(target, 2), { point: target });
    assert.equal(snap(target, 2, { alignmentPoints: [c.point] }).guides?.[0].kind, "align");
    const edge = indexSnapTargets([], [line([0, 40], [60, 40])], 1);
    assert.deepEqual(edge(target, .1).point, [10, 40]);
    assert.deepEqual(edge(target, 1).point, target);
});