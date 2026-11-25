import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLayer } from "../src/core/terrain/functions.ts";
import { resolveDesign, type Address, writeAt } from "../src/core/design/parameters.ts";
import { type GeoFunction, type GeoNode } from "../src/core/design/v5.ts";
import { createGrid } from "../src/core/math/geometry.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { evaluateLayer, type FieldState } from "../src/core/terrain/functions.ts";
import { makeShape, rasterRegion } from "../src/core/design/regions.ts";
import { evaluateStack } from "../src/core/terrain/terrain.ts";
import { erosion, layer, openCurve, polygon, rect, syntheticDesign } from "./scenarios.ts";

const area = rect(-28, -25, 28, 25);
const shore = polygon([[-16, -20], [16, -20], [18, 16], [-15, 19]]);
const line = openCurve([{ p: [-17, -9], h: 2 }, { p: [-3, 4], h: 8 }, { p: [18, 0], h: 4 }], "auto");
type Fn = GeoFunction<number>;
type Mutation = [address: Address, replacement: unknown];
type Case = { fn: Fn; changes: Mutation[]; fieldInput?: boolean };
const grid = createGrid({ xMin: -34, xMax: 34, yMin: -30, yMax: 30, step: 1 });
const filled = new Uint8Array(grid.size).fill(1);
const height = Float32Array.from(filled, (_, k) => {
    const [x, y] = grid.point(k);
    return x < 0 ? -3 : 7 + x / 5 + 2 * Math.sin(y / 5) + 1.2 * Math.cos((x + y) / 4);
});
const other = Float32Array.from(filled, (_, k) => .62 + .2 * Math.sin(grid.point(k)[1] / 8));
const free = rasterRegion(grid, makeShape({ field: "height", id: "A", label: "A", construction: area, function: { type: "ground", value: 0 } }, new Map(), .125));
const stripConstruction: GeoNode<number>["construction"] = { type: "strip", of: ["A"], widths: [3, 6], range: { from: "1", to: "2" } };
const side = makeShape({ field: "height", id: "A", label: "A", construction: rect(-22, -18, 4, 18), function: { type: "ground", value: 0 } }, new Map(), .125);
const stripRegion = rasterRegion(grid, makeShape({ field: "height", id: "B", label: "B", construction: stripConstruction, function: { type: "split" } }, new Map([["A", side]]), .125));

