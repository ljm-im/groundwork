import assert from "node:assert/strict";
import { type Point } from "../../src/core/design/v5.ts";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { mapColors, overlay, type Theme } from "../../src/render/palette.ts";
import { withNodeSlope, addLayer, openCurve, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

type Page = Parameters<Parameters<typeof withCurveMap>[2]>[0];

async function screenshot(page: Page, selector: string, name: string) {
    const clip = await page.evaluate(selector => {
        const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
        return { x: x + scrollX, y: y + scrollY, width, height };
    }, selector);
    await page.screenshot(name, clip);
}

export function checkMapParameterOverlays(url: string) {
    const design = syntheticDesign(), shore = rect(11, -16, 38, 17).outlines[0].curve;
    shore.nodes[0].bulge = .3;
    const harbor: Point = [27, 0], firstPeak: Point = [-29, -5], nextPeak: Point = [-13, -6];
    const ridge = openCurve([{ p: [-36, 10], h: 6 }, { p: [-22, 15], h: 9 }, { p: [-8, 10], h: 6 }]);
    const coast = defaultFunction(design, "coast", { shore, center: harbor });
    assert(coast.type === "coast");
    coast.harbor.radius = 10;
    design.geoNodes = [design.geoNodes[0], addLayer(design, "C", rect(5, -30, 43, 28), coast),
        addLayer(design, "M", rect(-41, -25, -5, 25), {
            type: "mountain", valleys: [], ridges: [{ curve: withNodeSlope(ridge, 1) }], peaks: [{ at: firstPeak, height: 7, radius: 8, noise: 0, scale: 1 }]
        })];
    return withCurveMap(url, "round40-parameter-overlays", async page => {
        const { authored, cdp, click, evaluate, frame, key, paint, pixels, saved, tap, wait } = page;
        await click("[data-tab=layers]");
        for (const name of ["geoNodes", "issues", "grid", "contours"]) await click("input[data-layer=" + name + "]");
        await click("[data-tab=terrain]");
        await paint();

        async function visibleDash(point: Point, theme: Theme) {
            const start = pixels(await frame(), point, true), colors = mapColors[theme];
            const all = await evaluate(() => window.curveMapProbe.strokes);
            return all.some(stroke => distance(stroke.points[0], start) < .01 && stroke.color === colors.parameterGeometry &&
                stroke.width === overlay.parameterWidth && stroke.dash.join(",") === "6,4");
        }
        async function checkHarbor(theme: Theme) {
            const view = await frame(), center = pixels(view, harbor, true);
            const { color, strokes } = await evaluate(css => {
                const ctx = new OffscreenCanvas(1, 1).getContext("2d")!;
                ctx.strokeStyle = css;
                return { color: String(ctx.strokeStyle), strokes: window.curveMapProbe.arcStrokes };
            }, mapColors[theme].derivedGeometry);
            const circle = strokes.find(stroke => distance(stroke.point, center) < .01 && Math.abs(stroke.radius - 10 * view.scale) < .01);
            assert.deepEqual(circle && [circle.color, circle.width, circle.dash, circle.alpha], [color, 1, [1, 3], 1]);
            assert(await visibleDash(shore.nodes[0].p, theme), "The editable shoreline is dashed");
        }
        for (const theme of ["light", "dark"] as const) {
            await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
            await wait(theme => document.documentElement.dataset.theme === theme, theme);
            await paint();
            await checkHarbor(theme);
            await screenshot(page, "#map", "round40-harbor-" + theme);
        }
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await wait(() => document.documentElement.dataset.theme === "light");
        await click("#plus"); await paint();
        await checkHarbor("light");
        await click("#fit"); await paint();

        await tap([-29, 12.5]);
        assert.deepEqual((await frame()).geometry, { kind: "curve", index: -1 });
        assert.equal(await visibleDash(ridge.nodes[0].p, "light"), false);
        await click("[aria-label=添加山脊]"); await paint();
        assert(await visibleDash(ridge.nodes[0].p, "light"));
        await checkHarbor("light");
        await key("Escape");

        async function handleColors(point: Point) {
            const at = pixels(await frame(), point, true), dots = await evaluate(() => window.curveMapProbe.dots);
            return dots.filter(dot => distance(dot.point, at) < .01).map(dot => dot.color);
        }
        await tap(firstPeak);
        assert(await evaluate(() => !!document.querySelector(".geometry-box[aria-label=位置][aria-pressed=true]")));
        assert.deepEqual(await handleColors(firstPeak), [mapColors.light.accent]);
        await click("[aria-label=添加山峰]"); await paint();
        assert.match(await page.text(".drawing-status strong"), /添加山峰/);
        assert.deepEqual(await handleColors(firstPeak), [mapColors.light.bgPanel]);
        assert(await visibleDash(ridge.nodes[0].p, "light"));
        await tap(nextPeak, 2); await saved(); await paint();
        const { function: mountain } = page.owner(await authored(), "M");
        assert(mountain.type === "mountain");
        assert(mountain.peaks.every((peak, i) => distance(peak.at, [firstPeak, nextPeak][i]) < .01));
        assert.equal(mountain.peaks.length, 2);
        assert.equal((await handleColors(firstPeak)).length, 1);
        assert.equal((await handleColors(nextPeak)).length, 1);
    }, design);
}

export function checkSingleOutlineAndButtons(url: string) {
    const design = syntheticDesign();
    design.geometry.A = { label: "A", independent: true, curve: rect(-7, -5, 8, 7).outlines[0].curve };
    return withCurveMap(url, "round40-outline-and-buttons", async page => {
        const { click, evaluate, frame, key, paint, pixels, pointer, saved, tap, text } = page;
        const accent = mapColors.light.accent, inside: Point = [-14, -9];
        await click("[data-tab=layers]");
        await click("input[data-layer=issues]");
        await click("[data-tab=terrain]");
        await tap(inside);
        assert.equal((await frame()).selection?.id, "T");
        assert.equal((await frame()).outline, undefined);
        await pointer("mouseMoved", pixels(await frame(), [-13, -8]), 0, "none");
        await paint();
        assert.equal((await frame()).hoverPart?.role, "outline");
        const outlineStroke = () => evaluate(accent => window.curveMapProbe.strokes.find(stroke =>
            stroke.color === accent && stroke.width === 4 && !stroke.dash.length), accent);
        assert.equal((await outlineStroke())?.alpha, .3);
        await tap(inside);
        assert.equal((await frame()).outline, 0);
        assert.equal((await outlineStroke())?.alpha, 1);
        const outline = "[data-outline].selected > .subitem-heading";
        assert.equal(await text(outline + " .subitem-toggle"), "轮廓 1");
        assert.deepEqual(await evaluate(sel => [...document.querySelectorAll(sel + " button")].map(button => button.classList.contains("subitem-toggle") ?
            "展开轮廓" : button.getAttribute("aria-label")), outline), ["展开轮廓", "引用轮廓"]);

        await click(".geometry-reference");
        assert(await evaluate(() => document.activeElement?.matches(".reference-menu")));
        await key("ArrowDown");
        assert(await evaluate(() => document.activeElement === document.querySelector(".reference-menu button[aria-selected=true]")));
        await key("Escape");

        await click("button[aria-label=新建地件]");
        assert(await evaluate(() => document.activeElement?.matches(".creation-menu")));
        await key("ArrowUp");
        assert(await evaluate(() => document.activeElement === [...document.querySelectorAll(".creation-menu button:enabled")].at(-1)));
        await key("Escape");
        await page.tool("地件", "pen");

        const pen = "[aria-label=单击放置的节点]", node = "[role=group][aria-label=节点类型]";
        const gaps = (selector: string) => evaluate(selector => {
            const boxes = [...document.querySelectorAll(selector + " button")].map(button => button.getBoundingClientRect());
            return boxes.slice(1).map((box, i) => box.left - boxes[i].right);
        }, selector);
        const focusedAndPressed = (selector: string) => evaluate(selector => [document.activeElement?.getAttribute("aria-label"),
            document.querySelector(selector + " [aria-pressed=true]")?.getAttribute("aria-label")], selector);
        assert.deepEqual(await gaps(pen), [4]);
        await screenshot(page, ".drawing-status", "round40-pen-buttons");
        await click(pen + " [aria-label=尖角]");
        await key("ArrowRight");
        assert.deepEqual(await focusedAndPressed(pen), ["自动平滑", "自动平滑"]);
        await key("ArrowLeft");
        assert.deepEqual(await focusedAndPressed(pen), ["尖角", "尖角"]);
        await key("Escape");

        await click("[data-geo-node=T]");
        await tap([-21, -14]);
        assert.equal((await frame()).vertex?.role, "vertex");
        assert.deepEqual(await gaps(node), [4, 4]);
        await screenshot(page, "[data-curve-node]", "round40-node-buttons");
        await click(node + " [aria-label=尖角]");
        await key("ArrowRight"); await saved();
        assert.deepEqual(await focusedAndPressed(node), ["自动平滑", "自动平滑"]);
    }, design);
}

export function checkOutlineHoleHits(url: string) {
    const design = syntheticDesign(), outer = rect(-25, -20, 26, 21), hole = rect(-8, -7, 9, 8).outlines[0];
    for (const node of hole.curve.nodes) node.id = "hole-" + node.id;
    outer.outlines.push(hole);
    design.geoNodes[1] = addLayer(design, "T", outer, defaultFunction(design, "slope", { slope: "radial", center: [16, 11] }));
    return withCurveMap(url, "round40-outline-hole", async page => {
        const { authored, click, drag, evaluate, frame, key, paint, pixels, pointer, tap, text, translated } = page;
        const point: Point = [0, 0];
        await click("[data-tab=layers]"); await click("input[data-layer=issues]"); await click("[data-tab=terrain]");
        await pointer("mouseMoved", pixels(await frame(), point), 0, "none"); await paint();
        assert.equal((await frame()).hovered?.id, "T");
        await tap(point);
        assert.equal((await frame()).selection?.id, "T");
        assert.equal((await frame()).outline, undefined);
        await tap(point);
        assert.equal((await frame()).outline, 1);
        assert.equal(await text("[data-outline].selected .subitem-toggle"), "轮廓 2");
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll("[data-outline].selected .row-actions button")]
            .map(button => button.getAttribute("aria-label"))), ["引用轮廓", "删除轮廓"]);
        await tap(point, 1);
        assert.equal((await frame()).outline, 0);
        await tap(point, 1);
        assert.equal((await frame()).selection?.id, "G");
        await tap(point, 0, "right");
        assert.equal((await frame()).selection?.id, "T");
        assert.equal((await frame()).outline, 1);
        assert.equal(await text(".context-menu [data-option=delete-outline]"), "删除轮廓");
        await key("Escape");

        await click("[data-geo-node=T]"); await paint();
        assert.equal((await frame()).outline, undefined);
        const before = page.owner(await authored(), "T"), dx = 30 / (await frame()).scale;
        await drag(point);
        const after = page.owner(await authored(), "T");
        assert(before.construction.type === "outline" && after.construction.type === "outline");
        assert(before.function.type === "slope" && before.function.kind === "radial" && after.function.type === "slope" && after.function.kind === "radial");
        for (const [i, outline] of before.construction.outlines.entries())
            translated(outline.nodes.map(node => node.p), after.construction.outlines[i].nodes.map(node => node.p), dx);
        translated([before.function.center], [after.function.center], dx);
    }, design);
}