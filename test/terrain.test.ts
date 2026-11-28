import { test } from "node:test";
import { resolveDesign } from "../src/core/design/parameters.ts";
import assert from "node:assert/strict";
import { type ClosedCurve, type Point } from "../src/core/design/v5.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { createGrid, distance, nearest, normalProjection, sampleDefined, smooth, spline } from "../src/core/math/geometry.ts";
import { fbm, noise } from "../src/core/math/noise.ts";
import { regionMaskAt, signedBoundaryDistance } from "../src/core/design/regions.ts";
import { shapePath } from "../src/core/edit/paths.ts";
import { bulgeFromDegrees, flattenPath } from "../src/core/design/path.ts";
import { numericProfile } from "../src/core/design/polyline.ts";
import { evaluateLayer } from "../src/core/terrain/functions.ts";
import { evaluateStack, generateTerrain } from "../src/core/terrain/terrain.ts";
import { mountainProfile } from "../src/core/terrain/mountain.ts";
import { terrainIssues } from "../src/core/checks/terrain.ts";
import { terrainSurface } from "../src/core/terrain/surface.ts";
import { Project } from "../src/core/project.ts";
import { withNodeSlope, erosion, addLayer, fixtureConstruction, layer, literalCurve, placeLayer, type FixtureLayer, rect, syntheticDesign, openCurve } from "./scenarios.ts";

function design(nodes: FixtureLayer[], step = 1) {
    const d = syntheticDesign("empty");
    d.grid.step = step;
    d.geoNodes = nodes.map(n => placeLayer(d, n));
    return d;
}
const base = () => layer("G", rect(-30, -30, 30, 30), { type: "ground", value: 2 });
const circle = (r: number): ClosedCurve => {
    let i = 0;
    return shapePath("circle", [0, 0], [-r, 0], () => "c" + i++);
};

test("A seed reproduces the final height field", () => {
    const g = base();
    const detail = layer("N", g.construction, { type: "noise", amplitude: 1.5, scale: 9, seed: "{input:seed} + 7" });
    const d = design([g, detail]);
    const initial = new Project(d);
    assert.deepEqual(new Project(structuredClone(d)).terrain.fields.height.values, initial.terrain.fields.height.values);
    d.inputs.seed.value++;
    assert.notDeepEqual(generateTerrain(d).fields.height.values, initial.terrain.fields.height.values);
    d.geoNodes[1].function.seed = "{input:seed} + 6";
    assert.deepEqual(generateTerrain(d).fields.height.values, initial.terrain.fields.height.values);
});

test("A local mountain preserves the underlying height differences along its boundary", () => {
    const g = base(), slope = layer("S", g.construction, { type: "slope", kind: "path",
        lines: [{ curve: openCurve([{ p: [-30, 0], h: 4 }, { p: [30, 0], h: 7 }]) }], center: [0, 0], radius: 5, value: 2, rate: -.2 });
    const d = design([g, slope]), before = evaluateStack(d).fields.height.values;
    d.geoNodes.push(addLayer(d, "M", rect(-12, -12, 12, 12), { type: "mountain", valleys: [],
        ridges: [{ curve: withNodeSlope(openCurve([{ p: [-5, 0], h: 12 }, { p: [5, 0], h: 10 }]), 3) }],
        peaks: [{ at: [0, 3], height: 16, radius: 2, noise: .1, scale: 7 }] }));
    const t = evaluateStack(parseDesign(d)), after = t.fields.height.values, region = t.regions.get("M")!;
    assert(after[t.grid.index(0, 3)] > 12 && after[t.grid.index(-5, 0)] > 8);
    let pairs = 0;
    for (let k = 0; k < t.grid.size; k++) {
        if (!regionMaskAt(region, k)) {
            assert.equal(after[k], before[k]);
            continue;
        }
        for (const other of [k - 1, k + 1, k - t.grid.width, k + t.grid.width]) {
            if (regionMaskAt(region, other)) continue;
            assert(Math.abs(after[k] - after[other]) <= Math.abs(before[k] - before[other]) + 1e-6);
            pairs++;
        }
    }
    assert(pairs > 0);
});

