import { test } from "node:test";
import { functionTable, parameterStep, parameterUnit } from "../src/core/design/functionTable.ts";
import assert from "node:assert/strict";
import { adjustInputStep, adjustNumber, NumberDrag, numericText, repeatButton } from "../src/app/state/numbers.ts";
import { displayReading, displayValue } from "../src/core/design/display.ts";
import { Project } from "../src/core/project.ts";
import { ProjectMap } from "../src/render/map.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { History } from "../src/core/edit/history.ts";
import { syntheticDesign, layer, rect } from "./scenarios.ts";

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
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    t.after(() => {
        if (oldFrame) globalThis.requestAnimationFrame = oldFrame;
        else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
        if (oldCancel) globalThis.cancelAnimationFrame = oldCancel;
        else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    });
    t.mock.method(editor, "reconcileProject", () => {}); t.mock.method(editor.files, "remember", () => {});
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let calls = 0, preview = design;
    const stop = repeatButton(() => {
        calls++;
        preview = structuredClone(design); preview.inputs.A.value += calls;
        editor.previewNumber(preview);
    });
    assert.equal(calls, 1); t.mock.timers.tick(399); assert.equal(calls, 1);
    t.mock.timers.tick(1); assert.equal(calls, 2); t.mock.timers.tick(80); assert.equal(calls, 3);
    stop(); t.mock.timers.tick(300); assert.equal(calls, 3); assert.equal(editor.history.index, 0);
    editor.commitNumber(preview);
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