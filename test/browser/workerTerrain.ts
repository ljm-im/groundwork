import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseDesign } from "../../src/core/design/model.ts";
import { sampleField } from "../../src/core/design/results.ts";
import { Project } from "../../src/core/project.ts";
import { layer, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

interface Run {
    done?: { elapsed: number; index: number; step: number; frames: number[] };
}
declare global {
    interface Window { terrainRun: Run }
}

function terrainForBrowser() {
    const design = syntheticDesign(), area = rect(-120, -90, 120, 90);
    design.grid.step = .5;
    design.fields.F = { label: "F" };
    design.geoNodes[0].construction = area;
    design.geoNodes[1].function = { type: "flat", amount: "{field:F} + {input:A} - 4" };
    design.geoNodes.splice(1, 0, layer("F", area, { type: "ground", value: .8 }, "F"));
    for (let i = 0; i < 5; i++)
        design.geoNodes.push(layer("N" + i, area, { type: "noise", amplitude: 2, scale: 11 + i, octaves: 7, warp: 8, warpScale: 25, carve: 1 }));
    return design;
}

const digest = (array: Float32Array | Uint8Array) =>
    createHash("sha256").update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest("hex");

export async function checkWorkerTerrain(url: string) {
    const design = terrainForBrowser(), step = .1;
    await withCurveMap(url, "worker-terrain", async ({ cdp, click, evaluate, wait, paint }) => {
        const initial = await evaluate(async () => ({ isolated: crossOriginIsolated, ...await window.terrainFieldHashes!() }));
        assert(initial.isolated && initial.helpers > 0);

        const below = new Project(parseDesign(design)).viewBelow("T"), expected = sampleField(below.terrain, "height", [-14, -8]);
        const before = await evaluate(() => {
            const editor = window.curveMapProbe.editor!;
            editor.showThrough("T");
            return editor.mapProject.design.geoNodes.length;
        });
        assert.equal(before, design.geoNodes.length);
        await wait(() => window.curveMapProbe.editor!.mapProject.design.geoNodes.length === 2);
        const value = await evaluate(() => {
            const editor = window.curveMapProbe.editor!;
            const { grid, fields } = editor.mapProject.terrain;
            return fields.height.values[grid.index(-14, -8)];
        });
        assert.equal(value, expected);
        await evaluate(() => window.curveMapProbe.editor!.showThrough(null));

        await click("[data-geo-node=T]");
        await click("[data-property-tab=function]");
        await wait(() => {
            const face = document.querySelector(".numeric-face[data-tip^='= 3.8']");
            return !!face;
        });
        const changed = await evaluate(step => {
            const editor = window.curveMapProbe.editor!, started = performance.now(), index = editor.history.index;
            const run: Run = window.terrainRun = {}, frames: number[] = [];
            const frame = (time: number) => {
                if (!editor.busy) return;
                frames.push(time);
                requestAnimationFrame(frame);
            };
            const work = editor.edit(d => {
                d.grid.step = step;
            });
            void work?.then(() => run.done = { elapsed: performance.now() - started, frames, index: editor.history.index,
                step: editor.project.terrain.grid.step });
            requestAnimationFrame(frame);
            const rect = document.querySelector("#map")!.getBoundingClientRect();
            return { index, center: editor.map.center, x: rect.left + rect.width * .45, y: rect.top + rect.height * .45 };
        }, step);
        await wait(() => document.querySelector(".map-wrap[data-busy=true]") &&
            document.querySelector<HTMLButtonElement>("#save")!.disabled && document.querySelector<HTMLButtonElement>("#new")!.disabled);
        assert.equal(await evaluate(() => window.curveMapProbe.editor!.history.index), changed.index);
        assert.equal(await evaluate(() => {
            window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
            const draft = JSON.parse(localStorage.getItem("terrain-editor/unsaved-v1")!);
            return JSON.parse(draft.pending).grid.step;
        }), step);
        const { x, y } = changed;
        await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "middle", buttons: 4, clickCount: 1 });
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 36, y: y + 18, button: "middle", buttons: 4 });
        await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 36, y: y + 18, button: "middle", buttons: 0 });
        const panned = await evaluate(() => ({ busy: window.curveMapProbe.editor!.busy, center: window.curveMapProbe.editor!.map.center }));
        assert(panned.busy);
        assert.notDeepEqual(panned.center, changed.center);
        await evaluate(async () => window.curveMapProbe.editor!.finishWork());
        await paint();
        const report = await evaluate(() => window.terrainRun.done!);
        assert(report.elapsed > 1000, "Generation took " + report.elapsed + " ms");
        assert(report.frames.length > 15);
        assert(report.frames.at(-1)! - report.frames[0] > 650);
        assert.equal(report.index, changed.index + 1);
        assert.equal(report.step, step);

        const edited = parseDesign(design);
        edited.grid.step = step;
        const { terrain } = new Project(edited), expectedHashes = Object.fromEntries(Object.entries(terrain.fields)
            .map(([key, f]) => [key, { values: digest(f.values), defined: digest(f.defined) }]));
        const actual = await evaluate(() => window.terrainFieldHashes!());
        assert.deepEqual(actual.fields, expectedHashes);
        console.log("Terrain worker with", actual.helpers, "helpers kept", report.frames.length, "frames over", Math.round(report.elapsed), "ms");
    }, design);
}