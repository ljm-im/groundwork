import { test } from "node:test";
import { functionTable, parameterStep, parameterUnit } from "../src/core/design/functionTable.ts";
import assert from "node:assert/strict";
import { adjustInputStep, adjustNumber, NumberDrag, numberPreviewFactor, numericText, repeatButton, validateZoom } from "../src/app/state/numbers.ts";
import { copyAt, writeAt, type Address } from "../src/core/design/address.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { numberEdits } from "../src/core/design/numberEdit.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { type Expression } from "../src/core/design/v5.ts";
import { designErrorText } from "../src/app/state/designMessages.ts";
import { displayReading, displayValue } from "../src/core/design/display.ts";
import { Project } from "../src/core/project.ts";
import { ProjectMap } from "../src/render/map.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { History } from "../src/core/edit/history.ts";
import { syntheticDesign, layer, rect, openCurve } from "./scenarios.ts";

test("Number previews use the smallest factor within the cell budget", () => {
    assert.equal(numberPreviewFactor(512, 512), 1);
    assert.equal(numberPreviewFactor(1, 262145), 2);
    assert.equal(numberPreviewFactor(513, 2048), 3);
    assert.equal(numberPreviewFactor(1, 2 ** 21 + 1), 9);
});

test("Number steps adjust the final signed literal, avoid zero divisors and preserve precision", () => {
    assert.equal(adjustNumber("{input:a} + 0.5", 1, .1), "{input:a} + 0.6");
    assert.equal(adjustNumber("{field:f} * 0.75 + 0.3", -1, .1), "{field:f} * 0.75 + 0.2");
    assert.equal(adjustNumber("{field:f} * 0.75", 1, .1), "{field:f} * 0.85");
    assert.equal(adjustNumber("{input:a} - 0.5", 1, .1), "{input:a} - 0.4");
    assert.equal(adjustNumber("{input:a} - 0.5", 6, .1), "{input:a} + 0.1");
    assert.equal(adjustNumber("{input:a} / -0.1", 1, .1), "{input:a} / 0.1");
    assert.equal(adjustNumber("{input:a} / -0.2", 3, .1), "{input:a} / 0.2");
    assert.equal(adjustNumber("{input:a} / (0.1)", -1, .1), "{input:a} / (-0.1)");
    assert.equal(adjustNumber("{geo:B.ridges.0.widths.1}", -1, .1), "{geo:B.ridges.0.widths.1} - 0.1");
    assert.equal(adjustNumber(2, 3, .5, [0, 2, .5]), 2);
    assert.equal(adjustNumber("{input:a} + 2", 3, .5, [0, 2, .5]), "{input:a} + 3.5");
    assert.equal(displayValue(1.2345, .1), "1.2345"); assert.equal(displayValue(2.6, 1), "2.6");
    assert.equal(adjustNumber(1.2345, 1, .1), 1.3345);
    assert.equal(numericText("1.2345", true), 1.2345);
    for (const expr of ["1 + 2", "{input:a}", "NaN", ""]) assert.throws(() => numericText(expr, true));
    assert.equal(numericText("3 × (2 − 1)", false), "3 * (2 - 1)");
});
test("Displayed values keep authored precision, keyboard minus, and unit spacing", () => {
    assert.equal(displayValue(55.00000000000001, .1, "m"), "55.0 m");
    assert.equal(displayValue(-2.6, 1), "-2.6");
    assert.equal(displayValue(-1.2345, .25), "-1.2345");
    assert.equal(displayValue(2.5, .25), "2.50");
    assert.equal(displayValue(25, 1, "%"), "25%");
    assert.equal(displayValue(-.001, .1, "m"), "-0.001 m");
    assert.equal(displayValue(1.4e-7, 1e-7), "0.0000001");
    assert.equal(displayValue(NaN, .1, "m"), "–");
    assert.equal(displayReading(4.5364, .1, "m"), "4.5 m");
    assert.equal(displayReading(.4964, .01), "0.50");
    assert.equal(displayReading(-.0004, .01), "0.00");
    assert.equal(displayReading(undefined, .1, "m"), "–");
    assert.equal(displayReading(1, Number.MIN_VALUE), "1");
});
test("Pointer lock transitions discard the cursor jump without losing subsequent steps", () => {
    const drag = new NumberDrag();
    let value = adjustNumber(2.3, drag.move(4, 0, false, false), .1);
    for (const jump of [-544, 544]) {
        const before = value;
        drag.lockChanged();
        value = adjustNumber(value, drag.move(jump, 0, false, false), .1);
        assert.equal(value, before);
        const steps = drag.move(8, 0, false, false);
        assert.equal(steps, 2);
        value = adjustNumber(value, steps, .1);
    }
    assert.equal(value, 2.8);
});
test("Offsetting an expression without numeric literals removes the added term at zero", () => {
    const formula = "({input:A} - {field:F})";
    for (const steps of [-3, 1, 3]) {
        const adjusted = adjustNumber(formula, steps, .1);
        assert.notEqual(adjusted, formula);
        assert.equal(adjustNumber(adjusted, -steps, .1), formula);
    }
    assert.equal(adjustNumber("{input:A} * 2 + 1", -1, 1), "{input:A} * 2 + 0");
});

