import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, fieldValue, sampleValue } from "../src/core/design/expression.ts";
import { canReference, expressionGraph, referenceSlots, resolveDesign, slotName, type Owner } from "../src/core/design/parameters.ts";
import { DesignError, problemText } from "../src/core/design/problems.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { newDesign } from "../src/core/design/newDesign.ts";
import { type Design, type Expression } from "../src/core/design/v5.ts";
import { deleteGeo, removalUses } from "../src/core/edit/geoNodes.ts";
import { defaultInputRange } from "../src/core/design/defaults.ts";
import { numberEdits } from "../src/core/design/numberEdit.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { literalCurve, layer, rect, syntheticDesign, openCurve } from "./scenarios.ts";

function referenceUses(d: Design, kind: Owner, id: string) {
    return referenceSlots(d, kind, id).map(s => slotName(s) + "（" + problemText({ location: s.location, message: "" }).trimEnd() + "）");
}

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
    d.geoNodes[1].function = { type: "ground", value: "{input:A}" };
    d.geoNodes.push(layer("M", rect(-8, -8, 8, 8), { type: "mountain", peaks: [], ridges: [{
        slope: "{input:b}",
        curve: openCurve<Expression>([{ p: [0, 0], h: 2 }, { p: [2, 2], h: "{input:b}" }])
    }] }));
    d.inputs.b = { range: defaultInputRange("b"), value: "{geo:T.value} + 1" };
    d.inputs.c = { range: defaultInputRange("c"), value: "{geo:M.ridges.0.slope} + 1" };
    d.marks.push({ id: "B", label: "B", kind: "text", follow: "map", point: [1, 2], elevation: "{input:c} - 1" });
    const parsed = parseDesign(serializeDesign(d)), before = serializeDesign(parsed), numeric = resolveDesign(parsed);
    assert.equal(numeric.inputs.c.value, 9);
    const mark = numeric.marks[0];
    assert(mark.kind === "text");
    assert.equal(mark.elevation, 8);
    assert.equal(serializeDesign(parsed), before);
    const { slots } = expressionGraph(d);
    assert(!canReference(slots, "geo:T.value", "input:c"));
    assert(!canReference(slots, "input:b", "input:b"));
    assert(canReference(slots, "input:b", "input:A"));
    assert(referenceUses(d, "geo", "T").some(p => p.includes("inputs.b.value")));
    assert.throws(() => deleteGeo(d, "T"), /仍被引用[\s\S]*“b”/);
});