test("Noise fades to zero at the boundary and reaches its full FBM amplitude inside", () => {
    const fn = { type: "noise" as const, amplitude: 2, scale: 11, seed: 3 };
    const n = layer("N", rect(-8.5, -6.5, 9.5, 7.5), fn, "B"), d = design([base(), n]);
    d.fields.B = { label: "B" };
    d.geoNodes.splice(1, 0, addLayer(d, "BB", d.geoNodes[0].construction, { type: "ground", value: 2.5 }, "B"));
    const plain = evaluateStack(parseDesign(d));
    d.geoNodes[2].function = { ...fn, feather: 4 };
    const soft = evaluateStack(parseDesign(d)), pattern = noise(fn.seed);
    const seen = new Set<string>();
    for (const k of soft.regions.get(n.id)!.cells) {
        const [x, y] = soft.grid.point(k), gap = Math.min(x + 8.5, 9.5 - x, y + 6.5, 7.5 - y);
        const u = Math.min(1, gap / 4), weight = u * u * (3 - 2 * u);
        const delta = fn.amplitude * fbm(pattern, x / fn.scale, y / fn.scale, 5);
        assert.equal(plain.fields.B.values[k], Math.fround(2.5 + delta));
        assert.equal(soft.fields.B.values[k], Math.fround(2.5 + delta * weight));
        if (Math.abs(delta) > .01) seen.add(gap === 0 ? "edge" : gap < 4 ? "transition" : "interior");
    }
    assert.deepEqual(seen, new Set(["edge", "transition", "interior"]));
    assert.equal(soft.fields.B.values[soft.grid.index(12, 0)], 2.5);
    assert(soft.fields.height.values.every(v => v === 2));
});

test("A field-bound noise amplitude leaves a zero disk intact and skips undefined input", () => {
    const g = base(), disk = layer("Z", { type: "outline", outlines: [{ curve: circle(6) }] }, { type: "flat", amount: -4 }, "A");
    const n = layer("N", g.construction, { type: "noise", amplitude: "{field:A} * 0.5", scale: 7, octaves: 2 });
    const a = layer("A", g.construction, { type: "ground", value: 4 }, "A");
    const d = design([g, a, disk, n]); d.fields.A = { label: "A" };
    const t = evaluateStack(parseDesign(d)), pattern = noise(0), region = t.regions.get(disk.id)!;
    assert(region.cells.length && t.fields.height.values.some((v, k) => !regionMaskAt(region, k) && v !== 2));
    for (let k = 0; k < t.grid.size; k++) {
        const [x, y] = t.grid.point(k);
        assert.equal(t.fields.height.values[k], regionMaskAt(region, k) ? 2 : Math.fround(2 + 2 * fbm(pattern, x / 7, y / 7, 2)));
    }
    const [ground, field, , detail] = d.geoNodes;
    detail.field = "A"; detail.function = { type: "noise", amplitude: "{field:height}", scale: 7 };
    d.geoNodes = [field, detail, ground];
    assert(evaluateStack(parseDesign(d)).fields.A.values.every(v => v === 4));
});

test("Adaptive auto cubic vertices lie on the v4 Catmull-Rom curve", () => {
    const p: Point[] = [[-11, -4], [1, -12], [14, 5], [0, 6]];
    const path: ClosedCurve = { closed: true, nodes: p.map((v, i) => ({ id: String(i), p: v, mode: "auto" })) };
    const segments = flattenPath(path, .0625), sampled = spline(p, true, 256);
    for (const s of segments) assert(sampled.some(v => distance(v, s.a) < 1e-9));
    const vertices = segments.map(s => s.a);
    for (const v of sampled) assert(nearest(...v, vertices, true).distance <= .0625);
});

test("Bulge arcs cover the disk area and even-odd paths cut a hole", () => {
    const g = base(); g.construction = { type: "outline", outlines: [{ curve: circle(20) }] };
    const d = design([g], .5), full = evaluateStack(d);
    const area = full.fields.height.defined.reduce((a, b) => a + b, 0) * d.grid.step ** 2;
    assert(Math.abs(area / (Math.PI * 400) - 1) < .01);
    g.construction.outlines.push({ curve: { ...circle(7), nodes: circle(7).nodes.map(v => ({ ...v, id: "hole" + v.id })) } });
    d.geoNodes[0].construction = fixtureConstruction(d, g.construction);
    const hole = evaluateStack(d);
    assert.equal(hole.fields.height.defined[hole.grid.index(0, 0)], 0);
    assert.equal(hole.fields.height.defined[hole.grid.index(12, 0)], 1);
    assert.equal(sampleDefined(hole.grid, hole.fields.height.values, hole.fields.height.defined, 0, 0), undefined);
});