test("Large drag events do not accumulate before, during or after pointer lock", () => {
    const drag = new NumberDrag();
    let value = 2.3;
    function move(dx: number, dy = 0) {
        const steps = drag.move(dx, dy, false, false);
        value = adjustNumber(value, steps, .1) as number;
        return steps;
    }
    assert.equal(move(-544), 0);
    assert.equal(value, 2.3);
    assert.equal(drag.moved, false);
    assert.equal(move(8), 2);
    drag.lockChanged();
    assert.equal(move(3), 0);
    assert.equal(move(544), 0);
    assert.equal(value, 2.5);
    assert.equal(move(8), 2);
    drag.lockChanged();
    assert.equal(move(3), 0);
    assert.equal(move(-300), 0);
    assert.equal(move(8, -300), 0);
    assert.equal(value, 2.7);
    assert.equal(move(8), 2);
    for (let i = 0; i < 20; i++) assert.equal(move(60), 15);
    assert.equal(value, 32.9);
});

test("Dragging and repeating preview several values but release records one history entry", async t => {
    const jitter = new NumberDrag();
    for (const dx of [2, -2, 2, -2]) assert.equal(jitter.move(dx, 0, false, false), 0);
    assert(!jitter.moved);
    const drag = new NumberDrag();
    assert.equal(drag.move(3, 0, false, false), 0); assert(!drag.moved);
    assert.equal(drag.move(1, 0, false, false), 1); assert(drag.moved);
    assert.equal(drag.move(-40, 0, true, false), -1);
    assert.equal(drag.move(4, 0, false, true), 10);
    const design = syntheticDesign(), editorModule = await import("../configs/register-svelte.ts").then(() => import("../src/app/state/session.svelte.ts"));
    const editor = new editorModule.Editor();
    editor.project = new Project(design); editor.history = new History(design);
    const oldFrame = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
    let previewFrame: FrameRequestCallback | undefined;
    globalThis.requestAnimationFrame = frame => {
        previewFrame = frame;
        return 1;
    };
    globalThis.cancelAnimationFrame = () => {};
    t.after(() => {
        if (oldFrame) globalThis.requestAnimationFrame = oldFrame;
        else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
        if (oldCancel) globalThis.cancelAnimationFrame = oldCancel;
        else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    });
    t.mock.method(editor, "reconcileProject", () => {}); t.mock.method(editor.files, "remember", () => {});
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const address: Address = ["inputs", "A", "value"];
    let calls = 0, value = design.inputs.A.value;
    const stop = repeatButton(() => {
        value = design.inputs.A.value + ++calls;
        editor.previewNumber(editor.numberEdits.validate(address, value));
    });
    assert.equal(calls, 1); t.mock.timers.tick(399); assert.equal(calls, 1);
    t.mock.timers.tick(1); assert.equal(calls, 2); t.mock.timers.tick(80); assert.equal(calls, 3);
    stop(); t.mock.timers.tick(300); assert.equal(calls, 3); assert.equal(editor.history.index, 0);
    previewFrame!(0);
    assert.equal(editor.project.design.inputs.A.value, design.inputs.A.value);
    const expected = new Project(copyAt(design, address, value));
    assert.deepEqual(editor.mapProject.terrain.fields.height, expected.terrain.fields.height);
    editor.clearNumberPreview();
    assert.equal(editor.mapProject.terrain, editor.project.terrain);
    assert.equal(editor.history.index, 0);
    editor.commitNumber(address, value);
    assert.equal(editor.history.index, 1); assert.equal(editor.history.step(false)!.inputs.A.value, design.inputs.A.value);
});
test("Camera framing survives empty and changing canvases and the viewport hides each row above it", () => {
    const d = syntheticDesign();
    const m = new Project(d);
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width: 800, height: 640, cameraChanged() {} });
    map.fit(m.terrain, false); map.zoomAt(1.7); map.center = [2, -3];
    const camera = () => [...map.center, map.scale, map.referenceScale], original = camera();
    d.geoNodes[0].disabled = true;
    const update = () => {
        const next = new Project(d); map.frame(next.terrain); assert.deepEqual(camera(), original);
        return next.terrain;
    };
    update();
    d.geoNodes.push(layer("Q", rect(80, 30, 97, 41), { type: "flat", amount: 12 })); update();
    d.geoNodes.splice(1, 1); update();
    d.grid.step = 2; map.fit(update(), false);
    assert.equal(map.zoomFactor(), 1); assert.deepEqual(map.center, [24.5, 0]);
    delete d.geoNodes[0].disabled;
    d.geoNodes.push(layer("C", rect(5, 5, 12, 12), { type: "flat", amount: 15 }));
    const project = new Project(d), fromTop = d.geoNodes.toReversed();
    for (const [k, n] of fromTop.entries()) {
        const view = project.viewBelow(n.id), expected = generateTerrain({ ...d, geoNodes: fromTop.slice(k + 1).reverse() });
        assert.deepEqual(view.terrain.fields.height.defined, expected.fields.height.defined); assert.deepEqual(view.terrain.fields.height.values, expected.fields.height.values);
        assert.deepEqual(view.design.geoNodes.map(v => v.id), fromTop.slice(k + 1).reverse().map(v => v.id));
    }
    assert(!project.viewBelow(d.geoNodes[0].id).terrain.fields.height.defined.some(Boolean));
});

