import assert from "node:assert/strict";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { mapColors } from "../../src/render/palette.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { addLayer, fixtureMark, literalCurve, openCurve, rect, syntheticDesign, withNodeSlope } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkSelectionHierarchy(url: string) {
    const design: Design = syntheticDesign();
    const ridge = openCurve([{ p: [-25, 16], h: 8 }, { p: [-17, 22], h: 9 }, { p: [-9, 16], h: 8 }], "corner", "ridge-");
    design.geoNodes.push(
        addLayer(design, "M", rect(-33, 6, -4, 34), { type: "mountain", ridges: [{ curve: withNodeSlope(ridge, 2) }], valleys: [], peaks: [] }),
        addLayer(design, "B", rect(10, 7, 28, 28), { type: "flat", amount: 2 })
    );
    design.marks.push(fixtureMark(design, { id: "P", label: "标记 A", kind: "text", point: [32, -12], follow: "map" }));
    const curveId = (d: Design, id: string) => {
        const { construction } = d.geoNodes.find(n => n.id === id)!;
        assert(construction.type === "outline" && "curve" in construction.outlines[0]);
        return construction.outlines[0].curve;
    };
    return withCurveMap(url, "round43", async page => {
        const { authored, click, drag, evaluate, frame, key, paint, pointer, pixels, saved, screenshot, tap, text, undo } = page;
        const p: Point = [-14, -8], away: Point = [0, 54], row = "[data-outline] > .subitem-heading";
        const curveInput = "#properties .geometry-box[aria-label=曲线]", tab = "[data-property-tab=geometry]";
        const parts = "[data-curve-node], [data-curve-segment]";
        const move = async (point: Point) => {
            await pointer("mouseMoved", pixels(await frame(), point), 0, "none");
            await paint();
        };
        const active = (selector: string) => evaluate(s => document.querySelector(s)?.getAttribute("aria-pressed"), selector);
        const title = () => evaluate(() => document.querySelector<HTMLInputElement>(".property-title input")?.value);
        const fills = () => evaluate(() => window.curveMapProbe.geometryFills);
        const strokes = () => evaluate(() => window.curveMapProbe.strokes);
        const depth = async () => (await frame()).selectionPath?.length ?? 0;
        const outline = literalCurve(design, curveId(design, "T"));
        const first = async () => pixels(await frame(), outline.nodes[0].p, true);
        const accentStroke = async () => {
            const start = await first();
            return (await strokes()).find(s => s.color === mapColors.light.accent && s.width === 4 &&
                s.points.some(point => distance(point, start) < .02));
        };
        await click("[data-tab=layers]");
        await click("input[data-layer=issues]");
        await move(p);
        await tap(p);
        assert.equal(await title(), "T");
        assert.equal(await depth(), 1);
        await tap(p);
        assert.equal(await depth(), 2);
        assert.equal(await text(row), "轮廓 1");
        assert(await evaluate(s => !!document.querySelector(s)?.parentElement?.classList.contains("selected"), row));
        assert.equal(await active(curveInput), "false");
        assert.equal(await text(parts), "");
        assert.deepEqual((await accentStroke())?.dash, []);
        await move(away);
        assert(!(await fills()).includes(.14));
        await screenshot("round43-outline");
        await move(p);
        assert((await fills()).includes(.1));
        await tap(p);
        assert.equal(await depth(), 3);
        assert.equal(await active(tab), "true");
        assert.equal(await title(), design.geometry[curveId(design, "T")].label);
        assert.deepEqual((await accentStroke())?.dash, []);
        assert((await fills()).includes(.14));
        const vertexScreen = await first();
        assert((await evaluate(() => window.curveMapProbe.dots)).some(dot => distance(dot.point, vertexScreen) < .02));
        await tap(p);
        assert.equal(await depth(), 3);
        await move(away);
        await screenshot("round43-closed-curve");

        await tap(outline.nodes[0].p);
        assert.equal(await text("[data-curve-node] .subitem-label"), "节点 1");
        await move(outline.nodes[1].p);
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "vertex");
        await tap(outline.nodes[1].p);
        assert.equal(await text("[data-curve-node] .subitem-label"), "节点 2");
        await tap(p);
        assert.equal(await depth(), 3);

        const dx = 30 / (await frame()).scale;
        await drag(outline.nodes[0].p, 2);
        assert.equal(await depth(), 4);
        assert.equal(await text("[data-curve-node] .subitem-label"), "节点 1");
        const { nodes } = literalCurve(await authored(), curveId(design, "T"));
        const [x, y] = outline.nodes[0].p;
        assert(distance(nodes[0].p, [x + dx, y]) < .02);
        assert.deepEqual(nodes.slice(1), outline.nodes.slice(1));
        await undo();
        await tap(p);
        assert.equal(await depth(), 3);

        await click("[data-property-tab=function]"); await paint();
        assert.equal(await depth(), 1);
        assert.equal(await title(), "T");
        assert.equal(await active("[data-property-tab=function]"), "true");
        assert.equal(await accentStroke(), undefined);
        await tap(p); await tap(p);
        assert.equal(await depth(), 3);

        await click("[data-property-tab=region]"); await paint();
        assert.equal(await depth(), 2);
        assert.equal(await active(curveInput), "false");
        assert(await evaluate(s => !!document.querySelector(s)?.parentElement?.classList.contains("selected"), row));
        await click(curveInput);
        const pick = ".property-title button[aria-label=选取或重画轮廓]";
        await click(pick);
        await move([18, 16]);
        assert((await fills()).includes(.1));
        assert((await strokes()).some(s => s.color === mapColors.light.parameterGeometry && s.width === 2 && !s.dash.length));
        await move([21, 19]);
        assert((await fills()).includes(.1));
        await tap([21, 19]);
        await saved(); await paint();
        const d = await authored();
        assert.equal(curveId(d, "T"), curveId(d, "B"));
        assert.equal(await title(), d.geometry[curveId(d, "B")].label);
        assert.equal(await depth(), 3);
        await key("Delete");
        assert.match(await text("#remove-dialog"), /仍在使用/);
        await click("#remove-dialog button[value=cancel]");

        const ridgeNode = ridge.nodes[0].p;
        await tap(ridgeNode); await tap(ridgeNode);
        assert.equal(await depth(), 2);
        assert.equal(await active("#properties .geometry-box[aria-label=山脊线]"), "false");
        assert.equal(await text(parts), "");
        await tap(ridgeNode); await tap(ridgeNode);
        assert.equal(await depth(), 4);
        assert.equal(await text("[data-curve-node] .part-title"), "山脊 1");
        assert.equal(await text("[data-curve-node] .subitem-label"), "节点 1");
        const height = () => evaluate(point => {
            const { terrain } = window.curveMapProbe.editor!.project;
            return terrain.fields.height.values[terrain.grid.index(...point)];
        }, ridgeNode);
        const before = await height();
        await click("[data-curve-node] .parameter-row:has(.numeric-face[aria-label=高度]) button.step[aria-label^=增大]");
        await saved(); await paint();
        assert(await height() > before);
        await evaluate(() => document.querySelector<HTMLCanvasElement>("#map")!.focus());
        for (const after of [3, 2, 1, 0]) {
            await key("Escape"); await paint();
            assert.equal(await depth(), after);
        }

        const mark: Point = [32, -12];
        await tap(mark); await tap(mark);
        assert.equal((await frame()).selectionPath?.[1]?.kind, "geometry");
        const at = pixels(await frame(), mark, true);
        assert((await evaluate(() => window.curveMapProbe.arcStrokes)).some(arc => arc.radius === 7 && arc.width === 2 && distance(arc.point, at) < .02));
    }, design);
}

