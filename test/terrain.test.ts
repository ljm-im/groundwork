import { test } from "node:test";
import assert from "node:assert/strict";
import { type ClosedCurve, type Point, type GeoNode } from "../src/core/design/v5.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { distance, nearest, sampleDefined, spline } from "../src/core/math/geometry.ts";
import { fbm, noise } from "../src/core/math/noise.ts";
import { regionMaskAt, signedBoundaryDistance } from "../src/core/design/regions.ts";
import { shapePath } from "../src/core/edit/paths.ts";
import { flattenPath } from "../src/core/design/path.ts";
import { evaluateStack, generateTerrain } from "../src/core/terrain/terrain.ts";
import { terrainIssues } from "../src/core/checks/terrain.ts";
import { terrainSurface } from "../src/core/terrain/surface.ts";
import { Project } from "../src/core/project.ts";
import { erosion, layer, rect, syntheticDesign, openCurve } from "./scenarios.ts";

function design(nodes: GeoNode[], step = 1) {
    const d = syntheticDesign();
    d.grid.step = step;
    d.geoNodes = nodes;
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
    detail.function.seed = "{input:seed} + 6";
    assert.deepEqual(generateTerrain(d).fields.height.values, initial.terrain.fields.height.values);
});

test("A local mountain preserves the underlying height differences along its boundary", () => {
    const g = base(), slope = layer("S", g.construction, { type: "slope", kind: "path",
        line: openCurve([{ p: [-30, 0], h: 4 }, { p: [30, 0], h: 7 }]) });
    const d = design([g, slope]), before = evaluateStack(d).fields.height.values;
    d.geoNodes.push(layer("M", rect(-12, -12, 12, 12), { type: "mountain",
        ridges: [{ line: openCurve([{ p: [-5, 0], h: 12 }, { p: [5, 0], h: 10 }]),
            widths: [2, 3], widthNoise: { amount: 10, wavelength: 2 }, heightNoise: { amount: 10, wavelength: 4 } }],
        peaks: [{ at: { p: [0, 3], h: 16 }, radius: 2, noise: .1, scale: 7 }] }));
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
    d.geoNodes.splice(1, 0, layer("BB", d.geoNodes[0].construction, { type: "ground", value: 2.5 }, "B"));
    const plain = evaluateStack(parseDesign(d));
    n.function = { ...fn, feather: 4 };
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
    const g = base(), disk = layer("Z", { type: "free", paths: [circle(6)] }, { type: "flat", amount: -4 }, "A");
    const n = layer("N", g.construction, { type: "noise", amplitude: "{field:A} * 0.5", scale: 7, octaves: 2 });
    const a = layer("A", g.construction, { type: "ground", value: 4 }, "A");
    const d = design([g, a, disk, n]); d.fields.A = { label: "A" };
    const t = evaluateStack(parseDesign(d)), pattern = noise(0), region = t.regions.get(disk.id)!;
    assert(region.cells.length && t.fields.height.values.some((v, k) => !regionMaskAt(region, k) && v !== 2));
    for (let k = 0; k < t.grid.size; k++) {
        const [x, y] = t.grid.point(k);
        assert.equal(t.fields.height.values[k], regionMaskAt(region, k) ? 2 : Math.fround(2 + 2 * fbm(pattern, x / 7, y / 7, 2)));
    }
    n.field = "A"; n.function = { type: "noise", amplitude: "{field:height}", scale: 7 };
    d.geoNodes = [a, n, g];
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
    const g = base(); g.construction = { type: "free", paths: [circle(20)] };
    const d = design([g], .5), full = evaluateStack(d);
    const area = full.fields.height.defined.reduce((a, b) => a + b, 0) * d.grid.step ** 2;
    assert(Math.abs(area / (Math.PI * 400) - 1) < .01);
    g.construction.paths.push({ ...circle(7), nodes: circle(7).nodes.map(v => ({ ...v, id: "hole" + v.id })) });
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
    left.construction = rect(-12, -5, 2, 5);
    assert.deepEqual(mask(), before);
    const single = { type: "strip" as const, of: ["B"] as [string], widths: [1, 2] as Point, range: { from: "3", to: "0" } };
    band.construction = single;
    const selected = mask(), p = right.paths[0];
    delete (band.construction as { range?: unknown }).range;
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
    const strip = layer("B", { type: "strip", of: ["A"], widths: [2, 6], range: { from: "1", to: "2" } }, { type: "blend" });
    const d = design([base(), plateau, strip], .5);
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
    const issues = terrainIssues(d, terrain).filter(i => i.kind === "short-batter");
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
        const t = generateTerrain(d); return terrainIssues(d, t).filter(i => i.kind === "untreated-height");
    };
    const raw = issues();
    assert.equal(raw.length, 1);
    assert.equal(raw[0].geoNode, "A");
    assert.match(raw[0].message, /20 处.*3\.00/);
    band.field = "height";
    assert.equal(issues().length, 0);
    d.geoNodes.pop(); top.function = { type: "flat", amount: .5 };
    assert.equal(issues().length, 0);
});