test("Shared strips match touching and overlapping rectangles and ranges survive unrelated vertex edits", () => {
    const left = layer("A", rect(-12, -5, 0, 5), { type: "flat", amount: 3 });
    const right = rect(0, -10, 12, 10);
    const b = layer("B", right, { type: "flat", amount: 7 });
    const band = layer("C", { type: "strip", of: ["A", "B"], widths: [2, 3] }, { type: "blend" });
    const d = design([base(), left, b, band]);
    const mask = () => {
        const terrain = evaluateStack(parseDesign(d)), region = terrain.regions.get("C")!;
        return new Uint8Array(terrain.grid.size).map((_, k) => regionMaskAt(region, k));
    };
    const signed = signedBoundaryDistance(evaluateStack(d).regions.get("A")!.shape);
    assert.equal(signed(-2, 0), 2);
    assert.equal(signed(2, 0), -2);
    const before = mask();
    const { grid } = evaluateStack(d);
    for (let k = 0; k < grid.size; k++) {
        const [x, y] = grid.point(k), endDistance = Math.max(0, Math.abs(y) - 5);
        const inUnion = x >= 0 ? x < 12 && Math.abs(y) < 10 : x >= -12 && Math.abs(y) < 5;
        assert.equal(before[k], +(inUnion && Math.hypot(x, endDistance) <= (x >= 0 ? 3 : 2)));
    }
    const [, a, rightNode, strip] = d.geoNodes;
    a.construction = fixtureConstruction(d, rect(-12, -5, 2, 5));
    assert.deepEqual(mask(), before);
    const single: Extract<typeof strip.construction, { type: "strip" }> = { type: "strip", of: ["B"], widths: [1, 2], range: { from: "3", to: "0" } };
    strip.construction = single;
    assert(rightNode.construction.type === "outline");
    const selected = mask(), p = literalCurve(d, rightNode.construction.outlines[0]);
    delete single.range;
    assert(mask().reduce((a, b) => a + b) > selected.reduce((a, b) => a + b));
    single.range = { from: "3", to: "0" };
    p.nodes.splice(2, 0, { id: "extra", p: [12, 0], mode: "corner" });
    assert.deepEqual(mask(), selected);
    p.nodes.splice(2, 1);
    assert.deepEqual(mask(), selected);
    p.nodes.pop();
    assert.throws(() => parseDesign(d), /range.*找不到/);
});

test("Blend is monotone, split holds both side values, and a batter measures its grade and residual", () => {
    const plateau = layer("A", rect(-20, -10, 0, 10), { type: "flat", amount: 5 });
    const d = design([base(), plateau, layer("B", { type: "strip", of: ["A"], widths: [2, 6], range: { from: "1", to: "2" } }, { type: "blend" })], .5);
    const strip = d.geoNodes[2];
    const across = (t: ReturnType<typeof generateTerrain>, xs: number[]) => xs.map(x => t.fields.height.values[t.grid.index(x, 0)]);
    const xs = Array.from({ length: 16 }, (_, i) => -1.75 + i * .5);
    const blend = across(generateTerrain(d), xs);
    assert(blend[0] > 6.9 && blend.at(-1)! < 2.1 && blend.every((v, i) => !i || v < blend[i - 1]));
    strip.function = { type: "split" };
    assert.deepEqual(across(generateTerrain(d), xs), xs.map(x => x < 0 ? 7 : 2));
    strip.function = { type: "batter", grade: .5 };
    assert(strip.construction.type === "strip");
    strip.construction.widths = [0, 6];
    const terrain = generateTerrain(d), fill = across(terrain, [.25, 1.25, 2.25, 3.25]);
    for (let i = 1; i < fill.length; i++) assert(Math.abs((fill[i - 1] - fill[i]) / .5 - 1) < .02);
    const issues = terrainIssues(resolveDesign(d), terrain).filter(i => i.kind === "short-batter");
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /放坡不到底.*2\.00/);
    strip.construction.widths = [0, 12];
    assert.equal(generateTerrain(d).batterResiduals.size, 0);
});

test("Zero-width batter edges through grid centres take the input from the high side", () => {
    const top = layer("A", rect(-12, -10, .5, 10), { type: "flat", amount: 6 });
    const strip = layer("B", { type: "strip", of: ["A"], widths: [0, 8], range: { from: "1", to: "2" } }, { type: "batter", grade: 1 });
    const t = generateTerrain(design([base(), top, strip]));
    assert.equal(t.fields.height.values[t.grid.index(1.5, .5)], 7);
    assert.equal(t.fields.height.values[t.grid.index(2.5, .5)], 6);
});

