import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { pathHandle } from "../../src/core/design/path.ts";
import { geometryPath } from "../../src/core/edit/geoControls.ts";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { setNodeMode, setSegment } from "../../src/core/edit/paths.ts";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { distance, mixPoint } from "../../src/core/math/geometry.ts";
import { mapColors, overlay, sectionColors } from "../../src/render/palette.ts";
import { layer, openCurve, rect, syntheticDesign } from "../../test/scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./pickers.ts";

type View = import("../../src/render/map.ts").MapView;
const alt = 1, ctrl = 2;
interface Stroke { points: Point[]; dash: number[]; color: string; width: number }
interface Reading { text: string; y: number; top: number; bottom: number; baseline: string; align: string }
interface Frame {
    origin: Point; localOrigin: Point; scale: number; selection: View["selection"]; hovered?: View["hovered"];
    geometry?: View["geometry"]; vertex?: View["vertex"]; section?: [Point, Point];
}
interface Probe {
    editor?: import("../../src/app/state/session.svelte.ts").Editor;
    frame?: Frame; strokes: Stroke[]; ticks: Reading[]; release?: () => void;
}
declare global {
    interface Window { round28: Probe }
}

async function observeRound28() {
    const probe: Probe = { strokes: [], ticks: [] };
    window.round28 = probe;
    const mapModule = "/src/render/map.ts", editorModule = "/src/app/state/session.svelte.ts";
    const { ProjectMap } = await import(mapModule) as typeof import("../../src/render/map.ts");
    const { Editor } = await import(editorModule) as typeof import("../../src/app/state/session.svelte.ts");
    const reconcile = Editor.prototype.reconcileProject;
    Editor.prototype.reconcileProject = function (...args) {
        probe.editor = this;
        return reconcile.apply(this, args);
    };
    const ctx = CanvasRenderingContext2D.prototype;
    const { beginPath, moveTo, lineTo, stroke, clearRect, fillText } = ctx;
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
        if (this.canvas.id === "map" && !args.length && points.length >= 2)
            probe.strokes.push({ points: points.slice(), dash: this.getLineDash(), color: String(this.strokeStyle), width: this.lineWidth });
        Reflect.apply(stroke, this, args);
    };
    ctx.clearRect = function (...args) {
        if (this.canvas.closest("#plots")) probe.ticks = [];
        clearRect.apply(this, args);
    };
    ctx.fillText = function (text, x, y, width) {
        if (this.canvas.closest("#plots")) {
            const metrics = this.measureText(text);
            probe.ticks.push({ text, y, top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent,
                baseline: this.textBaseline, align: this.textAlign });
        }
        if (width === undefined) fillText.call(this, text, x, y);
        else fillText.call(this, text, x, y, width);
    };
    const draw = ProjectMap.prototype.draw;
    ProjectMap.prototype.draw = function (view, theme) {
        probe.strokes = [];
        draw.call(this, view, theme);
        const localOrigin = this.screen([0, 0]), box = this.canvas.getBoundingClientRect();
        probe.frame = {
            localOrigin, origin: [box.left + localOrigin[0], box.top + localOrigin[1]], scale: this.scale,
            selection: view.selection, hovered: view.hovered, geometry: view.geometry, vertex: view.vertex,
            section: view.project.design.sections.find(section => section.id === "Q")?.points
        };
    };
}

