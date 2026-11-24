import { test } from "node:test";
import assert from "node:assert/strict";
import { undeclaredDesignField } from "../configs/fixtureSchema.ts";
import { designFixtures, fixtureOptions } from "../configs/read-fixture.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { type Design } from "../src/core/design/v5.ts";
import { newDesign } from "../src/core/design/newDesign.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { removeDeclaration } from "../src/core/edit/geoNodes.ts";
import { DesignError } from "../src/core/design/problems.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { syntheticDesign, rect, layer, polygon } from "./scenarios.ts";

test("Version five opens atomically and older formats have a common version error", () => {
    const d = syntheticDesign(), bytes = serializeDesign(d);
    assert.deepEqual(parseDesign(bytes), d);
    for (const version of [1, 2, 3, 4]) assert.throws(() => parseDesign({ version }), { message: "不支持的版本" });
    assert.throws(() => parseDesign({ version: 6 }), { message: "不支持的版本" });
    assert.throws(() => parseDesign({ ...d, grid: null }), /grid.step/);
});

test("Every installed top-level design matches the version five declaration", fixtureOptions("round14-coast.json", "round14-land.json"), async () => {
    for (const f of await designFixtures()) assert.equal(undeclaredDesignField(parseDesign(f.text), f.name), undefined);
    const d = syntheticDesign();
    Object.assign(d.geoNodes[0].construction, { extra: 3 });
    assert.match(undeclaredDesignField(d, "input")!, /input\.geoNodes\[0\]\.construction\.extra/);
});

test("Geo references report their location and reject invalid field writers", () => {
    const d = syntheticDesign(), p = rect(0, 0, 4, 4), n = layer("N", p, { type: "flat", amount: 1 });
    d.geoNodes.push(n);
    n.field = "missing";
    assert.throws(() => parseDesign(d), /geoNodes\[2\].*field.*找不到/);
    n.field = "f"; d.fields.f = { label: "F" };
    n.function = { type: "mountain", ridges: [], peaks: [] };
    assert.throws(() => parseDesign(d), /geoNodes\[2\].*field/);
    n.function = { type: "flat", feather: 0, amount: "{input:absent}" };
    assert.throws(() => parseDesign(d), /amount.*找不到自定义输入/);
    n.function = { type: "flat", amount: 1 }; n.construction = { type: "strip", of: ["N"], widths: [1, 1] };
    assert.throws(() => parseDesign(d), /of.*找不到下方/);
    n.construction = p; p.paths.push(structuredClone(p.paths[0]));
    assert.throws(() => parseDesign(d), /nodes\[0\].id 重复/);
    p.paths.pop(); n.id = d.geoNodes[0].id;
    assert.throws(() => parseDesign(d), /geoNodes\[2\].id/);
});

test("Noise validates its inputs and rejects the retired inline noise parameter", () => {
    const d = syntheticDesign(), node = d.geoNodes[1];
    const fn = { type: "noise" as const, amplitude: 2, scale: 8 };
    for (const [key, value] of [["scale", 0], ["scale", Infinity], ["octaves", 0], ["octaves", 1.5], ["feather", -1],
        ["amplitude", "{field:missing}"]] as const) {
        node.function = { ...fn, [key]: value };
        assert.throws(() => parseDesign(d), error => error instanceof Error && error.message.includes("geoNodes[1].function." + key));
    }
    for (const surface of [{ type: "ground", value: 1 }, { type: "flat", amount: 1 },
        { type: "slope", kind: "radial", value: 1, center: [0, 0], radius: 2, rate: .1 },
        { type: "slope", kind: "path", line: { points: [{ p: [0, 0], h: 1 }, { p: [2, 0], h: 2 }] } }]) {
        Object.assign(node, { function: { ...surface, noise: { amplitude: 1 } } });
        assert.throws(() => parseDesign(d), /geoNodes\[1\]\.function\.noise.*未知字段/);
    }
});

test("Removing a referenced custom input lists every layer and mark location", () => {
    const d = syntheticDesign();
    delete d.inputs.A;
    d.marks = [{ id: "B", label: "B", kind: "text", point: [1, 1], follow: "map", elevation: "{input:A}", showElevation: true }];
    d.geoNodes.push(layer("C", rect(2, 2, 5, 5), { type: "flat", amount: "{input:A}", feather: 0 }));
    assert.throws(() => parseDesign(d), error => error instanceof Error &&
        ["geoNodes[1].function.amount", "geoNodes[2].function.amount", "marks[0].elevation"].every(p => error.message.includes(p)));
    assert.throws(() => parseDesign({ ...syntheticDesign(), zones: [] }), /zones.*v5/);
});