test("Canvas and ordinary writes respect initializer order and independent holes", () => {
    const g = base(), c = rect(-50, -50, 50, 50);
    const hole = rect(2, 2, 8, 8).paths[0];
    assert(g.construction.type === "free");
    g.construction.paths.push({ ...hole, nodes: hole.nodes.map(v => ({ ...v, id: "h" + v.id })) });
    const d = design([layer("early", c, { type: "flat", amount: 19 }), layer("color", c, { type: "flat", amount: 2, feather: 0 }, "f"), g,
        layer("T", rect(-50, -2, 2, 2), { type: "flat", amount: 10 })]);
    d.fields.f = { label: "F" };
    d.geoNodes.unshift(layer("F", g.construction, { type: "ground", value: 3 }, "f"));
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
    const d = design([base(), layer("S", all, { type: "slope", kind: "radial", center: [0, 0], value: 16, radius: 0, rate: -.3 }),
        layer("P", { type: "free", paths: [circle(6)] }, { type: "flat", amount: -1 }, "f")]);
    d.fields.f = { label: "F" };
    d.geoNodes.unshift(layer("F", all, { type: "ground", value: 1 }, "f"));
    const before = evaluateStack(d);
    d.geoNodes.push(layer("E", all, { ...erosion, droplets: 2400, strength: "{field:f}" }));
    const after = evaluateStack(d);
    assert(after.fields.height.values.some((v, k) => v !== before.fields.height.values[k]));
    for (const k of after.regions.get("P")!.cells) assert.equal(after.fields.height.values[k], before.fields.height.values[k]);
});

test("All functions operate on a design with only the built-in field", () => {
    const all = rect(-20, -20, 20, 20), nodes = [base(),
        layer("C", all, { type: "coast", shore: circle(12), roughness: 2, harbor: { center: [0, 0], radius: 0, span: 3 } }),
        layer("M", all, { type: "mountain", ridges: [], peaks: [], floor: 0 }), layer("N", all, { type: "noise", amplitude: 1, scale: 8 }), layer("K", all, { type: "cliff", factor: .7 }),
        layer("E", all, erosion), layer("I", all, { type: "islets", density: 1, reach: 5 }), layer("F", all, { type: "flat", amount: 5 }),
        layer("A", all, { type: "flat", amount: 1, feather: 3 }), layer("S", all, { type: "slope", kind: "path", line: openCurve([{ p: [-2, 0], h: 2 }, { p: [2, 0], h: 3 }]) })];
    for (const type of ["blend", "batter", "split"] as const)
        nodes.push(layer(type, { type: "strip", of: ["F"], widths: [2, 2] }, type === "batter" ? { type, grade: .4 } : { type }));
    const d = parseDesign(design(nodes)), a = new Project(d), b = new Project(parseDesign(d));
    assert.deepEqual(a.terrain.fields.height.values, b.terrain.fields.height.values);
    assert(a.terrain.fields.height.values.every(Number.isFinite));
    assert.deepEqual(Object.keys(a.terrain.fields), ["height"]);
});

test("Ridge variation follows distance, wavelength and seed independently of collinear vertices", () => {
    const area = rect(-2, -8, 131, 8), line = openCurve([{ p: [.5, -.5], h: 10 }, { p: [128.5, -.5], h: 10 }]);
    const ridge = { line, widths: [4, 4] as [number, number], widthNoise: { amount: 0, wavelength: 8 }, heightNoise: { amount: 0, wavelength: 8 } };
    const mountain = { type: "mountain" as const, ridges: [ridge], peaks: [], seed: 12 };
    const d = design([layer("A", area, { type: "ground", value: 0 }), layer("B", area, mountain)]);
    const samples = (y: number) => {
        const t = evaluateStack(d);
        return Array.from({ length: 129 }, (_, x) => t.fields.height.values[t.grid.index(x, y)]);
    };
    for (const [key, y] of [["heightNoise", 0], ["widthNoise", 3]] as const) {
        const straight = samples(y);
        assert.equal(new Set(straight).size, 1);
        ridge[key].amount = 25;
        const short = samples(y);
        assert(new Set(short).size > 8);
        if (y === 0) assert(short.every(h => h >= 7.5 && h <= 12.5));
        ridge[key].wavelength *= 2;
        const long = samples(y);
        // The entire waveform, including every zero crossing, stretches twofold.
        assert.deepEqual(long.filter((_, i) => i % 2 === 0), short.slice(0, 65));
        line.nodes.splice(1, 0, { id: "extra", p: [37.5, -.5], h: 10, mode: "corner" });
        assert.deepEqual(samples(y), long);
        mountain.seed++;
        assert.notDeepEqual(samples(y), long);
        line.nodes.splice(1, 1); ridge[key].amount = 0;
    }
});

test("Omitted mountain and erosion floors preserve cells at and below minus one thousand", () => {
    const area = rect(-12, -12, 12, 12);
    const m = layer("M", area, { type: "mountain", ridges: [], peaks: [{ at: { p: [0, 0], h: 5 }, radius: 3, noise: 0, scale: 12 }] });
    const e = layer("E", area, { ...erosion });
    for (const node of [m, e]) {
        const d = design([layer("A", area, { type: "ground", value: -1000 }),
            layer("B", area, { type: "slope", kind: "path", line: openCurve([{ p: [-8, 0], h: -12 }, { p: [8, 0], h: 0 }]) })]);
        const before = evaluateStack(d).fields.height.values;
        d.geoNodes.push(node);
        const initial = evaluateStack(d).fields.height.values;
        assert.deepEqual(initial, before); assert(initial.includes(-1000));
        Object.assign(node.function, { floor: -1000 });
        assert.deepEqual(evaluateStack(d).fields.height.values, initial);
        Object.assign(node.function, { floor: -2000 });
        assert.notDeepEqual(evaluateStack(d).fields.height.values, before);
    }
});