test("Every function parameter defines its display metadata and keeps its numeric default", () => {
    for (const [type, definition] of Object.entries(functionTable)) for (const p of definition.parameters) {
        const key = type + "." + p.key.join(".");
        const step = parameterStep(p);
        assert(p.label && p.key.length && Number.isFinite(step) && step > 0, key);
        assert.equal(p.step === "field", p.unit === "field" || p.unit === "field/m", key);
        assert.equal(typeof p.unit, "string", key);
        assert.equal(typeof p.advanced, "boolean", key);
        assert(["number", "field", "geometry", "seed"].includes(p.type), key);
        assert.notEqual(p.default, undefined, key);
        if (typeof p.default === "number") assert.equal(Number(displayValue(p.default, step)), p.default, key);
    }
    const rate = functionTable.slope.parameters.find(p => p.key[0] === "rate")!;
    assert.equal(parameterUnit(rate, "kg"), "kg/m");
    assert.equal(parameterUnit(rate), "/m");
    assert.equal(parameterStep(rate), .01);
    assert.equal(parameterStep(rate, { label: "A", precision: .02 }), .002);
    assert.equal(parameterStep(rate, { label: "A", precision: .7 }), .07);
    assert.equal(parameterStep(functionTable.flat.parameters[0], { label: "A", precision: .01 }), .01);
    for (const v of [.06, .002, .333]) assert.equal(displayValue(v, .1), String(v));
    assert.equal(displayValue("{input:A} * 0.333", .1), "{input:A} × 0.333");
});

test("Input steps advance among positive powers of ten times one, two, or five", () => {
    assert.deepEqual([.05, .1, .2, .5, 1].map(value => adjustInputStep(value, -1)), [.02, .05, .1, .2, .5]);
    assert.equal(adjustInputStep(.13, 1), .2);
    assert.equal(adjustInputStep(.13, -1), .1);
    assert.equal(adjustInputStep(.1, 3), 1);
    assert.equal(adjustInputStep(Number.MIN_VALUE, -1), Number.MIN_VALUE);
});