const cases: Record<Fn["type"], Case> = {
    ground: { fn: { type: "ground", value: 2 }, changes: [[["value"], 4]] },
    flat: { fn: { type: "flat", amount: "{field:A} * 3", feather: 9 }, fieldInput: true, changes: [[["amount"], 1], [["feather"], 3]] },
    slope: { fn: { type: "slope", kind: "path", line, ease: true },
        changes: [[["line", "nodes", 1, "p"], [0, 12]], [["line", "nodes", 0, "h"], 3], [["line", "nodes", 1, "h"], 11],
            [["line", "nodes", 2, "h"], 6], [["line", "nodes", 1, "mode"], "corner"], [["ease"], false]] },
    noise: { fn: { type: "noise", amplitude: "{field:A}", scale: 8, seed: 3, octaves: 4, feather: 6 }, fieldInput: true,
        changes: [[["amplitude"], 1], [["scale"], 10], [["seed"], 5], [["octaves"], 2], [["feather"], 2]] },
    coast: { fn: { type: "coast", shore, roughness: "{field:A} * 16", harbor: { center: [-14, 8], radius: 3, span: 7 }, seed: 11 }, fieldInput: true,
        changes: [[["shore", "nodes", 0, "p"], [-5, -11]], [["roughness"], 2], [["harbor", "center"], [14, 16]], [["harbor", "radius"], 12],
            [["harbor", "span"], 25], [["seed"], 23]] },
    mountain: { fn: { type: "mountain", floor: -5, seed: 16, ridges: [{ line, widths: [8, 9],
        widthNoise: { amount: 18, wavelength: 11 }, heightNoise: { amount: 20, wavelength: 9 } }],
    peaks: [{ at: { p: [11, -10], h: 24 }, radius: 5, noise: 1.4, scale: 8 }] },
    changes: [[["floor"], 10], [["seed"], 19], [["ridges", 0, "line", "nodes", 1, "p"], [-6, 9]], [["ridges", 0, "line", "nodes", 0, "h"], 8],
        [["ridges", 0, "line", "nodes", 1, "h"], 12], [["ridges", 0, "line", "nodes", 2, "h"], 15], [["ridges", 0, "line", "nodes", 1, "mode"], "corner"],
        [["ridges", 0, "widths", 0], 12], [["ridges", 0, "widths", 1], 12], [["ridges", 0, "widthNoise", "amount"], 30],
        [["ridges", 0, "widthNoise", "wavelength"], 17], [["ridges", 0, "heightNoise", "amount"], 35], [["ridges", 0, "heightNoise", "wavelength"], 20],
        [["peaks", 0, "at", "p"], [8, -14]], [["peaks", 0, "at", "h"], 31], [["peaks", 0, "radius"], 8],
        [["peaks", 0, "noise"], 4], [["peaks", 0, "scale"], 6]] },
    cliff: { fn: { type: "cliff", factor: "{field:A} * .9", seaLevel: 0, seed: 3 }, fieldInput: true,
        changes: [[["factor"], .3], [["seaLevel"], 8], [["seed"], 7]] },
    erosion: { fn: { ...erosion, droplets: 1200, seed: 13, minCapacity: .0002, evaporation: .12, lifetime: 26, floor: -1, strength: "{field:A}" }, fieldInput: true,
        changes: [[["droplets"], 200], [["inertia"], .96], [["capacity"], .05], [["minCapacity"], 7], [["deposition"], .8], [["erosion"], .7],
            [["evaporation"], .5], [["gravity"], 10], [["lifetime"], 6], [["radius"], 1], [["seed"], 7], [["floor"], 8], [["strength"], .1]] },
    islets: { fn: { type: "islets", density: "{field:A}", reach: 16, threshold: .45, seaLevel: 0, seed: 5 }, fieldInput: true,
        changes: [[["density"], .95], [["reach"], 3], [["threshold"], .8], [["seaLevel"], 8], [["seed"], 14]] },
    blend: { fn: { type: "blend" }, changes: [] },
    split: { fn: { type: "split" }, changes: [] },
    batter: { fn: { type: "batter", grade: .7 }, changes: [[["grade"], 1.4]] }
};

const radial: Case = { fn: { type: "slope", kind: "radial", center: [2, 4], radius: 5, value: 2, rate: -.2 },
    changes: [[["center"], [-2, 1]], [["radius"], 8], [["value"], 4], [["rate"], -.7]] };

test("Every built-in function uses its parameters and ordinary functions read their lower fields", () => {
    for (const { fn, changes, fieldInput } of [...Object.values(cases), radial]) {
        const render = (f: Fn, source = height, bound = other): Float32Array => {
            const { node, region } = resolvedCase(f);
            const state: FieldState = { grid, fields: { height: { values: source, defined: filled }, A: { values: bound, defined: filled } } };
            return evaluateLayer(node, region, state).values;
        };
        const out = render(fn), label = fn.type === "slope" ? "slope." + fn.kind : fn.type;
        assert(out.length && out.every(Number.isFinite), label);
        const raised = render(fn, height.map(v => v + 1));
        if (fn.type === "ground") assert.deepEqual(raised, out, label + " must ignore lower fields");
        else assert.notDeepEqual(raised, out, label + " must read the written field");
        if (fieldInput) assert.notDeepEqual(render(fn, height, other.map(v => v * .25)), out, label + " must read its bound field");
        for (const [path, replacement] of changes) {
            const f = structuredClone(fn);
            writeAt(f, path, replacement);
            assert(render(f).some((value, i) => value !== out[i]), label + "." + path.join("."));
        }
    }
});