test("Height diagnostics count uncovered cardinal pairs once and ignore non-height strips", () => {
    const top = layer("A", rect(-3, -2, 3, 2), { type: "flat", amount: 3 });
    const band = layer("B", { type: "strip", of: ["A"], widths: [1, 1] }, { type: "split" }, "f");
    const d = design([base(), top, band]); d.fields.f = { label: "F" };
    const issues = () => {
        const t = generateTerrain(d); return terrainIssues(resolveDesign(d), t).filter(i => i.kind === "untreated-height");
    };
    const raw = issues();
    assert.equal(raw.length, 1);
    assert.equal(raw[0].geoNode, "A");
    assert.match(raw[0].message, /20 处.*3\.00/);
    d.geoNodes[2].field = "height";
    assert.equal(issues().length, 0);
    d.geoNodes.pop(); d.geoNodes[1].function = { type: "flat", amount: .5 };
    assert.equal(issues().length, 0);
});

test("Canvas and ordinary writes respect initializer order and independent holes", () => {
    const g = base(), c = rect(-50, -50, 50, 50);
    const hole = rect(2, 2, 8, 8).outlines[0].curve;
    assert(g.construction.type === "outline");
    g.construction.outlines.push({ curve: { ...hole, nodes: hole.nodes.map(v => ({ ...v, id: "h" + v.id })) } });
    const d = design([layer("early", c, { type: "flat", amount: 19 }), layer("color", c, { type: "flat", amount: 2, feather: 0 }, "f"), g,
        layer("T", rect(-50, -2, 2, 2), { type: "flat", amount: 10 })]);
    d.fields.f = { label: "F" };
    d.geoNodes.unshift(addLayer(d, "F", g.construction, { type: "ground", value: 3 }, "f"));
    const t = generateTerrain(parseDesign(d));
    assert.equal(t.grid.width, 60);
    assert.equal(t.fields.f.values[t.grid.index(0, 0)], 5);
    assert.equal(t.fields.height.values[t.grid.index(10, 10)], 2);
    assert.equal(t.fields.height.values[t.grid.index(0, 0)], 12);
    assert.equal(sampleDefined(t.grid, t.fields.height.values, t.fields.height.defined, -40, 0), undefined);
    const i = t.grid.index(4, 4);
    assert.deepEqual([t.fields.height.defined[i], t.fields.height.values[i], t.fields.f.values[i], t.shore[i]], [0, 0, 0, 0]);
    assert.equal(terrainSurface(t)(i), undefined);
});

test("A zero strength disk protects every cell of an eroded slope", () => {
    const all = rect(-24, -24, 24, 24);
    const d = design([base(), layer("S", all, { type: "slope", kind: "radial", lines: [], center: [0, 0], value: 16, radius: 0, rate: -.3 }),
        layer("P", { type: "outline", outlines: [{ curve: circle(6) }] }, { type: "flat", amount: -1 }, "f")]);
    d.fields.f = { label: "F" };
    d.geoNodes.unshift(addLayer(d, "F", all, { type: "ground", value: 1 }, "f"));
    const before = evaluateStack(d);
    d.geoNodes.push(addLayer(d, "E", all, { ...erosion, droplets: 2400, strength: "{field:f}" }));
    const after = evaluateStack(d);
    assert(after.fields.height.values.some((v, k) => v !== before.fields.height.values[k]));
    for (const k of after.regions.get("P")!.cells) assert.equal(after.fields.height.values[k], before.fields.height.values[k]);
});

test("All functions operate on a design with only the built-in field", () => {
    const all = rect(-20, -20, 20, 20), nodes = [base(),
        layer("C", all, { type: "coast", shore: { curve: circle(12) }, roughness: 2, harbor: { center: [0, 0], radius: 0, span: 3 } }),
        layer("M", all, { type: "mountain", valleys: [], ridges: [], peaks: [], floor: 0 }), layer("N", all, { type: "noise", amplitude: 1, scale: 8 }), layer("K", all, { type: "cliff", factor: .7 }),
        layer("E", all, erosion), layer("I", all, { type: "islets", density: 1, reach: 5 }), layer("F", all, { type: "flat", amount: 5 }),
        layer("A", all, { type: "flat", amount: 1, feather: 3 }), layer("S", all, { type: "slope", kind: "path", lines: [{ curve: openCurve([{ p: [-2, 0], h: 2 }, { p: [2, 0], h: 3 }]) }], center: [0, 0], radius: 5, value: 2, rate: -.2 })];
    for (const type of ["blend", "batter", "split"] as const)
        nodes.push(layer(type, { type: "strip", of: ["F"], widths: [2, 2] }, type === "batter" ? { type, grade: .4 } : { type }));
    const d = parseDesign(design(nodes)), a = new Project(d), b = new Project(parseDesign(d));
    assert.deepEqual(a.terrain.fields.height.values, b.terrain.fields.height.values);
    assert(a.terrain.fields.height.values.every(Number.isFinite));
    assert.deepEqual(Object.keys(a.terrain.fields), ["height"]);
});

