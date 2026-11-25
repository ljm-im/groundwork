import assert from "node:assert/strict";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { flattenPath, pathBezier, segmentType, splitBezier } from "../../src/core/design/path.ts";
import { geometryPath, type GeoControl, type GeometryTarget } from "../../src/core/edit/geoControls.ts";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { type Curve, type Point, type Section } from "../../src/core/design/v5.ts";
import { distance, mixPoint } from "../../src/core/math/geometry.ts";
import { layer, openCurve, rect, syntheticDesign } from "../scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./filePickers.ts";
import { checkLineDragging } from "./mapSelection.ts";
import { withLayeredMap } from "./layeredMapFixture.ts";
import { withCurveMap } from "./curveMapFixture.ts";
import { pathHandle } from "../../src/core/design/path.ts";
import { overlay } from "../../src/render/palette.ts";

interface Frame {
    origin: Point; scale: number; selected?: string; geometry?: GeometryTarget; vertex?: GeoControl;
    ridgePreview?: Curve; section?: Section["points"]; height?: number;
}
interface Probe { frame?: Frame }
declare global {
    interface Window { curveEditingProbe: Probe }
}

async function observeCurveEditing() {
    const probe: Probe = {};
    window.curveEditingProbe = probe;
    const mapModule = "/src/render/map.ts", terrainModule = "/src/core/design/results.ts";
    const { ProjectMap } = await import(mapModule) as typeof import("../../src/render/map.ts");
    const { sampleField } = await import(terrainModule) as typeof import("../../src/core/design/results.ts");
    const draw = ProjectMap.prototype.draw;
    ProjectMap.prototype.draw = function (view, theme) {
        draw.call(this, view, theme);
        const canvas = document.querySelector("#map")!.getBoundingClientRect(), [x, y] = this.screen([0, 0]);
        const dragged = view.dragNode?.function;
        probe.frame = { origin: [canvas.left + x, canvas.top + y], scale: this.scale, selected: view.selection?.id,
            geometry: view.geometry, vertex: view.vertex, ridgePreview: dragged?.type === "mountain" ? dragged.ridges[0].line : undefined,
            section: view.project.design.sections.find(s => s.id === "Q")?.points,
            height: sampleField(view.project.terrain, "height", [-23, 5]) };
    };
}

