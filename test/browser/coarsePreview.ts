import assert from "node:assert/strict";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { Project } from "../../src/core/project.ts";
import { rect, syntheticDesign } from "../scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./filePickers.ts";

declare global {
    interface Window { previewFrames: { step: number; height: number }[] }
}

export async function checkCoarsePreview(url: string) {
    const design = syntheticDesign();
    design.grid.step = .2;
    design.geoNodes[0].construction = rect(-60, -60, 60, 60);
    const browser = await startChromium(), { cdp, click, evaluate, mouse, wait } = browser;
    try {
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await cdp("Page.navigate", { url });
        await wait(() => !!document.querySelector(".empty-state"));
        await evaluate(async ({ bytes, url }) => {
            const mapModule = new URL("src/render/map.ts", url).href;
            const { ProjectMap } = await import(mapModule) as typeof import("../../src/render/map.ts");
            const draw = ProjectMap.prototype.draw;
            window.previewFrames = [];
            ProjectMap.prototype.draw = function (view, theme) {
                const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
                canvas.dataset.terrainCells = String(view.project.terrain.grid.size);
                const { grid, fields } = view.project.terrain;
                canvas.dataset.terrainStep = String(grid.step);
                window.previewFrames.push({ step: grid.step, height: fields.height.values[grid.index(-14, -8)] });
                draw.call(this, view, theme);
            };
            window.probe.openName = "preview.json";
            const root = await navigator.storage.getDirectory(), file = await root.getFileHandle(window.probe.openName, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes);
            await stream.close();
        }, { bytes: serializeDesign(design), url });
        await click("#open");
        await wait(() => document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainCells === "360000");
        await click("[data-tab=inputs]");
        const [x, y] = await evaluate(() => {
            const face = document.querySelector<HTMLButtonElement>("[data-input=A] .numeric-face")!;
            Object.defineProperty(face, "requestPointerLock", { value: undefined });
            const r = face.getBoundingClientRect();
            return [r.left + r.width / 2, r.top + r.height / 2];
        });
        await mouse("mousePressed", x, y);
        for (const dx of [16, 32, 48]) await mouse("mouseMoved", x + dx, y);
        await wait(() => document.querySelector("#mode-hint")?.textContent === "拖动中按 0.4 m 间距预览");
        const live = await evaluate(() => Number(document.querySelector("[data-input=A] .numeric-face")?.textContent?.trim()));
        await wait(value => document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainCells === "90000" &&
            window.previewFrames.at(-1)?.height === value, live);
        assert.equal(await evaluate(() => document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainStep), "0.4");
        const lastPreview = await evaluate(() => {
            const last = window.previewFrames.at(-1)!;
            window.previewFrames = [];
            return last;
        });
        await mouse("mouseReleased", x + 48, y);
        await wait(() => !document.querySelector(".map-wrap[data-busy=true]") &&
            !document.querySelector("#mode-hint")?.textContent?.includes("间距预览") &&
            document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainCells === "360000");
        assert.equal(await evaluate(() => document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainStep), "0.2");
        await wait(() => document.querySelector("#save-state")?.textContent === "已保存");
        const saved = parseDesign(await evaluate(() => window.disk("preview.json")));
        assert.notEqual(saved.inputs.A.value, design.inputs.A.value);
        const { grid, fields } = new Project(saved).terrain, expected = fields.height.values[grid.index(-14, -8)];
        assert.equal(lastPreview.height, expected);
        const frames = await evaluate(() => window.previewFrames);
        assert.equal(frames.at(-1)?.height, expected);
        assert(frames.every(frame => frame.step === .4 || frame.height === expected), "Releasing the gesture must not draw the old terrain");
    }
    finally {
        await browser.close();
    }
}