test("Slope ridges round the crown and foot, interpolate heights and merge at the saddle", () => {
    const area = rect(-50, -50, 50, 50), line = openCurve([
        { p: [-20, 0], h: 24 }, { p: [-10, 0] }, { p: [0, 0], h: 28 }, { p: [20, 0], h: 29 }
    ]);
    const d = design([layer("A", area, { type: "ground", value: 0 }),
        layer("B", area, { type: "mountain", valleys: [], ridges: [{ curve: withNodeSlope(line, "{input:A} / 10 + .05") }], peaks: [] })], .5);
    const project = new Project(parseDesign(d)), f = project.resolved.geoNodes[1].function;
    assert(f.type === "mountain");
    assert.equal(f.ridges[0].curve.nodes[1].h, undefined);
    const height = mountainProfile(f, .0625, 0);
    assert.equal(height(-10, 0, 0), 26);
    assert.equal(height(0, 0, 0), 28);
    assert(28 - height(0, .001, 0) < .000001);
    assert(28 - height(-.001, 0, 0) < .000001 && height(.001, 0, 0) - 28 < .000001);
    assert(Math.abs(height(0, 6, 0) - height(0, 7, 0) - .75) < 1e-9);
    const terrain = project.terrain, k = terrain.grid.index(0, -6), [x, y] = terrain.grid.point(k);
    assert.equal(terrain.fields.height.values[k], Math.fround(height(x, y, 0)));

    const foot = 6 + height(0, 6, 0) / .75;
    assert(Math.abs(height(0, foot, 0) - 1.25) < 1e-9);
    assert(Math.abs((height(0, foot - .001, 0) - height(0, foot, 0)) -
        (height(0, foot, 0) - height(0, foot + .001, 0))) < 1e-6);
    assert.equal(height(0, 100, 4), 4);

    const second = { curve: withNodeSlope(openCurve([{ p: [-20, 20], h: 28 }, { p: [20, 20], h: 28 }]), .75) };
    const merged = mountainProfile({ ...f, ridges: [...f.ridges, second] }, .0625, 0);
    assert(Math.abs(merged(0, 10, 0) - height(0, 10, 0) - 1.25) < 1e-9);
});

test("Ridges, valleys and slope lines follow a smooth height profile on both sides of an arc", () => {
    const curve = openCurve([{ p: [20, 0], h: 8, slope: .5 }, { p: [0, 20], h: 14, slope: .5 }], "corner");
    curve.nodes[0].bulge = bulgeFromDegrees(90);
    const step = .1, tolerance = step / 8, crest = 2, area = rect(-40, -40, 40, 40);
    const d = resolveDesign(design([
        layer("M", area, { type: "mountain", ridges: [{ curve }], valleys: [], peaks: [], crestRound: crest, blend: 0, footRound: 0 }),
        layer("S", area, { type: "slope", kind: "path", lines: [{ curve: openCurve(curve.nodes, "corner"), ease: true }], center: [0, 0], radius: 1, value: 0, rate: 0 })
    ], step));
    const [mountain, slope] = d.geoNodes;
    assert(mountain.function.type === "mountain" && slope.function.type === "slope");
    assert(slope.function.kind === "path");
    slope.function.lines[0].curve.nodes[0].bulge = curve.nodes[0].bulge;
    const ridge = mountainProfile(mountain.function, tolerance, 0);
    const valley = mountainProfile({ ...mountain.function, valleys: mountain.function.ridges, ridges: [] }, tolerance, 0);
    const count = 60, normal = Math.hypot(1, .5);
    for (const [radius, limit] of [[30, .15], [10, .20]]) {
        const angles = Array.from({ length: count }, (_, i) => Math.PI / 4 + i * step / radius);
        const points: Point[] = angles.map(angle => [radius * Math.cos(angle), radius * Math.sin(angle)]);
        const heights = angles.map(angle => 8 + 6 * smooth(20 * angle / (10 * Math.PI)));
        const drop = crest * (1 - 1 / normal) + (Math.abs(radius - 20) - crest * .5 / normal) * .5;
        const grid = createGrid({ xMin: 0, xMax: count * step, yMin: 0, yMax: count * step, step });
        // Sample the arc directly while exercising the production layer evaluator.
        const samples = { ...grid, x: (i: number) => points[i][0], y: (i: number) => points[i][1] };
        const defined = new Uint8Array(grid.size).fill(1);
        const cells = Int32Array.from(points, (_, i) => i * (count + 1));
        const layerValues = evaluateLayer(slope, {
            shape: { box: [-40, -40, 40, 40], contains: () => true, boundary: () => [] },
            cells, mask: defined, left: 0, top: 0, width: count, height: count, canvasWidth: count
        }, { grid: samples, fields: { height: { defined, values: new Float32Array(grid.size) } } }).values;
        const alongArc = (readings: ArrayLike<number>, reference: number[], name: string) => {
            for (let i = 1; i < count; i++) {
                const actual = (readings[i] - readings[i - 1]) / step, expected = (reference[i] - reference[i - 1]) / step;
                assert(Math.abs(actual / expected - 1) <= limit, name + " at radius " + radius + ", sample " + i + ": " + actual + " vs " + expected);
            }
        };
        alongArc(points.map(([x, y]) => ridge(x, y, -100)), heights.map(height => height - drop), "ridge");
        alongArc(points.map(([x, y]) => valley(x, y, 100)), heights.map(height => height + drop), "valley");
        alongArc(layerValues, heights, "slope");
    }

    const profile = numericProfile(mountain.function.ridges[0].curve, tolerance);
    const project = normalProjection(profile.points);
    for (const point of [[30, -8], [-12, 32]] as Point[]) assert.deepEqual(project(...point), nearest(...point, profile.points));
});