async function checkDrawnCurves(url: string) {
    const design = syntheticDesign(), filename = "drawn-curve-editing.json";
    const mountain = { ...layer("M", rect(-45, -33, 12, 30), defaultFunction("mountain")), label: "山" };
    const slope = { ...layer("S", rect(17, -24, 53, 24), {
        type: "slope", kind: "path", line: openCurve([{ p: [20, -18], h: 0 }, { p: [49, -18], h: 2 }])
    }), label: "坡面" };
    design.geoNodes = [layer("G", rect(-60, -47, 60, 47), { type: "ground", value: 4 }), mountain, slope];
    design.sections = [{ id: "Q", label: "剖面线 Q", points: [[-48, -37], [35, -37]], showLabel: false }];
    const browser = await startChromium(), { cdp, click, evaluate, key, mouse, wait } = browser;
    const frame = () => evaluate(() => window.curveEditingProbe.frame!);
    const saved = () => wait(() => !document.querySelector(".map-wrap[data-busy=true]") &&
        document.querySelector("#save-state")?.textContent === "已保存");
    const paint = () => evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const text = (selector: string) => evaluate(s => document.querySelector<HTMLElement>(s)?.innerText.trim() ?? "", selector);
    const disk = () => evaluate(name => window.disk(name), filename);
    const authored = async () => parseDesign(await disk(), true);
    const undo = async () => {
        await click("#undo"); await saved(); await paint();
    };
    async function screen([x, y]: Point): Promise<Point> {
        const { origin, scale } = await frame();
        return [origin[0] + x * scale, origin[1] - y * scale];
    }
    async function tap(p: Point, button = "left", clickCount = 1) {
        const [x, y] = await screen(p);
        for (const type of ["mousePressed", "mouseReleased"])
            await cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount });
    }
    async function drag(a: Point, b: Point, preview?: () => Promise<void>) {
        await mouse("mousePressed", ...a);
        await mouse("mouseMoved", ...b);
        await preview?.();
        await mouse("mouseReleased", ...b);
    }
    async function screenshot(name: string, reveal?: string, crop?: [Point, Point]) {
        if (!process.env.GROUNDWORK_BROWSER_OUTPUT) return;
        await wait(() => !document.querySelector("#toast")?.textContent?.trim());
        if (reveal) {
            await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1320, deviceScaleFactor: 1, mobile: false });
            await paint();
            await evaluate(s => document.querySelector(s)!.scrollIntoView({ block: "start" }), reveal);
        }
        await paint();
        let clip;
        if (crop) {
            const [x, y] = await screen(crop[0]), [right, bottom] = await screen(crop[1]);
            clip = { x, y, width: right - x, height: bottom - y };
        }
        await browser.screenshot(name, clip);
        if (reveal) {
            await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
            await paint();
        }
    }
    const nodeRow = (id: string) => "[data-curve-node=" + JSON.stringify(id) + "]";
    const ridge = async (i = 0) => {
        const n = (await authored()).geoNodes.find(n => n.id === "M")!;
        return geometryPath(n, -1 - i)!;
    };
    const section = async () => (await authored()).sections[0].points;
    const ridgeInput = "button.geometry-box[aria-label=山脊线]";
    async function closedCheckbox(index: number) {
        return await evaluate(({ index, selector }) => {
            const input = document.querySelectorAll(selector)[index]?.closest(".parameter-row")?.nextElementSibling?.querySelector("input");
            if (!input) throw Error("The ridge has no closed checkbox");
            return { id: input.id, checked: input.checked, disabled: input.disabled };
        }, { index, selector: ridgeInput });
    }
    try {
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await cdp("Page.navigate", { url });
        await wait(() => !!document.querySelector(".empty-state"));
        await evaluate(observeCurveEditing);
        await evaluate(async ({ filename, bytes }) => {
            window.probe.openName = filename;
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle(filename, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
        }, { filename, bytes: serializeDesign(design) });
        await click("#open");
        await wait(name => document.querySelector("#filename")?.textContent === name && !!window.curveEditingProbe.frame, filename);
        await saved();
        await click("#fit"); await paint();

        console.log("boundaries derive their segment types from handles");
        await click("button[aria-label=新建地件]");
        await click(".creation-menu [data-option=pen]");
        for (const p of [[15, 28], [28, 37], [42, 26]] as Point[]) await tap(p);
        await key("Enter"); await saved(); await paint();
        const id = (await frame()).selected!;
        assert(!["G", "M", "S"].includes(id));
        const boundary = async () => geometryPath((await authored()).geoNodes.find(n => n.id === id)!, 0)!;
        const before = await boundary();
        assert.deepEqual(before.nodes.map((_, i) => segmentType(before, i)), ["line", "line", "line"]);
        await tap(before.nodes[1].p);
        await click("[aria-label=节点类型] button[aria-label=自动平滑]");
        await saved();
        const smoothed = await boundary(), edges = flattenPath(smoothed, .125);
        assert.equal(smoothed.nodes[1].mode, "auto");
        for (const { id } of smoothed.nodes.slice(0, 2)) assert(edges.filter(e => e.from === id).length > 1);
        await screenshot("region-node");
        await undo();
        const unchanged = before.nodes.slice(1).map(v => flattenPath(before, .125).filter(e => e.from === v.id));
        const middle = mixPoint(before.nodes[0].p, before.nodes[1].p, .5);
        await tap(middle, "right");
        await click(".context-menu [data-option=curve]");
        await saved();
        const bent = await boundary();
        assert.equal(segmentType(bent, 0), "curve");
        assert(flattenPath(bent, .125).filter(e => e.from === bent.nodes[0].id).length > 1);
        assert.deepEqual(bent.nodes.slice(1).map(v => flattenPath(bent, .125).filter(e => e.from === v.id)), unchanged);
        await tap(splitBezier(pathBezier(bent, 0), .5)[0][3], "right");
        await click(".context-menu [data-option=line]");
        await saved();
        assert.deepEqual(await boundary(), before);

        console.log("ridge pen handles, inspector selection and height edits");
        await click("[data-geo-node=M]");
        await click("[data-property-tab=function]");
        await click("button[aria-label=添加山脊]");
        assert.equal(await text("#mode-hint"), "单击放置节点，按 S 切换尖角和自动平滑，回车或双击结束，单击首个节点闭合，Esc 取消");
        assert.match(await text(".drawing-status"), /回车或双击结束，单击首个节点闭合/);
        await tap([-36, -12]);
        await drag(await screen([-23, 5]), await screen([-18, 8]));
        await tap([-7, -6]);
        await key("Enter"); await saved(); await paint();
        let line = await ridge();
        assert.equal(line.closed, false);
        assert.deepEqual(line.nodes.map(v => v.mode), ["auto", "manual", "auto"]);
        assert.match(await text(ridgeInput), /曲线（3 个节点）/);
        assert.equal((await closedCheckbox(0)).checked, false);
        const second = nodeRow(line.nodes[1].id), third = nodeRow(line.nodes[2].id);
        await tap(line.nodes[1].p); await paint();
        assert.equal((await frame()).vertex?.index, 1);
        assert.deepEqual((await frame()).geometry, { kind: "path", index: -1 });
        await screenshot("ridge-node", ".subitem:has(" + ridgeInput + ") > .subitem-heading");
        await screenshot("ridge-handles", undefined, [[-41, 13], [-2, -17]]);
        assert.equal(await evaluate(s => !!document.querySelector(s + " .subitem-toggle"), second), false, "The selected node is always expanded");
        assert.equal((await frame()).vertex?.index, 1);
        await evaluate(() => document.querySelector("#property-content")!.scrollTop = 0);
        await tap(line.nodes[2].p);
        await wait(selector => {
            const row = document.querySelector(selector + " .subitem-heading"), panel = document.querySelector("#property-content")!.getBoundingClientRect();
            const box = row?.getBoundingClientRect();
            return row && box && box.top >= panel.top && box.bottom <= panel.bottom;
        }, third);
        for (const row of [second, third])
            assert.equal(await evaluate(s => !!document.querySelector(s + " [aria-label=线段类型]"), row), false);
        await tap(line.nodes[1].p);
        const priorHeight = (await frame()).height!;
        await click(second + " button.numeric-face[aria-label=高度]");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "14" });
        await key("Enter"); await saved(); await paint();
        line = await ridge();
        assert.equal(line.nodes[1].h, 14);
        assert((await frame()).height! > priorHeight + 2);

        console.log("insertion keeps ridge endpoint modes and deletion stops at two nodes");
        const insert = splitBezier(pathBezier(line, 0), .5)[0][3];
        await tap(insert, "right"); await click(".context-menu [data-option=insert-node]");
        await saved(); await paint();
        line = await ridge();
        assert.equal(line.nodes.length, 4);
        assert.deepEqual(line.nodes.map(n => n.mode), ["auto", "auto", "manual", "auto"]);
        assert(distance(line.nodes[1].p, insert) < .25);
        assert.equal((await frame()).vertex?.index, 1);
        await tap(line.nodes[1].p);
        await click(nodeRow(line.nodes[1].id) + " [aria-label=删除节点]"); await saved();
        line = await ridge();
        await tap(line.nodes[2].p);
        await click(nodeRow(line.nodes[2].id) + " [aria-label=删除节点]"); await saved();
        line = await ridge();
        assert.equal(line.nodes.length, 2);
        assert((await closedCheckbox(0)).disabled);
        assert.equal(await evaluate(() => document.querySelectorAll("#properties [aria-label=删除节点]").length), 0);
        await tap(line.nodes[0].p, "right");
        assert.equal(await evaluate(() => !!document.querySelector(".context-menu [data-option=delete-node]")), false);
        await key("Escape");
        assert.doesNotMatch(await text("#properties"), /平滑折线|顶点 \d+ 高度/);

        console.log("drawing and reopening a closed ridge removes its closing handles");
        await click("button[aria-label=添加山脊]");
        const closedPoints: Point[] = [[-29, 19], [-13, 22], [-8, 14]];
        await drag(await screen(closedPoints[0]), await screen([-28, 23]));
        await tap(closedPoints[1]); await tap(closedPoints[2]);
        await tap(closedPoints[0]); await saved(); await paint();
        const closed = await ridge(1), checkbox = await closedCheckbox(1);
        assert.equal(closed.closed, true);
        assert.equal(checkbox.checked, true);
        const summary = await evaluate(s => [...document.querySelectorAll(s)].map(el => el.textContent?.trim()), ridgeInput);
        assert(summary.includes("闭合曲线（3 个节点）"));
        await screenshot("closed-ridge", ".subitem:has(input[id=" + JSON.stringify(checkbox.id) + "]) > .subitem-heading");
        await click("input[id=" + JSON.stringify(checkbox.id) + "]"); await saved();
        const reopened = await ridge(1);
        assert.equal(reopened.closed, false);
        assert.equal(reopened.nodes[0].in, undefined);
        assert.equal(reopened.nodes[0].mode, "corner");
        assert.equal(reopened.nodes.at(-1)?.out, undefined);
        assert.equal(reopened.nodes.at(-1)?.bulge, undefined);
        await undo();

        await checkLineDragging({ click, authored, drag, frame, mountain, paint, ridge, saved, screen, section, text, undo });
    }
    finally {
        await browser.close();
    }
}

