import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, fieldValue, sampleValue } from "../src/core/design/expression.ts";
import { canReference, expressionGraph, referenceUses, resolveDesign } from "../src/core/design/parameters.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { newDesign } from "../src/core/design/newDesign.ts";
import { type Design } from "../src/core/design/v5.ts";
import { deleteGeo } from "../src/core/edit/geoNodes.ts";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { layer, rect, syntheticDesign } from "./scenarios.ts";

test("Arithmetic and linear fields observe precedence, signed scalars and undefined samples", () => {
    const ref = (k: string) => k === "input:a" ? 3 : fieldValue(k.slice(6));
    assert.equal(evaluate("-(2 + 3) * -4 / 2 - .5", ref), 9.5);
    assert.equal(evaluate("{input:a} + 0.5", ref), 3.5);
    assert.equal(evaluate("1.5e-2", ref), .015);
    const read = (id: string) => ({ rock: 4, height: 2 })[id];
    assert.equal(sampleValue(evaluate("{field:rock} * 0.75 + 0.3", ref), read), 3.3);
    assert.equal(sampleValue(evaluate("2 * ({field:rock} - {field:height}) + {field:height} / 2", ref), read), 5);
    assert.equal(sampleValue(evaluate("{field:height} * 0 + 4", ref), () => undefined), undefined);
    for (const [bad, error] of [["{field:a} * {field:b}", /场不能与场相乘/], ["3 / {field:a}", /除数不能是场/],
        ["1 / (2 - 2)", /除数不能为 0/], ["(1 + 3", /括号/], ["1 2", /运算符/], ["{input:a} +", /缺少/]] as const)
        assert.throws(() => evaluate(bad, ref), error);
});

test("Author inputs form one graph across stacks, array parameters and marks", () => {
    const d: Design = syntheticDesign();
    d.geoNodes[1].function = { type: "flat", amount: "{input:A}" };
    d.geoNodes.push(layer("M", rect(-8, -8, 8, 8), { type: "mountain", peaks: [], ridges: [{
        widths: [1, "{input:b}"], widthNoise: { amount: 0, wavelength: 20 }, heightNoise: { amount: 0, wavelength: 20 },
        line: { points: [{ p: [0, 0], h: 2 }, { p: [2, 2], h: "{input:b}" }] }
    }] }));
    d.inputs.b = { range: defaultInputRange("b"), value: "{geo:T.amount} + 1" };
    d.inputs.c = { range: defaultInputRange("c"), value: "{geo:M.ridges.0.widths.1} + 1" };
    d.marks.push({ id: "B", label: "B", kind: "text", follow: "map", point: [1, 2], elevation: "{input:c} - 1" });
    const parsed = parseDesign(serializeDesign(d)), before = serializeDesign(parsed), numeric = resolveDesign(parsed);
    assert.equal(numeric.inputs.c.value, 9);
    const mark = numeric.marks[0];
    assert(mark.kind === "text");
    assert.equal(mark.elevation, 8);
    assert.equal(serializeDesign(parsed), before);
    const { slots } = expressionGraph(d);
    assert(!canReference(slots, "geo:T.amount", "input:c"));
    assert(!canReference(slots, "input:b", "input:b"));
    assert(canReference(slots, "input:b", "input:A"));
    assert(referenceUses(d, "geo", "T").some(p => p.includes("inputs.b.value")));
    assert.throws(() => deleteGeo(d, "T"), /inputs.b.value/);
});

test("Format and type errors identify the authored slot and cycles name every participant", () => {
    const d: Design = syntheticDesign(), a = d.geoNodes[0], b = d.geoNodes[1];
    a.function = { type: "ground", value: "{geo:T.amount} + 1" };
    b.function = { type: "flat", amount: "{geo:G.value}" };
    assert.throws(() => parseDesign(d), /“G”.数值 → “T”.增量 → “G”.数值/);
    b.function.amount = "{input:A}"; d.inputs.A.value = "{geo:G.value}";
    assert.throws(() => parseDesign(d), e => e instanceof Error && ["“G”.数值", "“T”.增量", "“A”", "引用成环"].every(v => e.message.includes(v)));
    d.inputs.A.value = 4;
    for (const bad of ["{field:height}", "{geo:G.construction.paths.0.nodes.0.p.0}", "{building:A.padElevation}", "{edge:E.length}", "{node:a.point.1}", "1 + @"])
        assert.throws(() => parseDesign({ ...d, inputs: { A: { value: bad } } }), /inputs.A.value/);
    for (const old of [{ var: "A", offset: 1 }, { field: "height", scale: .5 }]) {
        Object.assign(b.function, { amount: old });
        assert.throws(() => parseDesign(d), /geoNodes\[1\]\.function\.amount.*未知/);
    }
    b.function.amount = 1;
    const invalid = structuredClone(d);
    const region = invalid.geoNodes[0].construction;
    assert(region.type === "free");
    Object.assign(region.paths[0].nodes[0], { p: ["{input:A}", 0] });
    assert.throws(() => parseDesign(invalid), /construction.paths\[0\].nodes\[0\]/);
    assert.throws(() => parseDesign({ ...d, seed: 5 }), /seed.*移除/);
    assert.throws(() => parseDesign({ ...d, marks: [{ id: "A", label: "A", kind: "text", point: ["{input:A}", 0] }] }), /marks\[0\].point/);
    d.inputs.A.value = " 2.5 ";
    assert.equal(parseDesign(d).inputs.A.value, 2.5);
    b.id = "T.B"; d.inputs.c = { range: defaultInputRange("c"), value: "{geo:T.B.amount}" }; a.function.value = 0;
    assert.deepEqual(referenceUses(d, "geo", "T"), []);
    assert(referenceUses(d, "geo", "T.B").some(v => v.includes("inputs.c.value")));
});
test("Rounded per-layer seeds and transitive scalar inputs invalidate only their readers", () => {
    const d: Design = newDesign(), base = d.geoNodes[0], cache = new TerrainCache();
    d.geoNodes.push(layer("N", base.construction, { type: "noise", amplitude: 1, scale: 7, seed: "{input:seed}" }));
    d.inputs.seed.value = 2.6;
    const a = cache.generate(d);
    d.inputs.seed.value = 3;
    assert.deepEqual(cache.generate(d).heights, a.heights); assert.deepEqual(cache.recomputed, []);
    d.inputs.seed.value = 4;
    assert.notDeepEqual(cache.generate(d).heights, a.heights); assert.deepEqual(cache.recomputed, ["N"]);
    delete d.geoNodes[1].function.seed;
    const zero = cache.generate(d).heights;
    d.geoNodes[1].function.seed = 0;
    assert.deepEqual(generateTerrain(d).heights, zero);
    d.geoNodes[1].function = { type: "flat", amount: "{geo:ground.value} + 1" };
    cache.generate(d); d.inputs.base.value = 6.25;
    const after = cache.generate(d);
    assert.deepEqual(after.heights, generateTerrain(d).heights); assert.deepEqual(cache.recomputed, [base.id, "N"]);
});