test("Interpolated normals preserve straight projections and wrap at the closed seam", () => {
    const straight: Point[] = [[-12, -6], [0, 0], [16, 8]];
    const project = normalProjection(straight);
    for (const point of [[0, 10], [1, -3], [-50, 0], [30, 20]] as Point[]) assert.deepEqual(project(...point), nearest(...point, straight));

    const square: Point[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const closed = normalProjection(square, true), repeated = normalProjection([...square, square[0]], true);
    const a = closed(-1.1, -1), b = closed(-1, -1.1);
    assert.equal(a.segment, 3);
    assert.equal(b.segment, 0);
    assert(a.t < 1 && b.t > 0);
    assert.deepEqual(repeated(-1.1, -1), a);
});

test("Noise gullies cut a bounded proportion of positive heights and leave the sea floor unchanged", () => {
    const area = rect(-16, -16, 16, 16);
    const run = (value: number, carve: number) => generateTerrain(design([
        layer("A", area, { type: "ground", value }),
        layer("B", area, { type: "noise", amplitude: 0, scale: 9, carve })
    ])).fields.height.values;
    const low = run(8, 20), high = run(16, 20);
    assert(low.some(h => h < 8));
    assert(low.every(h => h >= 6.4 - 1e-6 && h <= 8));
    assert(high.every((h, i) => h === 2 * low[i]));
    assert.deepEqual(run(-4, 20), run(-4, 0));
    assert.deepEqual(run(0, 20), run(0, 0));
});

test("Omitted mountain and erosion floors preserve cells at and below minus one thousand", () => {
    const area = rect(-12, -12, 12, 12);
    const m = layer("M", area, { type: "mountain", valleys: [], ridges: [], peaks: [{ at: [0, 0], height: 5, radius: 3, noise: 0, scale: 12 }] });
    const e = layer("E", area, { ...erosion });
    for (const node of [m, e]) {
        const d = design([layer("A", area, { type: "ground", value: -1000 }),
            layer("B", area, { type: "slope", kind: "path", lines: [{ curve: openCurve([{ p: [-8, 0], h: -12 }, { p: [8, 0], h: 0 }]) }], center: [0, 0], radius: 5, value: 2, rate: -.2 })]);
        const before = evaluateStack(d).fields.height.values;
        const placed = placeLayer(d, node);
        d.geoNodes.push(placed);
        const initial = evaluateStack(d).fields.height.values;
        assert.deepEqual(initial, before); assert(initial.includes(-1000));
        Object.assign(placed.function, { floor: -1000 });
        assert.deepEqual(evaluateStack(d).fields.height.values, initial);
        Object.assign(placed.function, { floor: -2000 });
        assert.notDeepEqual(evaluateStack(d).fields.height.values, before);
    }
});