export async function checkCurveEditing(url: string) {
    await checkDrawnCurves(url);
    await withLayeredMap(url, "boundary-controls", async ({ at, authored, cdp, click, drag, evaluate, fit, key, panel, point, property, saved, screenshot, tap, text, undo, wait }) => {
        const region = "[data-geo-node=A]", status = ".drawing-status";
        console.log("boundary controls, confirmation and clipped menu");
        await panel("terrain"); await click(region); await property("region"); await fit();
        assert.doesNotMatch(await text("#properties"), /构造方式/);
        assert.match(await text("button[aria-label=值]"), /闭合曲线（4 个节点）/);
        const deleteBoundary = "button[aria-label=\"删除轮廓\"]";
        assert.equal(await evaluate(s => document.querySelectorAll(s).length, deleteBoundary), 0);
        await screenshot("boundary-one");
        await click("button[aria-label=添加轮廓]");
        assert.equal(await evaluate(() => document.querySelector("button[aria-label=添加轮廓]")?.getAttribute("aria-pressed")), "true");
        assert.equal(await text(status + " strong"), "给“台地 A”添加轮廓");
        for (const p of [[-32, 4], [-28, 4], [-30, 9]] as Point[]) await tap(await at(p));
        await key("Enter"); await saved();
        assert.equal(await evaluate(s => document.querySelectorAll(s).length, deleteBoundary), 2);
        const boundaries = await evaluate(() => [...document.querySelectorAll(".subitem-toggle")].map(el => el.textContent?.trim()));
        assert.deepEqual(boundaries, ["轮廓 1", "轮廓 2"]);
        const row2 = ".subitem:has(> .subitem-heading " + deleteBoundary + "):nth-of-type(2)";
        const boundary2 = await evaluate(() => [...document.querySelectorAll(".subitem-toggle")]
            .find(el => el.textContent?.trim() === "轮廓 2")?.getAttribute("aria-expanded"));
        assert.equal(boundary2, "true");
        await tap(await at([-32, 4]));
        const selectedNode = ".subitem[data-curve-node]";
        await wait(s => !!document.querySelector(s), selectedNode);
        assert.equal(await evaluate(s => document.querySelector(s)?.parentElement?.closest(".subitem")
            ?.querySelector(".subitem-toggle")?.textContent?.trim(), selectedNode), "轮廓 2");
        assert.equal(await evaluate(() => [...document.querySelectorAll("#properties h3")].some(h => h.textContent?.trim() === "节点")), false);
        const [rowX, rowY] = await point(row2);
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: rowX, y: rowY });
        await wait(s => getComputedStyle(document.querySelector(s)!).opacity === "1", row2 + " " + deleteBoundary);
        await screenshot("boundaries-two");
        await click(row2 + " " + deleteBoundary);
        assert.equal(await text("#remove-dialog h2"), "删除这条轮廓？");
        assert.equal(await text("#remove-dialog button[value=remove]"), "删除轮廓");
        await click("#remove-dialog button[value=remove]");
        await wait(s => !document.querySelector(s), deleteBoundary);
        await saved();
        assert.equal(await evaluate(s => document.querySelectorAll(s).length, deleteBoundary), 0);

        const upper = await point("[data-split=upper]");
        await drag(upper, [upper[0], upper[1] + 222]);
        await property("function");
        await click("button.choice-face[aria-label=函数]");
        await wait(() => !!document.querySelector(".choices[aria-label=\"函数\"]"));
        const popup = await evaluate(() => {
            const menu = document.querySelector<HTMLElement>(".choices[aria-label=\"函数\"]")!;
            const panel = document.querySelector("#property-content")!.getBoundingClientRect(), style = getComputedStyle(menu);
            return { gap: panel.bottom - menu.getBoundingClientRect().bottom, clipped: menu.scrollHeight > menu.clientHeight,
                radius: style.borderBottomLeftRadius, shadow: style.boxShadow };
        });
        assert(Math.abs(popup.gap - 16) <= 1, JSON.stringify(popup));
        assert(popup.clipped && popup.radius !== "0px" && popup.shadow !== "none");
        await screenshot("clipped-dropdown");
        await key("Escape");

        console.log("rendered ridge geometry opens and scrolls its inspector");
        await click("[data-geo-node=D]");
        const ridge: Point = [3, 31], vertex: Point = [-7, 31];
        await tap(await at(ridge));
        assert.equal(await evaluate(() => document.querySelector("[data-geo-node=D]")?.getAttribute("aria-pressed")), "true");
        await panel("layers"); await click("input[data-layer=geoNodes]");
        await tap(await at(ridge));
        await wait(() => {
            const row = document.querySelector("button.geometry-box[aria-label=山脊线][aria-pressed=true]")?.getBoundingClientRect();
            const panel = document.querySelector("#property-content")!.getBoundingClientRect();
            return !!row && row.top >= panel.top && row.bottom <= panel.bottom && !document.querySelector("[data-curve-segment]");
        });
        assert.equal(await evaluate(() => document.querySelector("[data-geo-node=C]")?.getAttribute("aria-pressed")), "true");
        assert.equal(await evaluate(() => document.querySelector("[data-property-tab=function]")?.getAttribute("aria-pressed")), "true");
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll(".subitem-toggle[aria-expanded=true]")].map(el => el.textContent?.trim())), ["山脊 3"]);
        await tap(await at(vertex));
        const heightRow = "[data-parameter$=\".ridges.2.line.nodes.1.h\"]";
        await wait(s => !!document.querySelector(s), heightRow);
        await click("[data-geo-node=A]");
        await tap(await at(vertex));
        await drag(await at(vertex), await at([-4, 32.3])); await saved();
        const mountain = (await authored()).geoNodes.find(n => n.id === "C")!.function;
        assert(mountain.type === "mountain" && distance(mountain.ridges[2].line.nodes[1].p, [-4, 32.3]) < .3);
        await undo();
    });
    await withCurveMap(url, "curve-controls", async ({ authored, boundary, click, curve, disk, drag, evaluate, frame, key, nodeTitles, paint, pixels, saved, screenshot, tap, text, undo }) => {
        await click("[data-tab=layers]"); await click("input[data-layer=geoNodes]"); await paint();
        const original = await authored(), originalLine = await curve(), alt = 1;
        await click("[data-tab=terrain]"); await click("[data-geo-node=B]"); await paint();
        const b = boundary(original, "B"), edge = mixPoint(b.nodes[2].p, b.nodes[3].p, .5), beforeInsert = await disk();
        await tap(edge, alt);
        assert.equal(await disk(), beforeInsert);
        await tap(edge); await tap(edge, 0, "left", 2); await saved();
        assert.equal(boundary(await authored(), "B").nodes.length, b.nodes.length + 1);
        await undo(); assert.equal(await disk(), beforeInsert);

        await tap([-35, 25]); assert.deepEqual(await nodeTitles(), []);
        await tap(originalLine.nodes[2].p); assert.deepEqual(await nodeTitles(), ["节点 3"]);
        await click("[aria-label=下一个节点]"); await paint();
        assert.deepEqual(await nodeTitles(), ["节点 4"]);
        assert.equal((await frame()).vertex?.index, 3);
        await tap(originalLine.nodes.at(-1)!.p);
        assert(await evaluate(() => document.querySelector<HTMLButtonElement>("[aria-label=下一个节点]")?.disabled));
        await key("Escape"); await paint(); assert.deepEqual(await nodeTitles(), []);
        await click("[data-property-tab=region]");
        const boundaryTwo = ".subitem:has(> .subitem-heading .subitem-toggle span)";
        assert.deepEqual(await evaluate(s => [...document.querySelectorAll(s + " > .subitem-heading .subitem-toggle")]
            .map(el => [el.textContent?.trim(), el.getAttribute("aria-expanded")]), boundaryTwo), [["轮廓 1", "false"], ["轮廓 2", "false"]]);
        await tap([29, 37]); await tap([33, 31]);
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        assert(await evaluate(() => {
            const nested = document.querySelector("[data-curve-node]")?.parentElement?.closest(".subitem");
            return nested?.querySelector(".subitem-toggle")?.textContent?.trim() === "轮廓 2" &&
                ![...document.querySelectorAll("#property-content h3")].some(h => h.textContent === "节点");
        }));
        await click("[aria-label=上一个节点]"); await paint(); assert.deepEqual(await nodeTitles(), ["节点 4"]);
        await key("Escape"); await paint();
        assert.deepEqual(await nodeTitles(), []);
        assert(await evaluate(() => [...document.querySelectorAll(".subitem-toggle")].some(el =>
            el.textContent?.trim() === "轮廓 2" && el.getAttribute("aria-expanded") === "true")));
        await click("[data-geo-node=B]");
        assert.equal(await text("#property-content .subitem-toggle"), "轮廓 1");
        assert(await evaluate(() => !document.querySelector("#property-content [aria-label=删除轮廓]")));

        await tap([-35, 25]);
        const line = await curve();
        const strokeAt = async (index: number) => {
            const f = await frame(), start = pixels(f, line.nodes[index].p, true), end = pixels(f, pathHandle(line, index, "out"), true);
            return (await evaluate(() => window.curveMapProbe.strokes)).find(s => s.width === overlay.controlLine &&
                s.points.length === 2 && distance(s.points[0], start) < .01 && distance(s.points[1], end) < .01);
        };
        assert.deepEqual((await strokeAt(2))?.dash, [...overlay.dash]);
        assert.deepEqual((await strokeAt(4))?.dash, []);
        const handlesFrame = await frame(), [left, top] = pixels(handlesFrame, [-27, 36]), [right, bottom] = pixels(handlesFrame, [12, 20]);
        await screenshot("handle-dashes", { x: left, y: top, width: right - left, height: bottom - top });
        const handle = pathHandle(line, 2, "out");
        await drag(handle, 0, async () => {
            const f = await frame(), [x, y] = pixels(f, handle, true), start = pixels(f, line.nodes[2].p, true);
            const preview = (await evaluate(() => window.curveMapProbe.strokes)).find(s => s.width === overlay.controlLine &&
                s.points.length === 2 && distance(s.points[0], start) < .01 && distance(s.points[1], [x + 30, y]) < 1);
            assert.deepEqual(preview?.dash, []);
        });
        assert.equal((await curve()).nodes[2].mode, "manual");
        await undo();

        await tap([-35, 25], 0, "right");
        assert.match(await text(".context-menu"), /曲线[\s\S]*全部节点改为自动平滑[\s\S]*全部线段改为直线/);
        await evaluate(() => window.curveMapProbe.editor!.toast = null);
        await screenshot("whole-curve-menu");
        const beforeBatch = await disk(), straight = ".context-menu [data-option=curve-line]";
        await click(straight); await saved();
        assert((await curve()).nodes.every(n => n.mode === "corner" && !("in" in n || "out" in n || "bulge" in n)));
        const writes = await evaluate(() => window.probe.writes);
        await tap([-35, 25], 0, "right"); await click(straight); await saved();
        assert.equal(await evaluate(() => window.probe.writes), writes);
        await undo(); assert.equal(await disk(), beforeBatch);
    });
}