test("Format and type errors identify the authored slot and cycles name every participant", () => {
    const d: Design = syntheticDesign(), a = d.geoNodes[0], b = d.geoNodes[1];
    a.function = { type: "ground", value: "{geo:T.value} + 1" };
    b.function = { type: "slope", kind: "radial", center: [0, 0], radius: 1, value: "{geo:G.value}", rate: 0 };
    assert.throws(() => parseDesign(d), /“G.数值” → “T.增量” → “G.数值”/);
    b.function.value = "{input:A}"; d.inputs.A.value = "{geo:G.value}";
    assert.throws(() => parseDesign(d), e => e instanceof Error && ["“G.数值”", "“T.增量”", "“A”", "引用成环"].every(v => e.message.includes(v)));
    d.inputs.A.value = 4;
    for (const bad of ["{field:height}", "{geo:G.construction.outlines.0.curve.nodes.0.p.0}", "{building:A.padElevation}", "{edge:E.length}", "{node:a.point.1}", "1 + @"])
        assert.throws(() => parseDesign({ ...d, inputs: { A: { value: bad } } }), /inputs.A.value/);
    b.function = { type: "flat", amount: 1 };
    for (const old of [{ var: "A", offset: 1 }, { field: "height", scale: .5 }]) {
        Object.assign(b.function, { amount: old });
        assert.throws(() => parseDesign(d), /geoNodes\[1\]\.function\.amount.*未知/);
    }
    b.function.amount = 1;
    a.function.value = 0;
    const invalid = structuredClone(d);
    const region = invalid.geoNodes[0].construction;
    assert(region.type === "outline");
    Object.assign(literalCurve(region.outlines[0]).nodes[0], { p: ["{input:A}", 0] });
    assert.throws(() => parseDesign(invalid), /construction.outlines\[0\].curve.nodes\[0\]/);
    assert.throws(() => parseDesign({ ...d, marks: [{ id: "A", label: "A", kind: "text", point: ["{input:A}", 0] }] }), /marks\[0\].point/);
    d.inputs.A.value = " 2.5 ";
    assert.equal(parseDesign(d).inputs.A.value, 2.5);
    b.id = "T.B"; d.inputs.c = { range: defaultInputRange("c"), value: "{geo:T.B.feather}" }; a.function.value = 0;
    assert.deepEqual(referenceUses(d, "geo", "T"), []);
    assert(referenceUses(d, "geo", "T.B").some(v => v.includes("inputs.c.value")));
});
test("Field parameters can feed numeric slots until their transitive value contains a field", () => {
    const d = syntheticDesign(), source = d.geoNodes[1];
    source.function = { type: "flat", amount: 4 };
    d.geoNodes.push(
        layer("A", rect(0, 0, 10, 10), { type: "flat", amount: "{geo:T.amount} * 2 + 1" }),
        layer("B", rect(3, 2, 8, 9), { type: "flat", amount: 2, feather: "{geo:A.amount}" })
    );
    const before = resolveDesign(d);
    assert.equal(expressionGraph(d).get("geo:B.feather"), 9);
    const changed = ["geoNodes", 1, "function", "amount"];
    const badReader = (error: unknown) => {
        assert(error instanceof DesignError);
        assert.deepEqual(error.problems, [{
            location: { kind: "geo", id: "B", index: 3, path: ["function", "feather"] },
            message: "“A.增量”现在是场，不能填进数类型参数"
        }]);
        return true;
    };
    const field = "{field:height} * 0.5";
    assert.throws(() => numberEdits(d, before).validate(changed, field), badReader);
    source.function.amount = field;
    assert.throws(() => resolveDesign(d), badReader);

    d.geoNodes.pop();
    const fn = resolveDesign(parseDesign(serializeDesign(d))).geoNodes[2].function;
    assert(fn.type === "flat" && typeof fn.amount === "string");
    const reading = evaluate(fn.amount, ref => {
        assert.equal(ref, "field:height");
        return fieldValue("height");
    });
    assert.equal(sampleValue(reading, () => 7), 8);
    d.geoNodes[2].function = { type: "flat", amount: "{geo:T.amount} * {field:height}" };
    assert.throws(() => resolveDesign(d), /场不能与场相乘/);
});

test("Text and scale mark parameters are references in both directions of the numeric graph", () => {
    const d: Design = syntheticDesign();
    d.marks.push({ id: "M", kind: "text", label: "标高", point: [0, 0], follow: "map", elevation: "{input:A} + 1" },
        { id: "S", kind: "scale", label: "长度", point: [0, 0], follow: "screen", length: "{mark:M.elevation} + 2" });
    d.geoNodes[1].function = { type: "flat", amount: "{mark:M.elevation}", feather: "{mark:S.length}" };
    const result = resolveDesign(parseDesign(serializeDesign(d))), fn = result.geoNodes[1].function;
    assert(fn.type === "flat");
    assert.equal(fn.amount, 8);
    assert.equal(fn.feather, 10);
    assert.deepEqual(removalUses(d, "mark", "M").map(use => use.kind === "parameter" && use.slot.key), ["geo:T.amount", "mark:S.length"]);
    d.inputs.A.value = "{mark:M.elevation}";
    assert.throws(() => resolveDesign(d), /引用成环/);
});

