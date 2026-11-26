import { resolveDesign } from "../../src/core/design/parameters.ts";
import assert from "node:assert/strict";
import { type Point } from "../../src/core/design/v5.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { sampleField } from "../../src/core/design/results.ts";
import { Project } from "../../src/core/project.ts";
import { sectionColors } from "../../src/render/palette.ts";
import { withLayeredMap } from "./layeredMapFixture.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export async function checkSectionPlots(url: string) {
    await withLayeredMap(url, "custom-field-section", async ({ at, authored, click, drag, evaluate, fit, inMap, paint, panel, pickField, saved, screenshot, text }) => {
        const section = "[data-section=S]";
        console.log("section endpoints outside height and plots from the displayed field");
        await fit(); await panel("marks"); await click(section);
        const target: Point = [68, -27];
        assert(await inMap(target));
        const beforeSection = await authored();
        assert.equal(sampleField(new Project(beforeSection).terrain, "height", target), undefined);
        await drag(await at(resolveDesign(beforeSection).sections[0].points[1]), await at(target)); await saved();
        assert(distance(resolveDesign(await authored()).sections[0].points[1], target) < .3);
        await paint();
        assert.equal(await text(".bottom-tabs small"), "高度 / m");
        const heightPlot = await evaluate(() => ({ ...window.layeredMapProbe.plots, terrain: window.layeredMapProbe.terrain }));
        const heightTicks = heightPlot.ticks.map(Number);
        assert(Math.min(...heightTicks) < 3 && Math.max(...heightTicks) > 3 && heightPlot.fills === 1);
        await panel("layers"); await pickField("F");
        const fieldPlot = await evaluate(() => ({ ...window.layeredMapProbe.plots, terrain: window.layeredMapProbe.terrain }));
        assert.equal(await text(".bottom-tabs small"), "基质 / %");
        const fieldTicks = fieldPlot.ticks.map(Number);
        assert(Math.min(...fieldTicks) < .47 && Math.max(...fieldTicks) > .47);
        assert(fieldPlot.ticks.every(tick => /^0\.\d\d$/.test(tick)));
        assert.equal(fieldPlot.fills, 1);
        assert.equal(fieldPlot.terrain, heightPlot.terrain);
        assert(fieldPlot.clears > heightPlot.clears);
        await screenshot("custom-field-section");
        await pickField("U"); assert.equal(await text(".bottom-tabs small"), "场 U");
    });
    await withCurveMap(url, "section-baselines", async ({ evaluate, paint, saved, screenshot, tap, text, tool }) => {
        for (const [name, points] of [["section-flat", [[-52, -40], [48, -40]]], ["section-relief", [[-52, 2], [48, 2]]]] as [string, [Point, Point]][]) {
            await tool("标记", "section");
            for (const point of points) await tap(point);
            await saved(); await paint();
            assert.doesNotMatch(await text("#plots .plot-title"), /—/);
            const result = await evaluate(() => {
                const canvas = document.querySelector<HTMLCanvasElement>("#plots canvas")!, box = document.querySelector("#plots")!.getBoundingClientRect();
                const ticks = window.curveMapProbe.ticks, low = ticks.find(t => t.baseline === "middle")!, zero = ticks.find(t => t.baseline === "alphabetic" && t.align === "left")!;
                const pixel = canvas.getContext("2d")!.getImageData(Math.round(canvas.width / 2), Math.round(low.y + 2), 1, 1).data;
                return { low, zero, pixel: [...pixel].slice(0, 3), clip: { x: box.x, y: box.y, width: box.width, height: box.height } };
            });
            assert(result.zero.top - result.low.bottom >= 4);
            assert.equal(result.pixel.map(n => n.toString(16).padStart(2, "0")).join(""), sectionColors.ground.slice(1));
            await screenshot(name, result.clip);
        }
    });
}