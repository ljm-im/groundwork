import assert from "node:assert/strict";
import { type Point } from "../../src/core/design/v5.ts";
import { geometryPath } from "../../src/core/edit/geoControls.ts";
import { mixPoint } from "../../src/core/math/geometry.ts";
import { withNodeSlope, addLayer, literalCurve, openCurve, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkCurvePlacements(url: string) {
    const d = syntheticDesign(), mountain = rect(-32, -17, -10, 1);
    mountain.outlines.push(rect(-9, -22, 2, -13).outlines[0]);
    d.geometry.S = { label: "共享环", listed: true, curve: rect(16, 16, 24, 23).outlines[0].curve };
    d.geoNodes.splice(1, 1,
        addLayer(d, "A", rect(-35, 15, -24, 25), { type: "noise", scale: 5, amplitude: 1 }),
        addLayer(d, "B", rect(-12, 15, -2, 25), { type: "flat", amount: 2 }),
        { ...addLayer(d, "M", mountain, { type: "mountain", valleys: [], ridges: [{ curve: withNodeSlope(openCurve([
            { p: [-30, -13], h: 8 }, { p: [-6, -18], h: 12 }
        ], "corner", "ridge-"), 1) }], peaks: [{ at: [-25, -10], height: 13, radius: 4, scale: 1, noise: 0 }] }), label: "山脉" },
        { ...addLayer(d, "R", rect(10, -21, 25, -6), { type: "mountain", valleys: [], ridges: [{ curve: withNodeSlope(openCurve([{ p: [14, -12], h: 0 }, { p: [20, -10], h: 0 }]), 2) }], peaks: [] }),
            label: "东山" },
        addLayer(d, "C", rect(12, 12, 30, 27), { type: "coast", shore: { curve: "S" }, roughness: 0,
            harbor: { center: [0, 0], span: 3, radius: 0 } })
    );

    return withCurveMap(url, "round38-curve-placements", async page => {
        const { authored, click, disk, drag, evaluate, frame, key, paint, pixels, saved, screenshot, tap, text, translated, undo } = page;
        const menu = ".reference-menu[aria-label=引用曲线]";
        const outlineToggle = "[aria-label='为“轮廓 1”引用曲线']";
        const ridgeToggle = "[aria-label='为“山脊线”引用曲线']";
        const option = (id: string) => menu + " [data-option=" + JSON.stringify(id) + "]";
        const outlineKey = "geo:M.construction.outlines.0";
        const fixture = d.geoNodes.find(n => n.id === "M")!;
        assert(fixture.construction.type === "outline" && "curve" in fixture.construction.outlines[0] && fixture.function.type === "mountain" && "curve" in fixture.function.ridges[0]);
        const shape = "curve:" + fixture.construction.outlines[0].curve, ridge = "curve:" + fixture.function.ridges[0].curve;
        const groups = () => evaluate(selector => [...document.querySelectorAll(selector + " .group-name")].map(n => n.textContent), menu);
        async function select(id: string) {
            await click("[data-tab=terrain]");
            await click("[data-geo-node=" + id + "]");
            await paint();
        }
        async function menuScreenshot(name: string) {
            const clip = await evaluate(selector => {
                const popup = document.querySelector(selector)!;
                popup.querySelector(".menu-group:last-child .group-name")!.scrollIntoView({ block: "nearest" });
                const { x, y, width, height } = popup.getBoundingClientRect();
                return { x, y, width, height };
            }, menu);
            await screenshot(name, clip);
        }
        async function openOutlineMenu(id: string) {
            await select(id);
            await click("[data-property-tab=region]");
            if (!await evaluate(s => !!document.querySelector(s), outlineToggle)) await click("[data-outline] .subitem-toggle");
            assert(await evaluate(() => document.querySelector(".geometry-box[aria-label=曲线]")));
            await click(outlineToggle);
        }
        const positions = async (ids: string[]) => {
            const design = await authored();
            return ids.map(id => geometryPath(page.owner(design, id), 0)!.nodes.map(node => node.p));
        };
        const eastEdge = (points: Point[]) => mixPoint(points[1], points[2], .5);
        async function whole(id: string, watch: string, verify: () => Promise<void>) {
            await select(id);
            const [own, followed] = await positions([id, watch]), f = await frame(), dx = 30 / f.scale;
            const [x, y] = eastEdge(followed);
            await evaluate(points => window.curveMapProbe.pathChecks = points, [pixels(f, [x, y], true), pixels(f, [x + dx, y], true)]);
            const before = await disk();
            await drag(mixPoint(own[0], own[2], .5), 0, async () => {
                assert.equal(await disk(), before);
                const rendered = await evaluate(() => window.curveMapProbe.pathStrokes);
                assert(rendered.some(s => Math.abs(s.width - .6) < .001 && s.hits?.[0] === false && s.hits[1] === true),
                    "The other holder's region is drawn at its new position before release");
                await verify();
            });
            const [after, follower] = await positions([id, watch]);
            translated(own, after, dx);
            translated(followed, follower, dx);
        }

        await openOutlineMenu("A");
        assert.deepEqual(await groups(), ["轮廓", "闭合曲线"]);
        assert.equal(await text(option(outlineKey)), "山脉.轮廓 1");
        assert.match(await text(option(shape)), /^曲线 \d+$/);
        assert.equal(await text(option("curve:S")), "共享环");
        assert(!await evaluate(s => document.querySelector(s), option("geo:A.construction.outlines.0")));
        await click(option(outlineKey)); await saved(); await paint();
        assert.equal(await text(".geometry-box .ref-chip"), "山脉.轮廓 1");
        await click(outlineToggle);
        assert(await evaluate(s => document.querySelector(s)?.getAttribute("aria-selected") === "true", option(outlineKey)));
        assert.equal(await text(menu + " .menu-group:first-child button:first-child"), "解除引用");
        const viewport = { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false };
        await page.cdp("Emulation.setDeviceMetricsOverride", { ...viewport, height: 1180 });
        await paint();
        await menuScreenshot("round38-outline-reference-menu-light");
        await key("Escape");
        await page.cdp("Emulation.setDeviceMetricsOverride", viewport);
        await paint();

        const before = page.owner(await authored(), "M").function;
        await whole("A", "M", async () => {
            const n = await evaluate(() => window.curveMapProbe.editor!.dragPreview?.nodes.get("M")?.node);
            assert.deepEqual(n?.function, before);
        });
        assert.deepEqual(page.owner(await authored(), "M").function, before);
        await whole("M", "A", async () => {
            const n = await evaluate(() => window.curveMapProbe.editor!.dragNode);
            assert(n?.function.type === "mountain" && before.type === "mountain");
            assert(n.function.peaks[0].at[0] > before.peaks[0].at[0]);
        });

        await openOutlineMenu("B");
        await click(option(shape)); await saved(); await paint();
        assert.match(await text(".geometry-box"), /^曲线 \d+$/);
        const [original, placed] = await positions(["M", "B"]);
        assert.deepEqual(placed, literalCurve(await authored(), shape.slice(6)).nodes.map(n => n.p));
        await select("B");
        const dx = 30 / (await frame()).scale;
        await drag(mixPoint(placed[0], placed[2], .5));
        const [still, shifted] = await positions(["M", "B"]);
        assert.deepEqual(still, original);
        translated(placed, shifted, dx);
        const graph = (await authored()).geoNodes.find(n => n.id === "M")!.construction;
        const source = graph.type === "outline" ? graph.outlines[0] : undefined;
        assert(source && "curve" in source);
        await drag(shifted[0], 2);
        const [changed, reshaped] = await positions(["M", "B"]);
        assert(changed[0][0] > still[0][0]);
        assert(Math.abs(changed[0][0] - still[0][0] - dx) < .02);
        assert(Math.abs(reshaped[0][0] - shifted[0][0] - dx) < .02);
        assert.deepEqual(changed.slice(1), still.slice(1));
        const stored = (await authored()).geoNodes.find(n => n.id === "M")!.construction;
        assert(stored.type === "outline" && "curve" in stored.outlines[0]);
        assert.deepEqual(stored.outlines[0].offset, source.offset);

        await select("M");
        const moved = page.owner(await authored(), "M"), middle = mixPoint(changed[0], changed[2], .5);
        await tap(middle);
        assert.equal((await frame()).outline, 0);
        await drag(middle);
        const movedOutline = page.owner(await authored(), "M");
        assert.deepEqual(movedOutline.function, moved.function);
        assert.deepEqual(geometryPath(movedOutline, 1), geometryPath(moved, 1));
        await undo();
        assert.deepEqual(page.owner(await authored(), "M"), moved);

        await select("R"); await click("[data-property-tab=function]");
        if (!await evaluate(s => !!document.querySelector(s), ridgeToggle))
            await click(".part:has([aria-label=添加山脊]) .subitem-toggle");
        await click(ridgeToggle);
        assert.deepEqual(await groups(), ["山脊", "曲线"]);
        assert.equal(await text(option("geo:M.ridges.0")), "山脉.山脊 1");
        assert.match(await text(option(ridge)), /^曲线 \d+$/);
        await menuScreenshot("round38-ridge-reference-menu-light");
        await click(option("geo:M.ridges.0")); await saved(); await paint();
        assert.equal(await text("[aria-label=山脊线] .ref-chip"), "山脉.山脊 1");
        await tap(geometryPath(page.owner(await authored(), "R"), -1)!.nodes[0].p);
        await click("#properties [data-parameter$='.ridges.0.slope.ridge-0'] .numeric-face");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await page.cdp("Input.insertText", { text: "1.5" });
        await key("Enter"); await saved(); await paint();
        const final = await authored(), fn = page.owner(final, "M").function;
        assert(fn.type === "mountain" && fn.ridges[0].curve.nodes[0].slope === 1.5);
        const alias = final.geoNodes.find(n => n.id === "R")!.function;
        assert(alias.type === "mountain");
        assert.deepEqual(alias.ridges[0], { ref: "{geo:M.ridges.0}" });

        await click("[data-tab=inputs]"); await click("[data-select-geometry=S]"); await paint();
        const originalShared = literalCurve(final, "S"), savedText = await disk();
        await drag(mixPoint(originalShared.nodes[0].p, originalShared.nodes[1].p, .5), 0, async () => {
            assert(await evaluate(() => !window.curveMapProbe.editor!.dragPreview));
        });
        assert.equal(await disk(), savedText);
    }, d);
}