function sample() {
    const design: Design = syntheticDesign(), mountain = defaultFunction("mountain");
    assert(mountain.type === "mountain");
    const line = openCurve(([[-40, 25], [-30, 25], [-20, 31], [-10, 25], [0, 25], [10, 30], [20, 25], [30, 25]] as Point[])
        .map((p, i) => ({ p, h: 6 + i })));
    setNodeMode(line, 2, "auto");
    Object.assign(line.nodes[4], { mode: "manual", in: [-3, 0], out: [3, 0] });
    setSegment(line, 5, "arc");
    mountain.ridges.push({ line, widths: [8, 8], widthNoise: { amount: 0, wavelength: 10 }, heightNoise: { amount: 0, wavelength: 10 } });
    const region = rect(-46, 18, 43, 40), hole = rect(33, 31, 38, 36).paths[0];
    for (const node of hole.nodes) node.id = "hole-" + node.id;
    region.paths.push(hole);
    const ground = rect(-57, -45, 57, 16), upper = rect(48, 20, 57, 41).paths[0];
    for (const node of upper.nodes) node.id = "upper-" + node.id;
    ground.paths.push(upper);
    design.geoNodes = [
        layer("G", ground, { type: "ground", value: .2 }),
        layer("A", rect(-37, -13, 3, 13), { type: "flat", amount: 1 }),
        layer("B", rect(-12, -12, 25, 15), { type: "flat", amount: .4 }),
        layer("M", region, mountain)
    ];
    design.sections = [{ id: "Q", label: "剖面线 Q", points: [[-28, 25], [26, 25]], showLabel: false }];
    return design;
}

