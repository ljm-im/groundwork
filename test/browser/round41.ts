import assert from "node:assert/strict";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { fixtureMark, addLayer, literalCurve, openCurve, rect, syntheticDesign, fixtureCurve } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkProfilesAndLabels(url: string) {
    const d: Design = syntheticDesign();
    const ridge: Point[] = [[-34, 12], [-24, 12], [-14, 12]];
    const mountain = defaultFunction(d, "mountain"), slope = defaultFunction(d, "slope", { center: [0, -14] });
    assert(mountain.type === "mountain" && slope.type === "slope");
    mountain.ridges.push(fixtureCurve(d, { curve: openCurve(ridge.map((p, i) => ({ p, h: i === 1 ? 20 : 8, slope: 1 })), "corner", "ridge-") }, ["h", "slope"]));
    d.geoNodes.splice(1, 1,
        { ...addLayer(d, "M", rect(-39, -4, 23, 28), mountain), label: "山体 A" },
        { ...addLayer(d, "S", rect(-38, -31, 26, -7), slope), label: "坡道 A" },
        addLayer(d, "F", rect(30, 18, 36, 22), { type: "flat", amount: "{geo:M.ridges.0.h.ridge-1}" }));
    d.marks.push(fixtureMark(d, { id: "R", kind: "scale", label: "比例尺 A", follow: "screen", point: [18, 42], length: 25 }));
    return withCurveMap(url, "round41-profiles-and-labels", async page => {
        const { authored, click, evaluate, frame, key, paint, pixels, saved, screenshot, tap, text, undo, wait } = page;
        const search = async (value: string) => {
            await evaluate(value => {
                const input = document.querySelector<HTMLInputElement>("#terrain-search")!;
                input.value = value;
                input.dispatchEvent(new InputEvent("input", { bubbles: true }));
            }, value);
            await paint();
        };
        await search("山脉");
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-geo-node]")].map(n => n.dataset.geoNode)), ["M"]);
        assert.equal(await text("[data-stack-row='n:M'] .list-detail"), "山脉");
        await search("");
        const inspect = async (id: string) => {
            await click("[data-geo-node=" + id + "]");
            await click("[data-property-tab=function]");
        };
        await inspect("M");
        const titleAction = (label: string) => "#properties .property-title button[aria-label=" + JSON.stringify(label) + "]";
        for (const action of ["复制地件", "删除地件", "禁用地件"])
            assert.equal(await evaluate(s => document.querySelector<HTMLElement>(s)?.dataset.tip, titleAction(action)), action);
        await click(titleAction("禁用地件"));
        await saved();
        assert.equal(await evaluate(s => document.querySelector<HTMLElement>(s)?.dataset.tip, titleAction("启用地件")), "启用地件");
        await undo();
        await click(".choice-face[aria-label=函数]");
        const menu = ".choices[aria-label=函数]";
        assert.equal(await text(menu + " [data-option=mountain]"), "山脉");
        await key("Escape");

        await click(".part:has([aria-label=添加山脊]) .subitem-toggle");
        await tap(ridge[1]); await tap(ridge[1]);
        const input = "#properties [data-curve-node] .numeric-face[aria-label=高度]";
        const output = "#properties [data-curve-node] [data-output-value]";
        const checkbox = "#properties [data-curve-node] label";
        const override = async () => {
            const id = await evaluate(s => [...document.querySelectorAll<HTMLLabelElement>(s)]
                .find(label => label.textContent === "覆盖高度插值")!.htmlFor, checkbox);
            const selector = "input[id=" + JSON.stringify(id) + "]";
            await click(selector);
            await saved();
            await paint();
        };
        assert.equal(await text(input), "20.0");
        await override();
        assert.equal(await text(output), "8.0");
        assert.equal(await evaluate(s => !!document.querySelector(s), input), false);
        const outputIcon = await evaluate(s => document.querySelector(s)?.parentElement?.parentElement?.querySelector(".param-name svg path")?.getAttribute("d"), output);
        assert(outputIcon);
        const nodeClip = await evaluate(() => {
            const { x, y, width, height } = document.querySelector("[data-curve-node]")!.getBoundingClientRect();
            return { x: x + scrollX, y: y + scrollY, width, height };
        });
        await screenshot("round41-output-value", nodeClip);

        await inspect("F");
        const token = "#properties .ref-chip[data-ref='geo:M.ridges.0.h.ridge-1'] svg path";
        const chipIcon = async () => evaluate(s => document.querySelector(s)?.getAttribute("d"), token);
        assert.equal(await chipIcon(), outputIcon);
        const option = (id: string) => ".reference-menu[aria-label=可用变量] [data-option=" + JSON.stringify(id) + "]";
        await click("button[aria-label=为增量插入变量]");
        assert.equal(await evaluate(s => !!document.querySelector(s), option("mark:R")), false);
        await click(option("geo:M"));
        const middle = option("geo:M.ridges.0.h.ridge-1");
        assert.equal(await text(middle + " .menu-reading"), "8.0 m");
        assert.equal(await evaluate(s => document.querySelector(s + " svg path")?.getAttribute("d"), middle), outputIcon);
        await key("Escape");

        await inspect("M");
        await tap(ridge[1]); await tap(ridge[1]);
        await override();
        assert.equal(await text(input), "20.0");
        await inspect("F");
        assert.notEqual(await chipIcon(), outputIcon);

        await inspect("S");
        const lines: [Point, Point][] = [[[-30, -20], [15, -20]], [[-30, -12], [15, -12]]];
        for (const [a, b] of lines) {
            await click("[aria-label=添加坡线]");
            assert.equal(await text(".drawing-status strong"), "给“坡道 A”添加坡线");
            await tap(a, 2); await tap(b, 2); await key("Enter");
            await saved(); await paint();
        }
        const camera = await frame(), endpoints = lines.map(line => line.map(p => pixels(camera, p, true)));
        const strokes = await evaluate(() => window.curveMapProbe.strokes);
        for (const [a, b] of endpoints)
            assert(strokes.some(s => distance(s.points[0], a) < 1 && distance(s.points.at(-1)!, b) < 1), "Both slope lines are visible");
        await click(".geometry-box[aria-label=坡线]");
        await click("[data-property-tab=function]");
        assert.equal((await frame()).geometry?.kind, "curve");
        assert.equal((await frame()).vertex, undefined);
        await key("Delete"); await saved(); await paint();
        const remaining = (await authored()).geoNodes.find(n => n.id === "S")!.function;
        assert(remaining.type === "slope" && remaining.lines.length === 1);
        assert(literalCurve(await authored(), remaining.lines[0]).nodes[0].p[1] > -14);

        await inspect("M");
        const at: Point = [10.5, 8.5];
        const height = () => evaluate(async at => {
            const module = "/src/core/design/results.ts";
            const { sampleField } = await import(module) as typeof import("../../src/core/design/results.ts");
            return sampleField(window.curveMapProbe.editor!.project.terrain, "height", at);
        }, at);
        const before = await height();
        await click("[aria-label=添加山谷]");
        assert.equal(await text(".drawing-status strong"), "给“山体 A”添加山谷");
        await tap([10.5, 1.5], 2); await tap([10.5, 18.5], 2); await key("Enter");
        await saved(); await paint();
        await wait(() => window.curveMapProbe.editor?.project.design.geoNodes.some(n => n.id === "M" && n.function.type === "mountain" && n.function.valleys.length === 1));
        assert((await height())! < before!);
        await click("[aria-label=重画山谷线]");
        assert.equal(await text(".drawing-status strong"), "重画“山体 A”的山谷线");
    }, d);
}