test("Omitted parameters can be referenced and old ridge tuples fail at their original address", () => {
    const d: Design = syntheticDesign(), mountain = { type: "mountain" as const, peaks: [], ridges: [{
        line: { points: [{ p: [0, 0], h: 2 }, { p: [5, 0], h: 2 }] }, widths: [3, 3],
        heightNoise: { amount: "{input:A} * 2" }, widthNoise: { wavelength: "{input:A} + 1" }
    }] };
    Object.assign(d.geoNodes[1], { function: mountain });
    const graph = expressionGraph(d);
    for (const [key, value] of [["heightNoise.amount", 14], ["heightNoise.wavelength", 20], ["widthNoise.amount", 0], ["widthNoise.wavelength", 8]])
        assert.equal(graph.get("geo:T.ridges.0." + key), value);
    d.inputs.c = { range: defaultInputRange("c"), value: "{geo:T.floor} + {geo:T.seed} + {geo:T.ridges.0.heightNoise.wavelength}" };
    assert.equal(resolveDesign(parseDesign(d)).inputs.c.value, -980);
    for (const key of ["widthNoise", "heightNoise"]) {
        const bad = structuredClone(d), f = bad.geoNodes[1].function;
        assert(f.type === "mountain");
        Object.assign(f.ridges[0], { [key]: [0, 1, 2] });
        assert.throws(() => parseDesign(bad), e => e instanceof Error && e.message.includes("geoNodes[1].function.ridges[0]." + key));
    }
    Object.assign(mountain.ridges[0].widthNoise, { wavelength: 0 });
    assert.throws(() => parseDesign(d), /widthNoise.wavelength/);
});

test("Geometry inputs expose concrete defaults without changing authored height stops", () => {
    const d: Design = syntheticDesign(), n = d.geoNodes[1];
    n.function = { type: "slope", kind: "path", ease: true, line: { points: [
        { p: [0, 0], h: 2 }, { p: [2, 0] }, { p: [8, 0], h: 10 }
    ] } };
    d.inputs.b = { range: defaultInputRange("b"), value: "{geo:T.line.points.1.h} + {geo:T.line.points.0.h}" };
    const g = expressionGraph(d), resolved = resolveDesign(parseDesign(d)), t = resolved.geoNodes[1].function;
    assert(t.type === "slope" && t.kind === "path");
    assert.equal(g.get("geo:T.line.points.1.h"), 3.25);
    assert.equal(resolved.inputs.b.value, 5.25);
    assert.equal(t.line.points[1].h, 3.25);
    const unchanged = generateTerrain(d).heights;
    const noMidpoint = structuredClone(d);
    const slope = noMidpoint.geoNodes[1].function;
    assert(slope.type === "slope" && slope.kind === "path");
    noMidpoint.inputs.b.value = resolved.inputs.b.value;
    slope.line.points.splice(1, 1);
    assert.deepEqual(generateTerrain(noMidpoint).heights, unchanged);
    assert.equal(n.function.line.points[1].h, undefined, "The source retains its two authored height stops");
    const ridge = { line: n.function.line, widths: [4, 4] };
    Object.assign(n, { function: { type: "mountain", ridges: [ridge], peaks: [] } });
    d.inputs.b.value = "{geo:T.ridges.0.line.points.1.h}";
    const parsed = parseDesign(d), m = resolveDesign(parsed).geoNodes[1].function;
    assert(m.type === "mountain"); assert.equal(m.floor, -1000);
    assert.deepEqual(m.ridges[0].widthNoise, { amount: 0, wavelength: 20 });
    assert.equal(resolveDesign(parsed).inputs.b.value, 4);
});