export function checkMapHints(url: string) {
    return withCurveMap(url, "round43-map-hints", async ({ cdp, evaluate, key, moveOverMap, paint, pointer, screenshot, wait }) => {
        const bar = "#mode-hint", more = "#mode-hint .hint-more", popup = "[data-mode-hint-details]";
        const primaries = ["逐层选中", "回到上一层", "切换重叠的对象"];
        const all = [...primaries, "打开菜单", "拖动平移", "缩放"];
        const texts = (selector: string) => evaluate(s => [...document.querySelectorAll(s + " .hint-text")].map(el => el.textContent), selector);
        const hoverBar = async () => {
            const at = await evaluate(s => {
                const box = document.querySelector(s + " .hint-entry")!.getBoundingClientRect();
                return [box.left + box.width / 2, box.top + box.height / 2] as Point;
            }, bar);
            await pointer("mouseMoved", at, 0, "none");
            await wait(s => document.querySelector(s + ":popover-open"), popup);
        };
        const clip = (selectors: string[]) => evaluate(selectors => {
            const boxes = selectors.map(s => document.querySelector(s)!.getBoundingClientRect());
            const x = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.left))) - 8);
            const y = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.top))) - 8);
            return { x, y, width: Math.ceil(Math.max(...boxes.map(b => b.right))) + 8 - x,
                height: Math.ceil(Math.max(...boxes.map(b => b.bottom))) + 8 - y };
        }, selectors);

        await wait(s => document.querySelectorAll(s + " > .hint-entry").length === 3, bar);
        assert.deepEqual(await texts(bar), primaries);
        assert.equal(await evaluate(s => document.querySelector(s)?.getAttribute("aria-label"), more), "更多操作");
        assert(!await evaluate(s => document.querySelector(s)?.matches(":popover-open"), popup));
        await moveOverMap();
        await screenshot("round43-fix-hints-wide");
        await hoverBar();
        assert.deepEqual(await texts(popup), all);
        const symbols = await evaluate(s => {
            const panel = document.querySelector(s)!;
            return {
                keys: [...panel.querySelectorAll("kbd")].map(el => [el.textContent, el.getBoundingClientRect().height]),
                mice: [...panel.querySelectorAll(".hint-mouse")].map(el => {
                    const svg = el.querySelector("svg")!;
                    return [el.querySelector(".mouse-name")?.textContent, svg.getAttribute("viewBox"), getComputedStyle(svg).width];
                })
            };
        }, popup);
        assert.deepEqual(symbols.keys, [["Esc", 18], ["Alt", 18], ["Space", 18]]);
        assert.deepEqual([...new Map(symbols.mice.map(([name, ...appearance]) => [name, appearance]))], [
            ["左键", ["0 0 18 18", "14px"]], ["右键", ["0 0 18 18", "14px"]],
            ["中键", ["0 0 18 18", "14px"]], ["滚轮", ["0 0 18 18", "14px"]]
        ]);
        const popupBox = await clip([bar, popup]);
        await screenshot("round43-fix-hints-details", popupBox);
        await pointer("mouseMoved", [popupBox.x + 15, popupBox.y + 15], 0, "none");
        assert(await evaluate(s => document.querySelector(s)?.matches(":popover-open"), popup));
        await moveOverMap();
        await wait(s => !document.querySelector(s)?.matches(":popover-open"), popup);

        await evaluate(() => document.querySelector<HTMLButtonElement>("#fit")!.focus());
        await key("Tab");
        await wait(s => document.querySelector(s + ":popover-open"), popup);
        assert(await evaluate(s => document.activeElement?.matches(s), more));
        await key("Escape");
        await wait(s => !document.querySelector(s)?.matches(":popover-open"), popup);

        for (const [width, count] of [[480, 2], [375, 1]]) {
            await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
            await moveOverMap(); await paint();
            assert.deepEqual(await texts(bar), primaries.slice(0, count));
            const fits = await evaluate(s => {
                const chip = document.querySelector<HTMLElement>(s)!, box = chip.getBoundingClientRect();
                const position = document.querySelector("#position")!.getBoundingClientRect();
                const zoom = document.querySelector(".zoom-tools")!.getBoundingClientRect();
                return chip.scrollWidth <= chip.clientWidth && getComputedStyle(chip).textOverflow === "clip" &&
                    box.bottom < position.top && box.right <= zoom.left;
            }, bar);
            assert(fits);
            await screenshot(width === 375 ? "round43-fix-hints-narrow" : "round43-fix-hints-medium");
            await hoverBar();
            assert.deepEqual(await texts(popup), all);
            await moveOverMap();
        }
    });
}