test("Flat, both slopes and coast pass a one-metre ground lift through the stack and cache", () => {
    const coast: Fn = { type: "coast", shore, roughness: 0, harbor: { center: [0, 0], radius: 0, span: 3 } };
    for (const fn of [{ type: "flat", amount: 2 } as const, cases.slope.fn, radial.fn, coast]) {
        const d = syntheticDesign(), ground = d.geoNodes[0];
        d.geoNodes = [ground, layer("A", area, fn)];
        const cache = new TerrainCache();
        const before = cache.generate(d), cells = before.regions.get("A")!.cells;
        assert(ground.function.type === "ground");
        ground.function.value = Number(ground.function.value) + 1;
        const after = cache.generate(d);
        assert.deepEqual(after.fields.height.values, evaluateStack(d).fields.height.values);
        assert(cells.every(k => Math.abs(after.fields.height.values[k] - before.fields.height.values[k] - 1) < 1e-6), fn.type);
    }
});

function resolvedCase(f: Fn, field = "height") {
    const isStrip = ["blend", "split", "batter"].includes(f.type), d = syntheticDesign();
    d.fields.A = { label: "A" };
    d.geoNodes = [layer("B", isStrip ? stripConstruction : area, f, field)];
    return { node: resolveDesign(d).geoNodes[0], region: isStrip ? stripRegion : free };
}

for (const { fn, fieldInput } of [...Object.values(cases), radial]) {
    const label = fn.type === "slope" ? fn.type + "." + fn.kind : fn.type;
    test(label + " writes only where its inputs are defined, except for initialization", () => {
        const initial = fn.type === "ground", field = initial ? "A" : "height", { node, region } = resolvedCase(fn, field);
        const partial = Uint8Array.from(filled, (_, k) => +(grid.point(k)[1] > -8));
        const mask = fieldInput || initial ? filled : partial;
        const state: FieldState = { grid, fields: { height: { values: height.slice(), defined: mask.slice() },
            A: { values: other.slice(), defined: partial.slice() } } };
        const target = state.fields[field], before = target.values.slice(), oldMask = target.defined.slice();
        const output = evaluateLayer(node, region, state);
        applyLayer(output, node, state);
        assert(output.values.every(Number.isFinite));
        const absent = region.cells.filter(k => !partial[k]);
        assert(absent.length);
        if (initial) {
            assert(region.cells.every(k => target.defined[k] === 1 && target.values[k] === 2));
            assert.deepEqual(state.fields.height.values, height);
        }
        else {
            assert(absent.every(k => target.values[k] === before[k]));
            assert.deepEqual(target.defined, oldMask);
            assert(region.cells.some(k => partial[k] && target.values[k] !== before[k]));
        }
    });
}

test("Strip functions skip missing neighbor samples even at defined target cells", () => {
    for (const type of ["blend", "split", "batter"] as const) {
        const { node, region } = resolvedCase(cases[type].fn);
        const mask = Uint8Array.from(filled, (_, k) => {
            const [x, y] = grid.point(k);
            return +(x > 2 || y > 0);
        });
        const state: FieldState = { grid, fields: { height: { defined: mask, values: height.slice() } } };
        const output = evaluateLayer(node, region, state);
        applyLayer(output, node, state);
        const held = grid.index(2.5, -3.5), changed = grid.index(2.5, 3.5);
        assert(region.mask[held] && region.mask[changed] && mask[held] && mask[changed]);
        assert.equal(state.fields.height.values[held], height[held], type);
        assert(output.cells.includes(changed), type);
    }
});

test("Flat applies field increments with and without feathering", () => {
    const area = rect(-5, -4, 5, 4), d = syntheticDesign();
    d.fields.A = { label: "A" };
    const flat = layer("F", area, { type: "flat", amount: "{field:A} * 0.5", feather: 0 });
    d.geoNodes = [layer("H", area, { type: "ground", value: 4 }), layer("A", area, { type: "ground", value: 6 }, "A"), flat];
    const plain = evaluateStack(d);
    assert(plain.fields.height.values.every(v => v === 7));
    flat.function = { type: "flat", amount: "{field:A} * 0.5", feather: 1 };
    const soft = evaluateStack(d), { grid } = soft;
    assert.equal(soft.fields.height.values[grid.index(-4.5, .5)], 5.5);
    assert.equal(soft.fields.height.values[grid.index(-3.5, .5)], 7);
});