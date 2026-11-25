import assert from "node:assert/strict";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { rect, syntheticDesign } from "../scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./filePickers.ts";

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
            ProjectMap.prototype.draw = function (view, theme) {
                const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
                canvas.dataset.terrainCells = String(view.project.terrain.grid.size);
                canvas.dataset.terrainStep = String(view.project.terrain.grid.step);
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
        await mouse("mouseMoved", x + 48, y);
        await wait(() => document.querySelector("#mode-hint")?.textContent === "拖动中按 0.4 m 间距预览");
        await wait(() => document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainCells === "90000");
        assert.equal(await evaluate(() => document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainStep), "0.4");
        await mouse("mouseReleased", x + 48, y);
        await wait(() => !document.querySelector(".map-wrap[data-busy=true]") &&
            !document.querySelector("#mode-hint")?.textContent?.includes("间距预览") &&
            document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainCells === "360000");
        assert.equal(await evaluate(() => document.querySelector<HTMLCanvasElement>("#map")?.dataset.terrainStep), "0.2");
        await wait(() => document.querySelector("#save-state")?.textContent === "已保存");
        const saved = parseDesign(await evaluate(() => window.disk("preview.json")));
        assert.notEqual(saved.inputs.A.value, design.inputs.A.value);
    }
    finally {
        await browser.close();
    }
}