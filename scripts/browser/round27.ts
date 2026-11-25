import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { flattenPath, pathBezier, segmentType, splitBezier } from "../../src/core/design/path.ts";
import { geometryPath, type GeoControl, type GeometryTarget } from "../../src/core/edit/geoControls.ts";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { type Curve, type Point, type Section } from "../../src/core/design/v5.ts";
import { distance, mixPoint, nearest } from "../../src/core/math/geometry.ts";
import { layer, openCurve, rect, syntheticDesign } from "../../test/scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./pickers.ts";

interface Frame {
    origin: Point; scale: number; selected?: string; geometry?: GeometryTarget; vertex?: GeoControl;
    ridgePreview?: Curve; section?: Section["points"]; height?: number;
}
interface Probe { frame?: Frame; strokes: Point[][] }
declare global {
    interface Window { round27: Probe }
}

async function observeRound27() {
    const probe: Probe = { strokes: [] };
    window.round27 = probe;
    const mapModule = "/src/render/map.ts", paletteModule = "/src/render/palette.ts", terrainModule = "/src/core/design/results.ts";
    const { ProjectMap } = await import(mapModule) as typeof import("../../src/render/map.ts");
    const { mapColors } = await import(paletteModule) as typeof import("../../src/render/palette.ts");
    const colors = mapColors[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
    const { sampleField } = await import(terrainModule) as typeof import("../../src/core/design/results.ts");
    const draw = ProjectMap.prototype.draw, ctx = CanvasRenderingContext2D.prototype;
    const { beginPath, moveTo, lineTo, stroke } = ctx;
    let points: Point[] = [];
    ctx.beginPath = function () {
        if (this.canvas.id === "map") points = [];
        beginPath.call(this);
    };
    ctx.moveTo = function (x, y) {
        if (this.canvas.id === "map") points.push([x, y]);
        moveTo.call(this, x, y);
    };
    ctx.lineTo = function (x, y) {
        if (this.canvas.id === "map") points.push([x, y]);
        lineTo.call(this, x, y);
    };
    ctx.stroke = function (...args: [Path2D?]) {
        if (this.canvas.id === "map" && this.strokeStyle === colors.parameterGeometry && points.length > 1)
            probe.strokes.push(points.slice());
        Reflect.apply(stroke, this, args);
    };
    ProjectMap.prototype.draw = function (view, theme) {
        probe.strokes = [];
        draw.call(this, view, theme);
        const canvas = document.querySelector("#map")!.getBoundingClientRect(), [x, y] = this.screen([0, 0]);
        const dragged = view.dragNode?.function;
        probe.frame = { origin: [canvas.left + x, canvas.top + y], scale: this.scale, selected: view.selection?.id,
            geometry: view.geometry, vertex: view.vertex, ridgePreview: dragged?.type === "mountain" ? dragged.ridges[0].line : undefined,
            section: view.project.design.sections.find(s => s.id === "Q")?.points,
            height: sampleField(view.project.terrain, "height", [-23, 5]) };
    };
}

export async function checkRound27(url: string) {
    const design = syntheticDesign(), filename = "round27.json";
    const mountain = { ...layer("M", rect(-45, -33, 12, 30), defaultFunction("mountain")), label: "山" };
    const slope = { ...layer("S", rect(17, -24, 53, 24), {
        type: "slope", kind: "path", line: openCurve([{ p: [20, -18], h: 0 }, { p: [49, -18], h: 2 }])
    }), label: "坡面" };
    design.geoNodes = [layer("G", rect(-60, -47, 60, 47), { type: "ground", value: 4 }), mountain, slope];
    design.sections = [{ id: "Q", label: "剖面线 Q", points: [[-48, -37], [35, -37]], showLabel: false }];
    const browser = await startChromium(), { cdp, click, evaluate, key, mouse, wait } = browser;
    const frame = () => evaluate(() => window.round27.frame!);
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
        if (!process.env.GROUNDWORK_ROUND27_SCREENSHOTS) return;
        const dir = new URL("../../.local/rounds/27/browser/", import.meta.url);
        await mkdir(dir, { recursive: true });
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
            clip = { x, y, width: right - x, height: bottom - y, scale: 1 };
        }
        const { data } = await cdp("Page.captureScreenshot", { format: "png", ...(clip && { clip }) });
        await writeFile(new URL(name + ".png", dir), Buffer.from(data, "base64"));
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
        await evaluate(observeRound27);
        await evaluate(async ({ filename, bytes }) => {
            window.probe.openName = filename;
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle(filename, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
        }, { filename, bytes: serializeDesign(design) });
        await click("#open");
        await wait(name => document.querySelector("#filename")?.textContent === name && !!window.round27.frame, filename);
        await saved();
        await click("#fit"); await paint();

        console.log("Round 27: boundaries derive their segment types from handles");
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

        console.log("Round 27: ridge pen handles, inspector selection and height edits");
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
        assert.equal(await evaluate(s => !!document.querySelector(s + " [aria-label=后一段]"), third), false);
        await tap(line.nodes[1].p);
        const priorHeight = (await frame()).height!;
        await click(second + " button.numeric-face[aria-label=高度]");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "14" });
        await key("Enter"); await saved(); await paint();
        line = await ridge();
        assert.equal(line.nodes[1].h, 14);
        assert((await frame()).height! > priorHeight + 2);

        console.log("Round 27: insertion preserves the rendered ridge and deletion stops at two nodes");
        const strokes = () => evaluate(() => window.round27.strokes);
        const oldStroke = (await strokes())[0];
        assert(oldStroke.length > 3);
        const insert = splitBezier(pathBezier(line, 0), .5)[0][3];
        await tap(insert, "right"); await click(".context-menu [data-option=insert-node]");
        await saved(); await paint();
        line = await ridge();
        assert.equal(line.nodes.length, 4);
        const newStroke = (await strokes())[0];
        for (const [a, b] of [[oldStroke, newStroke], [newStroke, oldStroke]])
            assert(a.every(p => nearest(...p, b).distance < 1), "Rendered samples stay within a pixel of the same ridge");
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

        console.log("Round 27: drawing and reopening a closed ridge removes its closing handles");
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

        console.log("Round 27: dragging an unselected section or ridge moves the whole line in one undo step");
        await click("[data-geo-node=S]"); await paint();
        const originalSection = await section(), sectionStart = await screen(mixPoint(...originalSection, .5));
        const dx = 30 / (await frame()).scale;
        await drag(sectionStart, [sectionStart[0] + 30, sectionStart[1]], async () => {
            await paint();
            assert.equal((await frame()).selected, "Q");
            assert.equal((await frame()).vertex, undefined);
            assert(distance((await frame()).section![0], [originalSection[0][0] + dx, originalSection[0][1]]) < .02);
            assert.deepEqual(await section(), originalSection);
        });
        await saved();
        await paint();
        assert.equal((await frame()).vertex, undefined);
        const movedSection = await section();
        for (const [i, p] of originalSection.entries()) assert(distance(movedSection[i], [p[0] + dx, p[1]]) < .02);
        await click("[data-property-tab=section]");
        assert.equal(await text(".geometry-box[aria-label=剖面线]"), "线段");
        await undo();
        assert.deepEqual(await section(), originalSection);
        await click("[data-tab=layers]"); await click("input[data-layer=geoNodes]");
        await click("[data-tab=terrain]"); await click("[data-geo-node=S]"); await paint();
        assert.equal((await frame()).selected, "S");
        const original = await ridge(), moveFrom = splitBezier(pathBezier(original, 0), .5)[0][3];
        const dragStart = await screen(moveFrom);
        await drag(dragStart, [dragStart[0] + 30, dragStart[1]], async () => {
            await paint();
            assert.equal((await frame()).selected, "M");
            assert((await frame()).ridgePreview);
            assert.deepEqual(await ridge(), original);
        });
        await saved();
        await paint();
        assert.equal((await frame()).vertex, undefined);
        const movedRidge = await ridge();
        for (const [i, { p, ...node }] of original.nodes.entries()) {
            const { p: actual, ...attributes } = movedRidge.nodes[i];
            assert(distance(actual, [p[0] + dx, p[1]]) < .02);
            assert.deepEqual(attributes, node);
        }
        const owner = (await authored()).geoNodes.find(n => n.id === "M")!;
        assert.deepEqual(owner.construction, mountain.construction);
        await undo();
        assert.deepEqual(await ridge(), original);
    }
    finally {
        await browser.close();
    }
}