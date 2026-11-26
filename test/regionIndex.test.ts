import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesign } from "../src/core/design/model.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { makeShape, rasterRegion, regionMaskAt, trace, type RegionShape, type Segment } from "../src/core/design/regions.ts";
import { type Construction, type Point, type Strip } from "../src/core/design/v5.ts";
import { clamp, createGrid, distance, eachCell, mixPoint, projection } from "../src/core/math/geometry.ts";
import { indexSegments } from "../src/core/math/segmentIndex.ts";
import { random } from "../src/core/math/noise.ts";
import { layer, polygon, rect, syntheticDesign } from "./scenarios.ts";

function scan(p: Point, edges: Segment[], radius: number) {
    let best = Infinity, index = -1, at: Point | undefined;
    for (const [i, { a, b }] of edges.entries()) {
        const q = mixPoint(a, b, projection(p[0], p[1], a, b));
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
        if (d < best) {
            best = d;
            index = i;
            at = q;
        }
    }
    return at && best <= radius * radius ? { index, at, distance: Math.sqrt(best) } : undefined;
}

const tolerance = .125;
function shape(id: string, construction: Construction<number, never>, below = new Map<string, RegionShape>()) {
    return makeShape({ id, label: id, field: "height", construction, function: { type: "ground", value: 0 } }, below, tolerance);
}

test("The segment index matches a linear scan at ties, bucket boundaries and random points", () => {
    const next = random(33);
    const point = (): Point => [next() * 80 - 40, next() * 80 - 40];
    const shared: Point = [3, 0], a: Segment = { a: [0, 0], b: shared }, b: Segment = { a: shared, b: [3, 3] };
    const randomEdges = Array.from({ length: 80 }, () => ({ a: point(), b: point() }));
    const long: Segment = { a: [-2000, -2000], b: [2000, 2000] };
    for (const edges of [[a, b, a, { a: shared, b: shared }], [long, ...randomEdges]]) {
        const radius = 3, index = indexSegments(edges, radius);
        const queries: Point[] = [[0, -3], [0, -3 - 1e-12], shared, [6, 0], [2, 1], [500, 500], ...Array.from({ length: 200 }, point)];
        for (const p of queries) {
            const expected = scan(p, edges, radius);
            assert.equal(index.nearest(p[0], p[1])?.order, expected?.index, p.join(","));
            assert.equal(index.within(p[0], p[1], radius * radius), !!expected);
        }
    }
});

test("Strip cross sections preserve the projected point and normal at equal distances", () => {
    const lower = shape("A", rect(-2, -3, 6, 3)), reach = 3;
    const strip = shape("B", { type: "strip", of: ["A"], widths: [reach, reach] }, new Map([["A", lower]]));
    const next = random(41), points: Point[] = [[-2, -3], [6, -3], [2, 0], [2, -6], [2, -6 - 1e-12], [-5, -3]];
    for (let i = 0; i < 80; i++) points.push([next() * 16 - 6, next() * 16 - 8]);
    for (const p of points) {
        const hit = scan(p, strip.spine!, reach);
        assert.equal(strip.contains(p), !!hit);
        if (!hit) {
            assert.equal(strip.cross!(p), undefined);
            continue;
        }
        const first = lower.contains(p), sign = first ? -1 : 1, { at, distance: dist } = hit;
        const { a, b } = strip.spine![hit.index], length = distance(a, b), mid = mixPoint(a, b, .5);
        const nx = (a[1] - b[1]) / length, ny = (b[0] - a[0]) / length;
        const orientation = lower.contains([mid[0] + nx * tolerance * .001, mid[1] + ny * tolerance * .001]) ? -1 : 1;
        assert.deepEqual(strip.cross!(p), {
            s: clamp((reach + sign * dist) / (reach + reach)), first, at,
            normal: dist > 1e-9 ? [sign * (p[0] - at[0]) / dist, sign * (p[1] - at[1]) / dist] : [orientation * nx, orientation * ny]
        }, p.join(","));
    }
});

test("A strip range takes the first outline containing both of its node IDs", () => {
    const d = syntheticDesign();
    d.curves.A = { label: "A", curve: rect(0, 0, 6, 3).outlines[0] };
    const first = { ref: "{curve:A}", offset: [-12, 4] as Point }, second = { ref: "{curve:A}", offset: [8, -9] as Point };
    const outlines = [first, second];
    d.geoNodes.push(layer("A", { type: "outline", outlines }, { type: "flat", amount: 1 }),
        layer("B", { type: "strip", of: ["A"], widths: [1, 2], range: { from: "0", to: "1" } }, { type: "blend" }));
    const spine = () => {
        const [source, strip] = resolveDesign(parseDesign(d)).geoNodes.slice(-2);
        const upper = makeShape(source, new Map(), tolerance);
        return makeShape(strip, new Map([["A", upper]]), tolerance).spine!.map(({ a, b }) => [a, b]);
    };
    assert.deepEqual(spine(), [[[-12, 4], [-6, 4]]]);
    outlines.reverse();
    assert.deepEqual(spine(), [[[8, -9], [14, -9]]]);
});

test("Nested strips trace the same ordered segments as a full scan", () => {
    const a = shape("A", { type: "outline", outlines: [polygon([[-8, -4], [2, -7], [8, 3], [-3, 9]])] });
    const b = shape("B", rect(-7, -8, 10, 10));
    const c = shape("C", { type: "strip", of: ["A"], widths: [1, 2] }, new Map([["A", a]]));
    const dense = (region: RegionShape) => ({ ...region, reach: undefined, boundary: () => trace({ ...region, reach: undefined }, tolerance) });
    assert.deepEqual(c.boundary(), dense(c).boundary());
    for (const references of [["C"], ["B", "C"]] satisfies Strip<number>["of"][]) {
        const construction: Construction<number> = { type: "strip", of: references, widths: [.5, 1.5] };
        const d = shape("D", construction, new Map([["B", b], ["C", c]]));
        const e = shape("D", construction, new Map([["B", b], ["C", dense(c)]]));
        assert(d.spine!.length > 0);
        assert.deepEqual(d.boundary(), dense(e).boundary());
        assert.deepEqual(trace(d, tolerance, [-4, -2, 3, 4]), trace(dense(e), tolerance, [-4, -2, 3, 4]));
    }
});

test("A compact mask matches the canvas-sized mask and keeps row-major indices", () => {
    const grid = createGrid({ xMin: -4, xMax: 7, yMin: -6, yMax: 8, step: .5 });
    const region = shape("A", { type: "outline", outlines: [...rect(-5, -1, 2, 4).outlines, ...rect(-2, 0, 1, 2).outlines] });
    const expected = new Uint8Array(grid.size), cells: number[] = [];
    eachCell(grid, region.box, 0, (k, x, y) => {
        if (region.contains([x, y])) {
            cells.push(k);
            expected[k] = 1;
        }
    });
    const compact = rasterRegion(grid, region);
    assert(compact.mask.length < grid.size);
    assert.deepEqual(compact.cells, Int32Array.from(cells));
    assert.deepEqual(expected.map((_, k) => regionMaskAt(compact, k)), expected);
    assert.equal(regionMaskAt(compact, -1), 0);
    assert.equal(regionMaskAt(compact, grid.size), 0);
});