test("Numeric drafts and committed edits agree on resolution and error wording", () => {
    const source = syntheticDesign();
    source.inputs.B = { value: 2, range: [-1, 6, 1] };
    source.inputs.C = { value: 4, range: [-1, 6, 1] };
    source.fields.F = { label: "F" };
    source.geoNodes.push(layer("S", { type: "strip", of: ["T"], widths: [0, 1] }, { type: "batter", grade: "{input:B}" }));
    source.geoNodes.push(layer("U", rect(-1, -1, 2, 2), {
        type: "slope", kind: "path", ease: true, line: openCurve<Expression>([{ p: [0, 0], h: 1 }, { p: [0, 1] }, { p: [0, 2] }, { p: [0, 3], h: "{input:C}" }])
    }));
    source.geoNodes.push(layer("V", rect(0, 0, 4, 4), { type: "flat", amount: "6 / {input:C}" }));
    source.marks.push({ id: "M", kind: "scale", label: "M", point: [0, 0], follow: "map", length: "{input:B}" });
    const design = parseDesign(source), original = resolveDesign(design), edits = numberEdits(design, original);
    const a: Address = ["inputs", "A", "value"], b: Address = ["inputs", "B", "value"], c: Address = ["inputs", "C", "value"];
    const path = (i: number): Address => ["geoNodes", 3, "function", "line", "nodes", i, "h"];
    const cases: [Address, Expression, string?][] = [
        [a, "20", undefined], [b, ".5 * (2 + 3)", undefined], [a, "{input:missing}", "找不到自定义输入“missing”"],
        [a, "{input:A}", "引用成环"], [a, "{geo:T.amount}", "是场类型参数，不能引用"], [a, "{field:F}", "这里不能用场"],
        [a, "1 / 0", "除数不能为 0"], [c, 0, "除数不能为 0"], [b, -1, "无效"],
        [["geoNodes", 2, "construction", "widths", 1], 0, "无效"], [["inputs", "B", "range", 2], 0, "无效"],
        [["fields", "F", "precision"], 0, "必须是正的有限数"], [["grid", "step"], -1, "无效"], [["grid", "step"], .5, undefined],
        [["marks", 0, "length"], -2, "无效"], [path(1), 6, undefined], [path(1), "{geo:U.line.nodes.2.h}", "引用成环"]
    ];
    const outcome = <T>(work: () => T) => {
        try {
            return { result: work(), message: "", detail: "" };
        }
        catch (error) {
            return { message: designErrorText(error, design, "message"), detail: (error as Error).message };
        }
    };
    for (const [address, value, expected] of cases) {
        const draft = outcome(() => edits.validate(address, value));
        const commit = outcome(() => {
            const next = structuredClone(design);
            writeAt(next, address, value);
            return resolveDesign(parseDesign(next, true));
        });
        const label = JSON.stringify([address, value]);
        assert.equal(draft.message, commit.message, label);
        assert.equal(draft.detail, commit.detail, label);
        if (expected) assert(draft.message.includes(expected), label);
        else {
            assert(draft.result && commit.result, label);
            const projected = draft.result.resolved.reduce((d, patch) => copyAt(d, patch.address, patch.value), original);
            assert.deepEqual(projected, commit.result, label);
        }
    }
    assert.deepEqual(resolveDesign(design), original);
});

test("Zoom accepts a literal percent in the camera's supported range", () => {
    for (const text of ["250", "250%", " 250 % "]) {
        const value = numericText(text, true, "%");
        assert.equal(value, 250);
        validateZoom(Number(value));
    }
    for (const bad of ["1 + 2", "50%%", "NaN", "Infinity", ""])
        assert.throws(() => numericText(bad, true, "%"), /一个数/);
    for (const value of [5, 3000]) assert.doesNotThrow(() => validateZoom(value));
    for (const value of [4, 3001, Infinity]) assert.throws(() => validateZoom(value), /5% 到 3000%/);
});