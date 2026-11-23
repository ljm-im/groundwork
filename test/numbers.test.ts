import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustNumber, displayNumber, NumberDrag, numericText, repeatButton } from "../src/app/state/numbers.ts";
import { Island } from "../src/core/island.ts";
import { IslandMap } from "../src/render/map.ts";
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
    editor.island = new Island(design); editor.history = new History(design);
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
    editor.commitNumber(editor.island.design);
    assert.equal(editor.history.index, 1); assert.equal(editor.history.step(false)!.inputs.A.value, design.inputs.A.value);
});
test("Camera framing survives empty and changing canvases and the viewport hides each row above it", () => {
    const d = syntheticDesign(); d.buildings = []; d.nodes = []; d.edges = [];
    const m = new Island(d);
    const map = Object.assign(Object.create(IslandMap.prototype) as IslandMap, { width: 800, height: 640, draw() {}, island: m.view(), frameTerrain: m.terrain });
    map.fit(false); map.zoomAt(1.7); map.center = [2, -3];
    const camera = () => [...map.center, map.scale, map.referenceScale], original = camera();
    d.geoNodes[0].disabled = true;
    const update = () => {
        const next = new Island(d); map.island = next.view(); map.frame(next.terrain); assert.deepEqual(camera(), original);
    };
    update();
    d.geoNodes.push(layer("Q", rect(80, 30, 97, 41), { type: "flat", amount: 12 })); update();
    d.geoNodes.splice(1, 1); update();
    d.grid.step = 2; update(); map.fit(false);
    assert.equal(map.zoomFactor(), 1); assert.deepEqual(map.center, [24.5, 0]);
    delete d.geoNodes[0].disabled;
    d.geoNodes.push(layer("C", rect(5, 5, 12, 12), { type: "flat", amount: 15 }));
    const island = new Island(d), fromTop = d.geoNodes.toReversed();
    for (const [k, n] of fromTop.entries()) {
        const view = island.viewBelow(n.id), expected = generateTerrain({ ...d, geoNodes: fromTop.slice(k + 1).reverse() });
        assert.deepEqual(view.terrain.defined, expected.defined); assert.deepEqual(view.terrain.heights, expected.heights);
        assert.deepEqual(view.design.geoNodes.map(v => v.id), fromTop.slice(k + 1).reverse().map(v => v.id));
    }
    assert(!island.viewBelow(d.geoNodes[0].id).terrain.defined.some(Boolean));
});