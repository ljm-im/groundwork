import assert from "node:assert/strict";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { mapColors } from "../../src/render/palette.ts";
import { fixtureMark, literalCurve, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkGeometryObjects(url: string) {
    const design: Design = syntheticDesign();
    const position: Point = [-20, 22];
    design.marks.push(fixtureMark(design, { id: "A", label: "测点 A", kind: "text", point: position, follow: "map" }));
    return withCurveMap(url, "round42-geometry", async page => {
        const { authored, click, disk, drag, evaluate, frame, key, paint, saved, screenshot, tap, text, tool, undo, wait } = page;
        const row = "#properties .geometry-box[aria-label=曲线]";
        const region = "[data-property-tab=region]", geometry = "[data-property-tab=geometry]";
        const list = (id: string) => "[data-select-geometry=" + JSON.stringify(id) + "]";
        const menu = ".reference-menu[aria-label=引用曲线]";
        const outline = (d: Design, id: string) => {
            const c = d.geoNodes.find(n => n.id === id)!.construction;
            assert(c.type === "outline" && "curve" in c.outlines[0]);
            return c.outlines[0];
        };
        const visible = (selector: string) => evaluate(s => !!document.querySelector(s), selector);
        const independentCheckbox = () => evaluate(() => {
            const label = [...document.querySelectorAll<HTMLLabelElement>("#properties label")].find(node => node.textContent === "独立");
            return "#" + CSS.escape(label!.htmlFor);
        });
        async function selectOutline(id: string) {
            await click("[data-tab=terrain]");
            await click("[data-geo-node=" + JSON.stringify(id) + "]");
            await click(region);
            if (!await visible(row)) await click("[data-outline] .subitem-toggle");
        }
        async function useCurve(id: string) {
            await click("#properties .geometry-reference");
            await click(menu + " [data-option=" + JSON.stringify("curve:" + id) + "]");
            await saved();
            await paint();
        }

        await selectOutline("T");
        const original = outline(await authored(), "T"), label = design.geometry[original.curve].label;
        await click("[data-tab=inputs]");
        assert.equal(await evaluate(() => [...document.querySelector(".part:has([data-add=geometry])")!.children].slice(1).length), 0);
        await selectOutline("T");
        assert.equal(await text(row), label);
        await click(row);
        assert.equal((await frame()).selection?.id, "T");
        assert.equal(await evaluate(s => document.querySelector(s)?.getAttribute("aria-label"), geometry), label);
        assert(await visible(".side-tabs hr"));
        await tap(literalCurve(design, original).nodes[0].p);
        assert(await visible("[aria-label=节点类型]"));
        assert(!await visible("[data-curve-node] [aria-label=高度]"));
        await click(region);
        assert(!await visible(geometry));
        assert.equal(await evaluate(s => document.querySelector(s)?.getAttribute("aria-pressed"), row), "false");
        assert(await visible("[data-outline].selected"));

        await click("[data-tab=inputs]");
        assert(!await visible(list(original.curve)));
        await click("[data-add=geometry]");
        await click(".creation-menu [data-option=geometryClosed]");
        assert.equal(await text(".drawing-status strong"), "新建闭合曲线");
        for (const p of [[-28, 4], [-10, 4], [-14, 15]] as Point[]) await tap(p, 2);
        await key("Enter"); await saved(); await paint();
        const listedId = (await frame()).selection!.id, created = await authored();
        assert(created.geometry[listedId].independent && literalCurve(created, listedId).closed);
        assert(await visible(list(listedId)));
        assert(!await visible("#properties .side-tabs"));
        const nodeTitle = "[data-curve-node] .subitem-label", segmentTitle = "[data-curve-segment] .subitem-label";
        assert.equal(await text(nodeTitle), "节点 1");
        assert.equal(await text(segmentTitle), "线段 1");
        await click("[data-curve-node] [aria-label=下一个节点]"); await paint();
        assert.equal((await frame()).vertex?.index, 1);
        assert.equal(await text(nodeTitle), "节点 2");
        assert.equal(await text(segmentTitle), "线段 1");
        await click("[data-curve-segment] [aria-label=下一个线段]"); await paint();
        assert.equal((await frame()).vertex?.role, "segment");
        assert.equal(await text(nodeTitle), "节点 2");
        assert.equal(await text(segmentTitle), "线段 2");

        await selectOutline("T");
        await useCurve(listedId);
        assert.equal(outline(await authored(), "T").curve, listedId);
        assert(!Object.hasOwn((await authored()).geometry, original.curve));
        await click("#properties [aria-label=删除地件]"); await saved(); await paint();
        assert(Object.hasOwn((await authored()).geometry, listedId));
        await click("[data-tab=inputs]");
        assert(await visible(list(listedId)));

        async function rectangle(from: Point, to: Point) {
            await tool("地件", "rect");
            await tap(from, 2); await tap(to, 2); await saved(); await paint();
            return (await frame()).selection!.id;
        }
        const a = await rectangle([-24, -26], [-10, -12]), shapeId = outline(await authored(), a).curve;
        await click("[data-tab=inputs]");
        assert(!await visible(list(shapeId)));
        const b = await rectangle([5, -26], [18, -12]);
        await selectOutline(b);
        const other = literalCurve(await authored(), shapeId);
        const pick = "#properties [aria-label=选取或重画轮廓]";
        const pickPoint: Point = [(other.nodes[0].p[0] + other.nodes[1].p[0]) / 2, other.nodes[0].p[1]];
        const initial = await authored();
        await click(pick);
        assert.match(await text(".drawing-status strong"), /^选取或重画“.+”的轮廓 1$/);
        assert.equal(await text(".drawing-status > span"), "单击曲线换用它，单击空白处开始画，按住 Ctrl 单击在曲线上开始画，Esc 取消");
        await tap(pickPoint);
        await saved(); await paint();
        const picked = await authored();
        assert.equal(outline(picked, b).curve, shapeId);
        await undo();
        assert.deepEqual(await authored(), initial);
        await selectOutline(b);
        await useCurve(shapeId);
        assert.deepEqual(await authored(), picked);
        const unchanged = await disk();
        const unused = literalCurve(await authored(), listedId);
        const edge: Point = [(unused.nodes[0].p[0] + unused.nodes[1].p[0]) / 2, unused.nodes[0].p[1]];
        await click(pick);
        await tap(edge, 2);
        assert.match(await text(".drawing-status strong"), /^重画“/);
        const first = await evaluate(() => window.curveMapProbe.editor!.geoDraft!.nodes[0].p);
        assert(Math.abs(first[0] - edge[0]) < .2 && Math.abs(first[1] - edge[1]) < .2);
        await key("Escape");
        assert.equal(await disk(), unchanged);
        await click(pick);
        await tap([34, -30], 2);
        assert.equal(await evaluate(() => window.curveMapProbe.editor!.geoDraft!.nodes.length), 1);
        await key("Escape");
        assert.equal(await disk(), unchanged);

        await click("[data-tab=inputs]");
        assert(!await visible(list(shapeId)));
        await selectOutline(b);
        await click(row);
        await click("#properties [aria-label=删除曲线]");
        assert.match(await text("#remove-dialog"), /以下位置仍在使用它，请先修改。/);
        await click("#remove-dialog button[value=cancel]");
        await click(await independentCheckbox());
        await saved(); await paint();
        await click("[data-tab=inputs]");
        assert(await visible(list(shapeId)));
        await click(list(shapeId));
        await click("#properties [aria-label=删除曲线]");
        assert.match(await text("#remove-dialog"), /以下位置仍在使用它，请先修改。/);
        assert.equal(await evaluate(() => document.querySelectorAll("#remove-dialog li").length), 2);
        await click("#remove-dialog button[value=cancel]");
        for (const id of [a, b]) {
            await selectOutline(id);
            await click("#properties [aria-label=删除地件]");
            await saved(); await paint();
        }
        assert((await authored()).geometry[shapeId].independent);
        await click("[data-tab=inputs]");
        const face: Point = [-17, 8];
        await tap(face);
        assert.notEqual((await frame()).selection?.id, listedId);
        await click("[data-tab=inputs]");
        const fills = () => evaluate(() => window.curveMapProbe.geometryFills);
        const listBox = await evaluate(sel => {
            const { left, top, width, height } = document.querySelector(sel)!.getBoundingClientRect();
            return [left + width / 2, top + height / 2] as Point;
        }, list(listedId));
        await page.pointer("mouseMoved", listBox, 0, "none"); await paint();
        assert.deepEqual(await fills(), [.06]);
        await click("[data-tab=layers]");
        const checkbox = "[data-layer=geometry]";
        assert.equal(await evaluate(s => (document.querySelector(s) as HTMLInputElement).checked, checkbox), false);
        await click(checkbox); await paint();
        assert.deepEqual(await fills(), []);
        assert(await evaluate(() => JSON.parse(localStorage.getItem("groundwork/map-display-v1")!).layers.geometry));
        await tap(face, 1);
        assert.deepEqual((await frame()).selection, { kind: "geometry", id: listedId });
        assert(await visible(list(listedId)));
        assert.deepEqual(await fills(), [.1]);
        await page.pointer("mouseMoved", page.pixels(await frame(), face), 0, "none"); await paint();
        assert.deepEqual(await fills(), [.1]);
        const geometryCurve = literalCurve(await authored(), listedId);
        await tap(geometryCurve.nodes[0].p);
        assert.equal((await frame()).vertex?.role, "vertex");
        await page.pointer("mouseMoved", page.pixels(await frame(), [0, -30]), 0, "none"); await paint();
        assert.deepEqual(await fills(), [.1]);
        await drag(face, 2);
        const movedCurve = literalCurve(await authored(), listedId);
        const dx = 30 / (await frame()).scale;
        page.translated(geometryCurve.nodes.map(n => n.p), movedCurve.nodes.map(n => n.p), dx);

        await click("[data-tab=marks]");
        await click("[data-mark=A]"); await paint();
        assert.match(await text("#properties .geometry-box[aria-label=位置]"), /^点 \d+$/);
        await click("#properties .geometry-box[aria-label=位置]");
        assert(await visible(geometry));
        assert(await visible("[data-property-tab=general][aria-label=文字标记]"));
        await tap(position);
        await key("Delete");
        assert.match(await text("#remove-dialog"), /测点 A/);
        await click("#remove-dialog button[value=cancel]");
        await click("[data-property-tab=general]"); await paint();
        const clip = await evaluate(({ position, light, dark }) => {
            const map = window.curveMapProbe.editor!.map, [x, y] = map.screen(position);
            const bounds = map.canvas.getBoundingClientRect(), { dpr } = map;
            const color = document.documentElement.dataset.theme === "dark" ? dark : light;
            const found = [...map.ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data].slice(0, 3);
            return { found, color, x: Math.floor(bounds.left + x - 14), y: Math.floor(bounds.top + y - 17), width: 91, height: 34 };
        }, { position, light: mapColors.light.text, dark: mapColors.dark.text });
        const { found, color, ...box } = clip;
        assert.deepEqual(found, color.slice(1).match(/../g)!.map(s => Number.parseInt(s, 16)));
        await screenshot("round42-text-mark", box);

        await click("[data-tab=inputs]");
        await click("[data-add=geometry]");
        await click(".creation-menu [data-option=geometryPoint]");
        await tap([12, 12], 2); await saved(); await paint();
        const pointId = (await frame()).selection!.id;
        await wait(() => !!document.querySelector("#properties [aria-label=点名称]"));
        assert(await visible(list(pointId)));
        const point = (await authored()).geometry[pointId];
        assert("point" in point);
        await page.drag(point.point, 2);
        const moved = (await authored()).geometry[pointId];
        assert("point" in moved && moved.point[0] > point.point[0]);
        await click("#properties [aria-label=复制点]");
        await saved(); await paint();
        const copyId = (await frame()).selection!.id;
        assert.notEqual(copyId, pointId);
        await click("#properties [aria-label=删除点]"); await saved();
        assert(!Object.hasOwn((await authored()).geometry, copyId));
        await click(list(pointId));
        await click(await independentCheckbox()); await saved(); await paint();
        assert(!Object.hasOwn((await authored()).geometry, pointId));
        await undo();
        assert((await authored()).geometry[pointId].independent);
    }, design);
}