export async function checkRound28(url: string) {
    const design = sample(), name = "round28.json", browser = await startChromium();
    const { cdp, click, evaluate, key, wait } = browser;
    const frame = () => evaluate(() => window.round28.frame!);
    const idle = () => wait(() => document.querySelector(".map-wrap[data-busy=false]"));
    const saved = () => wait(() => document.querySelector(".map-wrap[data-busy=false]") && document.querySelector("#save-state")?.textContent === "已保存");
    const paint = () => evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const disk = () => evaluate(name => window.disk(name), name);
    const text = (selector: string) => evaluate(s => document.querySelector<HTMLElement>(s)?.innerText.trim() ?? "", selector);
    const authored = async () => parseDesign(await disk(), true);
    const owner = (d: Design, id: string) => d.geoNodes.find(n => n.id === id)!;
    const curve = async () => geometryPath(owner(await authored(), "M"), -1)!;
    const boundary = (d: Design, id: string) => geometryPath(owner(d, id), 0)!;
    const undo = async () => {
        await click("#undo"); await saved(); await paint();
    };
    const group = ".pen-modes";
    const penMode = () => text(group + " [aria-pressed=true]");
    const nodeTitles = () => evaluate(() => [...document.querySelectorAll("[data-curve-node] .subitem-label")].map(el => el.textContent));
    const pixels = (f: Frame, [x, y]: Point, local = false): Point => {
        const [a, b] = local ? f.localOrigin : f.origin;
        return [a + x * f.scale, b - y * f.scale];
    };
    async function mouse(type: string, [x, y]: Point, modifiers = 0, button = "left", clickCount = 1) {
        await cdp("Input.dispatchMouseEvent", { type, x, y, modifiers, button, clickCount,
            buttons: type === "mouseReleased" || button === "none" ? 0 : button === "right" ? 2 : 1 });
    }
    async function tap(p: Point, modifiers = 0, button = "left", count = 1) {
        const at = pixels(await frame(), p);
        await mouse("mousePressed", at, modifiers, button, count);
        await mouse("mouseReleased", at, modifiers, button, count);
        await paint();
    }
    async function drag(p: Point, modifiers = 0, preview?: () => Promise<void>) {
        const [x, y] = pixels(await frame(), p), to: Point = [x + 30, y];
        await mouse("mousePressed", [x, y], modifiers);
        await mouse("mouseMoved", to, modifiers);
        if (preview) {
            await paint(); await preview();
        }
        await mouse("mouseReleased", to, modifiers);
        await saved(); await paint();
    }
    const screenshots = new URL("../../.local/rounds/28/browser/", import.meta.url);
    async function screenshot(label: string, clip?: { x: number; y: number; width: number; height: number }) {
        if (!process.env.GROUNDWORK_ROUND28_SCREENSHOTS) return;
        await mkdir(screenshots, { recursive: true });
        await paint();
        const { data } = await cdp("Page.captureScreenshot", { format: "png", ...(clip && { clip: { ...clip, scale: 1 } }) });
        await writeFile(new URL(label + ".png", screenshots), Buffer.from(data, "base64"));
    }
    async function open(first = false) {
        await cdp("Page.navigate", { url: url + "?round=28&first=" + first });
        await wait(() => document.querySelector(".empty-state"));
        await evaluate(observeRound28);
        await evaluate(async ({ name, bytes }) => {
            window.probe.openName = name;
            if (!bytes) return;
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle(name, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
        }, { name, bytes: first ? serializeDesign(design) : undefined });
        await click("#open");
        await wait(name => document.querySelector("#filename")?.textContent === name, name);
        await saved(); await click("#fit"); await paint();
    }
    async function tool(category: "地件" | "标记", id: string) {
        await click(category === "地件" ? "[data-tab=terrain]" : "[data-tab=marks]");
        await click("button[aria-label=新建" + category + "]");
        await click(".creation-menu [data-option=" + id + "]");
    }
    function translated(before: Point[], after: Point[], dx: number) {
        assert.equal(after.length, before.length);
        for (const [i, [x, y]] of before.entries()) assert(distance(after[i], [x + dx, y]) < .02, JSON.stringify({ before, after, dx }));
    }
    async function assertSectionStroke() {
        const f = await frame(), endpoints = f.section!.map(p => pixels(f, p, true));
        const strokes = await evaluate(() => window.round28.strokes);
        const lines = strokes.filter(s => s.points.length === 2 && s.color === mapColors.light.accent && s.width === overlay.selectedWidth &&
            s.points.every((p, i) => distance(p, endpoints[i]) < .01));
        assert.equal(lines.length, 1, "The section body is one stroke at its current position");
        assert.deepEqual(lines[0].dash, []);
    }
    async function moveOverMap() {
        const center = await evaluate(() => {
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return [box.left + box.width * .42, box.top + box.height * .4] as Point;
        });
        await mouse("mouseMoved", center, 0, "none");
        await wait(() => !document.querySelector<HTMLElement>("#position")?.hidden);
    }
    try {
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await open(true);
        const original = await authored(), dx = 30 / (await frame()).scale;
        const overlap: Point = [-5, 1];
        await tap(overlap); assert.equal((await frame()).selection?.id, "B");
        await tap(overlap, alt); assert.equal((await frame()).selection?.id, "A");
        await mouse("mouseMoved", pixels(await frame(), overlap), 0, "none"); await paint();
        assert.equal((await frame()).hovered?.id, "A");
        await mouse("mouseMoved", pixels(await frame(), overlap), alt, "none"); await paint();
        assert.equal((await frame()).hovered?.id, "G");
        await drag(overlap);
        let current = await authored();
        translated(boundary(original, "A").nodes.map(n => n.p), boundary(current, "A").nodes.map(n => n.p), dx);
        assert.deepEqual(boundary(current, "B"), boundary(original, "B"));
        assert.equal((await frame()).selection?.id, "A");
        const selectedPoint = pixels(await frame(), overlap);
        await mouse("mousePressed", selectedPoint);
        await paint(); assert.equal((await frame()).selection?.id, "A");
        await mouse("mouseReleased", selectedPoint); await paint();
        assert.equal((await frame()).selection?.id, "B");
        assert.deepEqual(await authored(), current);
        await drag([-28, 1], alt);
        const fromOutside = await authored();
        translated(boundary(current, "A").nodes.map(n => n.p), boundary(fromOutside, "A").nodes.map(n => n.p), dx);
        assert.equal((await frame()).selection?.id, "A");
        await undo(); await undo();

        await click("[data-tab=layers]"); await click("input[data-layer=geoNodes]"); await paint();
        const intersection: Point = [-5, 25];
        for (const [id, index] of [["Q", undefined], ["M", -1], ["M", undefined], ["Q", undefined]] as const) {
            await tap(intersection, alt);
            const f = await frame();
            assert.equal(f.selection?.id, id);
            assert.equal(f.geometry?.index, index);
        }
        await tap([-35, 25]); assert.equal((await frame()).geometry?.index, -1);
        const functionTab = "[data-property-tab=function][aria-pressed=true]";
        assert.equal(await text(".geometry-box[aria-label=山脊线][aria-pressed=true]"), "曲线（8 个节点）");
        await tap([30, 37]);
        assert.equal((await frame()).selection?.id, "M");
        assert.equal((await frame()).geometry, undefined);
        assert(await evaluate(s => !!document.querySelector(s) && !document.querySelector(".geometry-box[aria-label=山脊线][aria-pressed=true]"), functionTab));
        assert.equal(await evaluate(() => {
            const { editor, frame } = window.round28, ctx = editor!.map.ctx;
            const [x, y] = frame!.localOrigin, scale = frame!.scale;
            return [...ctx.getImageData(Math.round(x - 46 * scale), Math.round(y - 18 * scale), 1, 1).data].slice(0, 3);
        }).then(c => c.map(n => n.toString(16).padStart(2, "0")).join("")), mapColors.light.bgPanel.slice(1));

        await tap(original.sections[0].points[0]);
        assert.equal((await frame()).selection?.index, 0);
        await drag(intersection, 0, assertSectionStroke);
        assert.deepEqual((await frame()).selection, { kind: "section", id: "Q" });
        translated(original.sections[0].points, (await authored()).sections[0].points, dx);
        await assertSectionStroke();
        await undo();
        const originalLine = await curve();
        await tap(originalLine.nodes[0].p); assert.equal((await frame()).vertex?.index, 0);
        await drag([-35, 25]);
        current = await authored();
        assert.equal((await frame()).geometry?.index, -1);
        assert.equal((await frame()).vertex, undefined);
        translated(originalLine.nodes.map(n => n.p), (await curve()).nodes.map(n => n.p), dx);
        assert.deepEqual(owner(current, "M").construction, owner(original, "M").construction);
        await undo();

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
            .map(el => [el.textContent?.trim(), el.getAttribute("aria-expanded")]), boundaryTwo), [["边界 1", "false"], ["边界 2", "false"]]);
        await tap([29, 37]); await tap([33, 31]);
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        assert(await evaluate(() => {
            const nested = document.querySelector("[data-curve-node]")?.parentElement?.closest(".subitem");
            return nested?.querySelector(".subitem-toggle")?.textContent?.trim() === "边界 2" &&
                ![...document.querySelectorAll("#property-content h3")].some(h => h.textContent === "节点");
        }));
        await click("[aria-label=上一个节点]"); await paint(); assert.deepEqual(await nodeTitles(), ["节点 4"]);
        await key("Escape"); await paint();
        assert.deepEqual(await nodeTitles(), []);
        assert(await evaluate(() => [...document.querySelectorAll(".subitem-toggle")].some(el =>
            el.textContent?.trim() === "边界 2" && el.getAttribute("aria-expanded") === "true")));
        await click("[data-geo-node=B]");
        assert.equal(await text("#property-content .subitem-toggle"), "边界 1");
        assert(await evaluate(() => !document.querySelector("#property-content [aria-label=删除边界]")));

        await tap([-35, 25]);
        const line = await curve();
        const strokeAt = async (index: number) => {
            const f = await frame(), start = pixels(f, line.nodes[index].p, true), end = pixels(f, pathHandle(line, index, "out"), true);
            return (await evaluate(() => window.round28.strokes)).find(s => s.width === overlay.controlLine &&
                s.points.length === 2 && distance(s.points[0], start) < .01 && distance(s.points[1], end) < .01);
        };
        assert.deepEqual((await strokeAt(2))?.dash, [...overlay.dash]);
        assert.deepEqual((await strokeAt(4))?.dash, []);
        const handlesFrame = await frame(), [left, top] = pixels(handlesFrame, [-27, 36]), [right, bottom] = pixels(handlesFrame, [12, 20]);
        await screenshot("handle-dashes", { x: left, y: top, width: right - left, height: bottom - top });
        const handle = pathHandle(line, 2, "out");
        await drag(handle, 0, async () => {
            const f = await frame(), [x, y] = pixels(f, handle, true), start = pixels(f, line.nodes[2].p, true);
            const preview = (await evaluate(() => window.round28.strokes)).find(s => s.width === overlay.controlLine &&
                s.points.length === 2 && distance(s.points[0], start) < .01 && distance(s.points[1], [x + 30, y]) < 1);
            assert.deepEqual(preview?.dash, []);
        });
        assert.equal((await curve()).nodes[2].mode, "manual");
        await undo();

        await tap([-35, 25], 0, "right");
        assert.match(await text(".context-menu"), /整条曲线[\s\S]*全部节点改为自动平滑[\s\S]*全部线段改为直线/);
        await evaluate(() => window.round28.editor!.toast = null);
        await screenshot("whole-curve-menu");
        const beforeBatch = await disk(), straight = ".context-menu [data-option=curve-line]";
        await click(straight); await saved();
        assert((await curve()).nodes.every(n => n.mode === "corner" && !("in" in n || "out" in n || "bulge" in n)));
        const writes = await evaluate(() => window.probe.writes);
        await tap([-35, 25], 0, "right"); await click(straight); await saved();
        assert.equal(await evaluate(() => window.probe.writes), writes);
        await undo(); assert.equal(await disk(), beforeBatch);

        const triangles: [Point, Point, Point][] = [[[-43, -33], [-33, -33], [-38, -24]], [[6, -34], [17, -34], [11, -24]]];
        for (const [i, points] of triangles.entries()) {
            await tool("地件", "pen"); assert.equal(await penMode(), "尖角");
            if (i) {
                await evaluate(() => document.querySelector<HTMLInputElement>("#terrain-search")!.focus());
                await key("s"); assert.equal(await penMode(), "尖角");
                await evaluate(() => document.querySelector<HTMLElement>("#map")!.focus());
                await key("s"); assert.equal(await penMode(), "自动平滑");
                await screenshot("pen-modes");
            }
            for (const point of [...points, points[0]]) await tap(point, ctrl);
            await saved(); await paint();
            const id = (await frame()).selection!.id, nodes = boundary(await authored(), id).nodes;
            assert.equal(nodes.length, 3);
            assert(nodes.every(n => n.mode === (i ? "auto" : "corner") && !("in" in n || "out" in n)));
        }
        await open();
        await tool("地件", "pen"); assert.equal(await penMode(), "自动平滑"); await key("Escape");
        await click("[data-geo-node=M]"); await click("[data-property-tab=function]");
        await click("[aria-label=添加山脊]"); assert.equal(await penMode(), "自动平滑"); await key("Escape");

        await checkPlots();
        await checkOverlays();
        await checkBusy();

        async function checkPlots() {
            for (const [name, points] of [["section-flat", [[-52, -40], [48, -40]]], ["section-relief", [[-52, 2], [48, 2]]]] as [string, [Point, Point]][]) {
                await tool("标记", "section");
                for (const point of points) await tap(point);
                await saved(); await paint();
                assert.doesNotMatch(await text("#plots .plot-title"), /—/);
                const result = await evaluate(() => {
                    const canvas = document.querySelector<HTMLCanvasElement>("#plots canvas")!, box = document.querySelector("#plots")!.getBoundingClientRect();
                    const ticks = window.round28.ticks, low = ticks.find(t => t.baseline === "middle")!, zero = ticks.find(t => t.baseline === "alphabetic" && t.align === "left")!;
                    const pixel = canvas.getContext("2d")!.getImageData(Math.round(canvas.width / 2), Math.round(low.y + 2), 1, 1).data;
                    return { low, zero, pixel: [...pixel].slice(0, 3), clip: { x: box.x, y: box.y, width: box.width, height: box.height } };
                });
                assert(result.zero.top - result.low.bottom >= 4);
                assert.equal(result.pixel.map(n => n.toString(16).padStart(2, "0")).join(""), sectionColors.ground.slice(1));
                await screenshot(name, result.clip);
            }
        }
        async function checkOverlays() {
            for (const width of [1440, 375]) {
                await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
                await wait(width => innerWidth === width, width); await paint();
                await moveOverMap();
                await evaluate(() => window.round28.editor!.message("已恢复未保存的草稿"));
                await paint();
                const boxes = await evaluate(() => {
                    const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect().toJSON() as DOMRect;
                    return { canvas: rect("#map"), map: rect(".map-wrap"), hint: rect("#mode-hint"),
                        position: rect("#position"), zoom: rect(".zoom-tools"), toast: rect("#toast"),
                        status: !!document.querySelector(".coords"), gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) };
                });
                const { canvas, map, hint, position, zoom, toast, gap } = boxes;
                assert(!boxes.status);
                assert.equal(canvas.bottom, map.bottom);
                assert.equal(hint.left - map.left, 12);
                assert.equal(map.right - position.right, 12);
                assert.equal(map.bottom - position.bottom, 12);
                assert.equal(zoom.right, position.right);
                assert.equal(position.top - zoom.bottom, gap);
                assert(Math.abs((toast.left + toast.right - map.left - map.right) / 2) < 1);
                if (width === 375) {
                    assert(hint.bottom < position.top && hint.right <= zoom.left);
                    assert(toast.bottom < hint.top);
                }
                else {
                    assert(hint.right < toast.left && toast.right < position.left);
                }
                await screenshot(width === 375 ? "map-bottom-narrow" : "map-bottom-wide");
                await mouse("mouseMoved", [map.right - 5, map.top - 4], 0, "none");
                await wait(() => document.querySelector<HTMLElement>("#position")?.hidden);
            }
        }
        async function checkBusy() {
            const visible = () => evaluate(() => {
                const el = document.querySelector<HTMLElement>("#toast")!;
                return !el.hidden && Number(getComputedStyle(el).opacity) > 0 ? el.textContent : "";
            });
            assert.equal(await evaluate(async () => {
                const editor = window.round28.editor!;
                editor.toast = null;
                let flashed = false, observing = true;
                function observe() {
                    const el = document.querySelector<HTMLElement>("#toast")!;
                    flashed ||= el.textContent === "计算中" && Number(getComputedStyle(el).opacity) > 0;
                    if (observing) requestAnimationFrame(observe);
                }
                requestAnimationFrame(observe);
                await editor.working("正在更新地件…", () => {});
                observing = false;
                return flashed;
            }), false);
            assert.equal(await visible(), "");
            await evaluate(() => {
                const probe = window.round28, raf = window.requestAnimationFrame;
                window.requestAnimationFrame = first => {
                    window.requestAnimationFrame = raf;
                    return raf(time => {
                        window.requestAnimationFrame = second => {
                            probe.release = () => {
                                raf(second);
                            };
                            return 0;
                        };
                        try {
                            first(time);
                        }
                        finally {
                            window.requestAnimationFrame = raf;
                        }
                    });
                };
                void probe.editor!.edit(d => {
                    d.geoNodes[0].function = { type: "ground", value: .3 };
                });
            });
            await wait(() => !!window.round28.release);
            assert.equal(await visible(), "");
            await wait(() => {
                const toast = document.querySelector<HTMLElement>("#toast")!;
                return toast.textContent === "计算中" && !toast.hidden && Number(getComputedStyle(toast).opacity) === 1;
            });
            await evaluate(() => window.round28.editor!.message("已新建设计"));
            assert.equal(await visible(), "已新建设计");
            await wait(() => document.querySelector("#toast")?.textContent === "计算中");
            assert.equal(await visible(), "计算中");
            await evaluate(() => window.round28.release!());
            await idle(); await saved();
            assert.equal(await visible(), "");
        }
    }
    finally {
        await browser.close();
    }
}