test("Rounded per-layer seeds and transitive scalar inputs invalidate only their readers", () => {
    const d: Design = newDesign(), base = d.geoNodes[0], cache = new TerrainCache();
    d.geoNodes.push(layer("N", base.construction, { type: "noise", amplitude: 1, scale: 7, seed: "{input:seed}" }));
    d.inputs.seed.value = 2.6;
    const a = cache.generate(d);
    d.inputs.seed.value = 3;
    assert.deepEqual(cache.generate(d).fields.height.values, a.fields.height.values); assert.deepEqual(cache.recomputed, []);
    d.inputs.seed.value = 4;
    assert.notDeepEqual(cache.generate(d).fields.height.values, a.fields.height.values); assert.deepEqual(cache.recomputed, ["N"]);
    delete d.geoNodes[1].function.seed;
    const zero = cache.generate(d).fields.height.values;
    d.geoNodes[1].function.seed = 0;
    assert.deepEqual(generateTerrain(d).fields.height.values, zero);
    d.geoNodes[1].function = { type: "flat", amount: "{geo:ground.value} + 1" };
    cache.generate(d); d.inputs.base.value = 6.25;
    const after = cache.generate(d);
    assert.deepEqual(after.fields.height.values, generateTerrain(d).fields.height.values); assert.deepEqual(cache.recomputed, [base.id, "N"]);
});

test("Omitted mountain slopes can be referenced and are checked at their authored slot", () => {
    const d: Design = syntheticDesign(), mountain = { type: "mountain", peaks: [], ridges: [{
        curve: openCurve([{ p: [0, 0], h: 2 }, { p: [5, 0], h: 2 }])
    }] };
    Object.assign(d.geoNodes[1], { function: mountain });
    d.inputs.c = { range: defaultInputRange("c"), value: "{geo:T.floor} + {geo:T.seed} + {geo:T.ridges.0.slope}" };
    assert.equal(resolveDesign(parseDesign(d)).inputs.c.value, -999.25);
    Object.assign(mountain.ridges[0], { slope: 0 });
    assert.throws(() => parseDesign(d), /ridges\[0\].slope/);
});

test("Geometry inputs expose concrete defaults without changing authored height stops", () => {
    const d: Design = syntheticDesign(), n = d.geoNodes[1];
    n.function = { type: "slope", kind: "path", ease: true, line: { curve: openCurve([
        { p: [0, 0], h: 2 }, { p: [2, 0] }, { p: [8, 0], h: 10 }
    ]) } };
    d.inputs.b = { range: defaultInputRange("b"), value: "{geo:T.line.curve.nodes.1.h} + {geo:T.line.curve.nodes.0.h}" };
    const g = expressionGraph(d), resolved = resolveDesign(parseDesign(d)), t = resolved.geoNodes[1].function;
    assert(t.type === "slope" && t.kind === "path");
    assert.equal(g.get("geo:T.line.curve.nodes.1.h"), 3.25);
    assert.equal(resolved.inputs.b.value, 5.25);
    assert.equal(t.line.nodes[1].h, undefined);
    const unchanged = generateTerrain(d).fields.height.values;
    const noMidpoint = structuredClone(d);
    const slope = noMidpoint.geoNodes[1].function;
    assert(slope.type === "slope" && slope.kind === "path");
    noMidpoint.inputs.b.value = resolved.inputs.b.value;
    literalCurve(slope.line).nodes.splice(1, 1);
    assert.deepEqual(generateTerrain(noMidpoint).fields.height.values, unchanged);
    assert.equal(literalCurve(n.function.line).nodes[1].h, undefined, "The source retains its two authored height stops");
    const ridge = { curve: literalCurve(n.function.line), slope: 2 };
    Object.assign(n, { function: { type: "mountain", ridges: [ridge], peaks: [] } });
    d.inputs.b.value = "{geo:T.ridges.0.curve.nodes.1.h}";
    const parsed = parseDesign(d), m = resolveDesign(parsed).geoNodes[1].function;
    assert(m.type === "mountain"); assert.equal(m.floor, -1000);
    assert.equal(m.ridges[0].slope, 2);
    assert.equal(resolveDesign(parsed).inputs.b.value, 3.25);
});