test("Supported owners preserve optional prompts, whitespace and empty prompt omission", () => {
    const d = syntheticDesign();
    d.sections.push({ id: "S", label: "S", points: [[0, 0], [1, 1]] });
    const before = serializeDesign(d), owners = [d, d.geoNodes[0], d.sections[0]];
    for (const owner of owners) {
        Object.assign(owner, { prompt: null });
        assert.throws(() => parseDesign(d), /描述必须是字符串/);
        owner.prompt = "  A\n B ";
    }
    assert.deepEqual(parseDesign(serializeDesign(d)), d);
    for (const owner of owners) owner.prompt = "";
    assert.equal(serializeDesign(parseDesign(d)), before);
});

test("Retired input, label and increment spellings fail at their source", () => {
    const d = syntheticDesign();
    d.sections.push({ id: "S", label: "S", points: [[0, 0], [1, 1]] });
    d.marks.push({ id: "M", kind: "scale", label: "M", point: [1, 1], follow: "screen" });
    assert.throws(() => parseDesign({ ...d, variables: {} }), /variables.*移除/);
    assert.throws(() => parseDesign({ ...d, labels: [] }), /labels.*移除/);
    assert.throws(() => parseDesign({ ...d, inputs: { A: { value: "{var:A}" } } }), /inputs.A.value.*无法识别/);
    assert.throws(() => parseDesign({ ...d, geoNodes: [d.geoNodes[0], { ...d.geoNodes[1], function: { type: "flat", value: 2 } }] }), /function.value.*移除/);
    for (const key of ["geoNodes", "sections", "marks"] as const) {
        const invalid = structuredClone(d);
        Object.assign(invalid[key][0], { name: "A" });
        assert.throws(() => parseDesign(invalid), new RegExp(key + "\\[0\\]\\.name.*移除"));
    }

    for (const key of ["buildings", "nodes", "edges", "roadClasses", "routing", "vegetation"])
        assert.throws(() => parseDesign({ ...d, [key]: [] }), new RegExp(key + ".*移除"));
    for (const key of ["building", "offset", "spot", "minZoom", "titleOnly"])
        assert.throws(() => parseDesign({ ...d, marks: [{ id: "M", label: "M", kind: "text", point: [1, 2], [key]: null }] }),
            new RegExp("marks\\[0\\]\\." + key + ".*移除"));
    for (const kind of ["building", "edge", "node"])
        assert.throws(() => parseDesign({ ...d, inputs: { A: { value: "{" + kind + ":A.value}" } } }), /inputs.A.value.*未知的变量/);
});

test("Labels omit their defaults and marks round-trip with expressions and anchors", () => {
    const d: Design = syntheticDesign();
    d.sections.push({ id: "S", label: "S", points: [[0, 0], [1, 1]] });
    d.marks.push({ id: "M", kind: "scale", label: "M", point: [1, 1], follow: "screen", length: "{input:A} + 3" },
        { id: "T", kind: "text", label: "T", point: [3, 2], follow: "map", elevation: "{geo:G.value}", showElevation: true });
    const others = [...d.sections, ...d.marks];
    // Unset and explicit defaults produce identical bytes for every kind.
    const defaults = serializeDesign(d);
    d.geoNodes.forEach(n => n.showLabel = false);
    others.forEach(item => item.showLabel = true);
    assert.equal(serializeDesign(d), defaults);
    d.geoNodes[0].showLabel = true;
    others.forEach(item => item.showLabel = false);
    const bytes = serializeDesign(d), saved = parseDesign(bytes), numeric = resolveDesign(saved);
    assert.equal(serializeDesign(parseDesign(saved)), bytes);
    assert.equal(saved.geoNodes[0].showLabel, true);
    assert.equal(saved.geoNodes[1].showLabel, undefined);
    assert([...saved.sections, ...saved.marks].every(item => item.showLabel === false));
    const [scale, text] = numeric.marks;
    assert(scale.kind === "scale" && text.kind === "text");
    assert.equal(scale.length, 10);
    assert.equal(text.elevation, 4);
    assert.deepEqual(text.point, [3, 2]);
    assert.deepEqual(newDesign([48, 72]).marks, [{ id: "mark-1", kind: "scale", label: "比例尺", point: [48, 72], follow: "screen", length: 10 }]);
    assert.equal(scale.follow, "screen"); assert.equal(text.follow, "map");
    assert(!bytes.includes("\"follow\""));
    saved.marks[0].follow = "map"; saved.marks[1].follow = "screen";
    const switched = serializeDesign(saved);
    assert.deepEqual(parseDesign(switched).marks, saved.marks);
    assert.equal(serializeDesign(parseDesign(switched)), switched);
    assert.throws(() => parseDesign({ ...saved, marks: [{ ...saved.marks[0], length: "0 - 1" }] }), /marks\[0\].length/);
    assert.throws(() => parseDesign({ ...saved, marks: [{ ...saved.marks[1], showLabel: "false" }] }), /marks\[0\].showLabel/);
});

