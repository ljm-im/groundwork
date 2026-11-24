import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustNumber, displayNumber, NumberDrag, numericText, repeatButton } from "../src/app/state/numbers.ts";
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
    assert.equal(displayNumber(1.2345, .1), "1.2"); assert.equal(displayNumber(2.6, 1), "3");
    assert.equal(adjustNumber(1.2345, 1, .1), 1.3345);
    assert.equal(numericText("1.2345", true), 1.2345);
    for (const expr of ["1 + 2", "{input:a}", "NaN", ""]) assert.throws(() => numericText(expr, true));
    assert.equal(numericText("3 × (2 − 1)", false), "3 * (2 - 1)");
});
test("Read-only values use the input step, keyboard minus, and unit spacing", () => {
    assert.equal(displayNumber(55.00000000000001, .1, "m"), "55.0 m");
    assert.equal(displayNumber(-2.6, 1), "-3");
    assert.equal(displayNumber(-1.2345, .25), "-1.23");
    assert.equal(displayNumber(2.5, .25), "2.50");
    assert.equal(displayNumber(25, 1, "%"), "25%");
    assert.equal(displayNumber(-.001, .1, "m"), "0.0 m");
    assert.equal(displayNumber(1.4e-7, 1e-7), "0.0000001");
    assert.equal(displayNumber(NaN, .1, "m"), "—");
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
    t.mock.method(editor, "schedule", () => {}); t.mock.method(editor, "refresh", () => {}); t.mock.method(editor.files, "remember", () => {});
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let calls = 0;
    const stop = repeatButton(() => {
        calls++;
        const preview = structuredClone(design); preview.inputs.A.value += calls;
        editor.previewNumber(preview);
    });
    assert.equal(calls, 1); t.mock.timers.tick(399); assert.equal(calls, 1);
    t.mock.timers.tick(1); assert.equal(calls, 2); t.mock.timers.tick(80); assert.equal(calls, 3);
    stop(); t.mock.timers.tick(300); assert.equal(calls, 3); assert.equal(editor.history.index, 0);
    editor.commitNumber(editor.project.design);
    assert.equal(editor.history.index, 1); assert.equal(editor.history.step(false)!.inputs.A.value, design.inputs.A.value);
});
test("Camera framing survives empty and changing canvases and the viewport hides each row above it", () => {
    const d = syntheticDesign();
    const m = new Project(d);
    const map = Object.assign(Object.create(ProjectMap.prototype) as ProjectMap, { width: 800, height: 640, draw() {}, project: m.view(), frameTerrain: m.terrain });
    map.fit(false); map.zoomAt(1.7); map.center = [2, -3];
    const camera = () => [...map.center, map.scale, map.referenceScale], original = camera();
    d.geoNodes[0].disabled = true;
    const update = () => {
        const next = new Project(d); map.project = next.view(); map.frame(next.terrain); assert.deepEqual(camera(), original);
    };
    update();
    d.geoNodes.push(layer("Q", rect(80, 30, 97, 41), { type: "flat", amount: 12 })); update();
    d.geoNodes.splice(1, 1); update();
    d.grid.step = 2; update(); map.fit(false);
    assert.equal(map.zoomFactor(), 1); assert.deepEqual(map.center, [24.5, 0]);
    delete d.geoNodes[0].disabled;
    d.geoNodes.push(layer("C", rect(5, 5, 12, 12), { type: "flat", amount: 15 }));
    const project = new Project(d), fromTop = d.geoNodes.toReversed();
    for (const [k, n] of fromTop.entries()) {
        const view = project.viewBelow(n.id), expected = generateTerrain({ ...d, geoNodes: fromTop.slice(k + 1).reverse() });
        assert.deepEqual(view.terrain.defined, expected.defined); assert.deepEqual(view.terrain.heights, expected.heights);
        assert.deepEqual(view.design.geoNodes.map(v => v.id), fromTop.slice(k + 1).reverse().map(v => v.id));
    }
    assert(!project.viewBelow(d.geoNodes[0].id).terrain.defined.some(Boolean));
});