test("Built-in seed, ranges and harbors materialize on read and omit their defaults on write", () => {
    const d = syntheticDesign(), raw = JSON.parse(serializeDesign(d));
    delete raw.inputs.seed;
    delete raw.inputs.A.range;
    raw.geoNodes.push({ ...layer("C", rect(0, 0, 10, 8), { type: "flat", amount: 1 }),
        function: { type: "coast", shore: polygon([[0, 0], [1, 0], [1, 1], [0, 1]]), roughness: 4, seed: "{input:seed}" } });
    for (const node of raw.geoNodes.at(-1).function.shore.nodes) node.id = "s" + node.id;
    const hydrated = parseDesign(raw), f = hydrated.geoNodes.at(-1)!.function;
    assert.deepEqual(hydrated.inputs.seed, { label: "种子", value: 1, range: [-10000, 10000, 1] });
    assert.deepEqual(hydrated.inputs.A.range, [-10000, 10000, .1]);
    assert(f.type === "coast");
    assert.deepEqual(f.harbor, { center: [5, 4], radius: 0, span: 3 });
    const bytes = serializeDesign(hydrated);
    assert.doesNotMatch(bytes, /"(?:range|harbor)"/);
    assert.equal(serializeDesign(parseDesign(bytes)), bytes);
    assert.deepEqual(parseDesign(bytes), hydrated);
    const disabled = generateTerrain(hydrated).fields.height.values;
    f.harbor.center = [2, 2]; f.harbor.span = 20;
    assert.deepEqual(generateTerrain(hydrated).fields.height.values, disabled);
    f.harbor.radius = 5;
    assert.match(serializeDesign(hydrated), /"harbor"/);
    Object.assign(f.harbor, { radius: "{input:A} - 7" });
    assert.match(serializeDesign(hydrated), /"harbor"/);
    assert.throws(() => removeDeclaration(hydrated, "input", "seed"), /内置输入/);
    assert.throws(() => parseDesign({ ...raw, inputs: { ...raw.inputs, seed: { label: "A", value: 1 } } }), /inputs.seed.label/);
    assert.throws(() => parseDesign({ ...raw, inputs: { ...raw.inputs, seed: { value: 1 } } }), /inputs.seed.label/);
    assert.throws(() => parseDesign({ ...raw, inputs: { A: { range: null, value: 1 } } }), /inputs.A/);
});

test("Section marks accept old empty arrays and reject authored marks", () => {
    const d = newDesign();
    const s = { id: "A", label: "A", points: [[0, 0], [1, 1]] as [[number, number], [number, number]], marks: [] as unknown[] };
    d.sections.push(s);
    assert(!Object.hasOwn(parseDesign(d).sections[0], "marks"));
    s.marks.push([.5, "B"]);
    assert.throws(() => parseDesign(d), /sections\[0\].marks.*移除/);
});

test("Built-in height is hydrated and reserved declaration metadata is protected", () => {
    const d = syntheticDesign();
    const input = structuredClone(d);
    delete input.fields.height; Reflect.deleteProperty(input.geoNodes[0], "field");
    const parsed = parseDesign(input);
    assert.deepEqual(parsed.fields.height, { label: "高度", unit: "m" });
    assert.equal(parsed.geoNodes[0].field, "height");
    for (const [key, value] of [["label", "A"], ["unit", "s"], ["unit", undefined], ["default", 0]] as const) {
        const fields = { height: { label: "高度", unit: "m", [key]: value } };
        assert.throws(() => parseDesign({ ...d, fields }), new RegExp("fields.height." + key));
    }
    assert.throws(() => removeDeclaration(parsed, "field", "height"), /内置场/);
    assert.throws(() => parseDesign({ ...d, marks: [{ id: "A", label: "A", kind: "text", point: [0, 0], follow: "ground" }] }),
        /marks\[0\].follow/);
    assert.throws(() => parseDesign({ ...d, geoNodes: [d.geoNodes[0], { ...d.geoNodes[1], function: { type: "add", amount: 1 } }] }),
        /geoNodes\[1\].function.type/);
    d.geoNodes[1].function = { type: "flat", amount: 1, feather: -1 };
    assert.throws(() => parseDesign(d), error => error instanceof DesignError &&
        error.problems.some(p => p.location?.kind === "geo" && p.location.id === "T" && p.location.path.join(".") === "function.feather"));
});