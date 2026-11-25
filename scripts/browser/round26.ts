import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { type Box, distance } from "../../src/core/math/geometry.ts";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { sampleField } from "../../src/core/design/results.ts";
import { Project } from "../../src/core/project.ts";
import { layer, rect, syntheticDesign } from "../../test/scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./pickers.ts";

interface Frame {
    center: Point;
    scale: number;
    width: number;
    height: number;
    labels: { id: string; point: Point }[];
    marks: { id: string; point: Point; box: Box }[];
}
interface DragFrame { projectPosition: Point; previewPosition?: Point; committing: boolean; oldPixel: number[] }
interface Round26Probe {
    frame?: Frame;
    watch?: Point;
    drag: DragFrame[];
    resized: { width: number; height: number; alpha: number }[];
    terrain: number;
    plots: { ticks: string[]; fills: number; clears: number };
}
declare global {
    interface Window { round26: Round26Probe }
}
async function observeRound26() {
    const probe: Round26Probe = { drag: [], resized: [], terrain: 0, plots: { ticks: [], fills: 0, clears: 0 } };
    window.round26 = probe;
    const mapModule = "/src/render/map.ts", cacheModule = "/src/core/terrain/cache.ts";
    const { ProjectMap } = await import(mapModule) as typeof import("../../src/render/map.ts");
    const { TerrainCache } = await import(cacheModule) as typeof import("../../src/core/terrain/cache.ts");
    const draw = ProjectMap.prototype.draw, generate = TerrainCache.prototype.generateResolved;
    ProjectMap.prototype.draw = function (view, theme) {
        draw.call(this, view, theme);
        probe.frame = {
            center: [...this.center], scale: this.scale, width: this.width, height: this.height,
            labels: this["labelBoxes"].map(({ id, point }) => ({ id, point })),
            marks: this["markBoxes"].map(({ mark: { id, point }, box }) => ({ id, point, box }))
        };
        if (probe.watch) {
            const node = view.project.design.geoNodes.find(n => n.id === "A")!, preview = view.dragNode?.construction;
            if (node.construction.type === "free") {
                const [x, y] = this.screen(probe.watch).map(p => Math.floor(p * this.dpr));
                const oldPixel = [...this.ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
                probe.drag.push({ projectPosition: node.construction.paths[0].nodes[0].p, committing: !!view.dragCommitting,
                    previewPosition: preview?.type === "free" ? preview.paths[0].nodes[0].p : undefined, oldPixel });
            }
        }
    };
    TerrainCache.prototype.generateResolved = function (...args) {
        probe.terrain++;
        return generate.apply(this, args);
    };
    const canvas = document.querySelector<HTMLCanvasElement>("#map")!, context = canvas.getContext("2d")!;
    const resize = new ResizeObserver(() => {
        const { width, height } = canvas;
        if (width && height) probe.resized.push({ width, height, alpha: context.getImageData(2, 2, 1, 1).data[3] });
    });
    resize.observe(canvas);

    const ctx = CanvasRenderingContext2D.prototype, { clearRect, fillText, fill } = ctx;
    ctx.clearRect = function (...args) {
        if (this.canvas.closest("#plots")) {
            probe.plots.clears++;
            probe.plots.ticks = [];
            probe.plots.fills = 0;
        }
        clearRect.apply(this, args);
    };
    ctx.fillText = function (...args) {
        if (this.canvas.closest("#plots") && this.textAlign === "right" && this.textBaseline === "middle") probe.plots.ticks.push(args[0]);
        fillText.apply(this, args);
    };
    ctx.fill = function (...args: [CanvasFillRule?] | [Path2D, CanvasFillRule?]) {
        if (this.canvas.closest("#plots")) probe.plots.fills++;
        Reflect.apply(fill, this, args);
    };
}

function sampleDesign() {
    const d: Design = syntheticDesign();
    d.grid.step = .25;
    d.inputs.A.label = "基数";
    d.inputs.seed.value = "{input:A}";
    d.inputs.B = { label: "长表达式", value: "{input:A}" + " + 1".repeat(28), range: [-100, 100, .1] };
    d.fields.F = { label: "基质", unit: "%", precision: .01 };
    d.fields.U = { label: "场 U" };
    const mountain = defaultFunction("mountain");
    assert(mountain.type === "mountain");
    for (const y of [23, 27, 31]) {
        mountain.ridges.push({ line: { points: [{ p: [-33, y], h: 5 }, { p: [-7, y], h: 5 }, { p: [18, y], h: 5 }] },
            widths: [3, 3], widthNoise: { amount: 0, wavelength: 10 }, heightNoise: { amount: 0, wavelength: 10 } });
    }
    d.geoNodes = [
        layer("G", rect(-60, -38, 60, 38), { type: "ground", value: 3 }),
        { ...layer("A", rect(-36, -18, 18, 16), { type: "flat", amount: .8 }), label: "台地 A", showLabel: true },
        { ...layer("B", rect(-17, -12, 32, 20), { type: "flat", amount: .4 }), label: "台地 B" },
        layer("C", rect(-44, 19, 45, 35), mountain),
        layer("D", rect(-18, 21, 30, 34), { type: "flat", amount: .1 }),
        layer("F", rect(-48, -33, 48, -22), { type: "ground", value: .47 }, "F")
    ];
    d.sections = [{ id: "S", label: "剖面线 A", points: [[-56, -27], [56, -27]], showLabel: false }];
    d.marks = [
        { id: "R", kind: "scale", label: "屏幕比例尺", point: [92, 560], follow: "screen" },
        { id: "M", kind: "scale", label: "地图比例尺", point: [160, 53], length: 75, follow: "map" },
        { id: "T", kind: "text", label: "标记 A", point: [-54, 31], follow: "map" }
    ];
    return d;
}

export async function checkRound26(url: string) {
    const d = sampleDesign(), browser = await startChromium();
    const { cdp, click, evaluate, key, mouse, wait } = browser;
    const filename = "round26.json", status = ".drawing-status";
    const screenMark = "[data-mark=R]", mapMark = "[data-mark=M]", section = "[data-section=S]", region = "[data-geo-node=A]";
    const panel = (id: string) => click("[data-tab=" + id + "]");
    const property = (id: string) => click("[data-property-tab=" + id + "]");
    const text = (selector: string) => evaluate(s => document.querySelector<HTMLElement>(s)?.innerText.trim() ?? "", selector);
    const saved = () => wait(() => !!document.querySelector<HTMLElement>("#busy")?.hidden &&
        document.querySelector("#save-state")?.textContent === "已保存");
    const paint = () => evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const disk = () => evaluate(name => window.disk(name), filename);
    const authored = async () => parseDesign(await disk(), true);
    const frame = () => evaluate(() => window.round26.frame!);
    const fit = async () => {
        await click("#fit"); await paint();
    };
    const undo = async () => {
        await click("#undo"); await saved(); await paint();
    };
    const point = (selector: string, fraction = .5) => evaluate(({ selector, fraction }): Point => {
        const element = document.querySelector(selector)!;
        const box = element.getBoundingClientRect();
        return [box.left + box.width * fraction, box.top + box.height / 2];
    }, { selector, fraction });
    function at(p: Point) {
        return evaluate(([x, y]): Point => {
            const { center, scale, width, height } = window.round26.frame!;
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return [box.left + (x - center[0]) * scale + width / 2, box.top + (center[1] - y) * scale + height / 2 + 9];
        }, p);
    }
    async function tap([x, y]: Point, modifiers = 0, button = "left") {
        for (const type of ["mousePressed", "mouseReleased"])
            await cdp("Input.dispatchMouseEvent", { type, x, y, button, modifiers, clickCount: 1 });
    }
    async function drag(from: Point, to: Point) {
        await mouse("mousePressed", ...from);
        await mouse("mouseMoved", ...to);
        await mouse("mouseReleased", ...to);
    }
    async function stripTool() {
        await click("button[aria-label=新建地件]");
        await click(".creation-menu [data-option=strip]");
    }
    async function screenshot(name: string) {
        if (!process.env.GROUNDWORK_ROUND26_SCREENSHOTS) return;
        const dir = new URL("../../.local/rounds/26/browser/", import.meta.url);
        await mkdir(dir, { recursive: true });
        await paint();
        const { data } = await cdp("Page.captureScreenshot", { format: "png" });
        await writeFile(new URL(name + ".png", dir), Buffer.from(data, "base64"));
    }
    async function selectedPixels(p: Point) {
        const screen = await at(p);
        return evaluate(([x, y]) => {
            const canvas = document.querySelector<HTMLCanvasElement>("#map")!, box = canvas.getBoundingClientRect();
            const i = Math.floor((x - box.left) * canvas.width / box.width);
            const j = Math.floor((y - box.top) * canvas.height / box.height);
            const { data } = canvas.getContext("2d")!.getImageData(i - 1, j - 1, 3, 3);
            for (let k = 0; k < data.length; k += 4) if (data[k] === 34 && data[k + 1] === 102 && data[k + 2] === 89) return true;
            return false;
        }, screen);
    }
    async function assertStrip(ids: string[], common = false) {
        const doc = await authored();
        const node = doc.geoNodes.find(n => n.construction.type === "strip")!;
        assert(node.construction.type === "strip");
        assert.deepEqual(node.construction.of, ids);
        assert.equal(node.construction.range, undefined);
        const spine = new Project(doc).terrain.regions.get(node.id)?.shape.spine ?? [];
        assert(spine.length > 0);
        if (common) {
            assert(spine.every(({ a, b }) => [a, b].every(([x, y]) => x >= -36 && x <= 18 && y >= -18 && y <= 16)));
            assert(spine.some(({ a, b }) => a[1] === -12 && b[1] === -12));
        }
        else if (ids.length === 1) {
            assert.equal(spine.length, 4);
            assert.equal(spine.reduce((sum, edge) => sum + distance(edge.a, edge.b), 0), 176);
        }
    }
    async function menuFor(selector: string) {
        await evaluate(s => document.querySelector(s)!.scrollIntoView({ block: "nearest" }), selector);
        await tap(await point(selector), 0, "right");
        await wait(() => !!document.querySelector(".context-menu"));
    }
    async function show(selector: string) {
        await menuFor(selector);
        assert.equal(await text(".context-menu [data-option=show-in-view]"), "在视野中显示");
        await click(".context-menu [data-option=show-in-view]");
        await saved(); await paint();
    }
    async function panAway() {
        const [x, y] = await point("#map");
        for (const [type, dx, buttons] of [["mousePressed", 0, 4], ["mouseMoved", 420, 4], ["mouseReleased", 420, 0]] as const)
            await cdp("Input.dispatchMouseEvent", { type, x: x + dx, y, button: "middle", buttons, clickCount: 1 });
        await paint();
    }
    async function inMap(world: Point) {
        const [x, y] = await at(world);
        return evaluate(([x, y]) => {
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return box.left <= x && x <= box.right && box.top <= y && y <= box.bottom;
        }, [x, y]);
    }
    const pickField = async (id: string) => {
        await click("button[aria-label=显示的场]");
        await click(".choices[aria-label=显示的场] [data-option=" + id + "]");
        await paint();
    };

    try {
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await cdp("Page.navigate", { url });
        await wait(() => !!document.querySelector(".empty-state"));
        await evaluate(observeRound26);
        await evaluate(async ({ name, bytes }) => {
            window.probe.openName = name;
            const file = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
        }, { name: filename, bytes: serializeDesign(d) });
        await click("#open");
        await wait(name => document.querySelector("#filename")?.textContent === name && !!window.round26.frame, filename);
        await saved();
        await panel("layers");
        await click("input[data-layer=issues]");
        await click("input[data-layer=contours]");
        await click("input[data-layer=grid]");
        await panel("terrain"); await fit();

        console.log("Round 26: whole strips, selection colors and Alt cycling");
        await stripTool();
        assert.equal(await text(status + " span"), "单击要沿的地件");
        assert.equal(await text("#mode-hint"), "单击要沿的地件，按住 Alt 单击可选被遮住的地件，Esc 取消");
        await tap(await at([-27, 7]));
        assert.equal(await text(status + " span"), "沿“台地 A”，回车确认");
        assert.equal(await text("#mode-hint"), "单击另一个地件改沿公共边，单击起止节点只取一段，或回车取整圈，Esc 取消");
        await key("Enter"); await saved(); await assertStrip(["A"]); await undo();
        await stripTool();
        await tap(await at([-27, 7]));
        await tap(await at([0, 6]));
        assert.equal(await text(status + " span"), "沿“台地 A”、“台地 B”，回车确认");
        assert.equal(await text("#mode-hint"), "单击起止节点只取一段，或回车取整条公共边，Esc 取消");
        await paint();
        assert(await selectedPixels([-36, 1]));
        assert(await selectedPixels([32, 1]));
        await screenshot("a-strip-two-sources");
        await key("Enter"); await saved(); await assertStrip(["B", "A"], true); await undo();
        await stripTool();
        await tap(await at([0, 6]));
        await tap(await at([0, 6]), 1);
        assert.equal(await text(status + " span"), "沿“台地 B”、“台地 A”，回车确认");
        await key("Enter"); await saved(); await assertStrip(["B", "A"], true); await undo();
        await stripTool();
        await tap(await at([-27, 7]));
        await tap(await at([0, 6]), 1);
        assert.equal(await text(status + " span"), "沿“台地 A”、“G”，回车确认");
        await key("Escape");

        console.log("Round 26: clicking and dragging map names");
        const nameAnchor = (await frame()).labels.find(n => n.id === "A")!.point, nameScreen = await at(nameAnchor);
        const cursor = () => evaluate(() => getComputedStyle(document.querySelector("#map")!).cursor);
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: nameScreen[0], y: nameScreen[1] });
        await paint(); assert.equal(await cursor(), "default");
        await tap(nameScreen);
        assert.equal(await evaluate(() => document.querySelector("[data-geo-node=B]")?.getAttribute("aria-pressed")), "true");
        await mouse("mousePressed", ...nameScreen);
        const positions: Point[] = [];
        for (let i = 0; i < 8; i++) {
            await mouse("mouseMoved", ...await at([-31 + i * .13, 24]));
            await paint();
            positions.push((await frame()).labels.find(n => n.id === "A")!.point);
        }
        assert.equal(await cursor(), "default");
        assert(positions.at(-1)![0] > positions[0][0] + .5);
        const scale = (await frame()).scale;
        for (const [i, position] of positions.slice(1).entries()) {
            assert(distance(position, positions[i]) * scale < 2);
            assert(Math.abs((position[1] - 16) * scale - 8) < 1);
        }
        await mouse("mouseReleased", ...await at([-31 + 7 * .13, 24]));
        await saved();
        const offset = (await authored()).geoNodes.find(n => n.id === "A")!.labelOffset;
        assert(offset && Math.abs(nameAnchor[1] + offset[1] - 24) < .2);
        assert(distance((await frame()).labels.find(n => n.id === "A")!.point, positions.at(-1)!) < .2);
        await undo();

        console.log("Round 26: drag preview survives the pending terrain edit");
        const from = await at([-28, 4]), to = await at([-21, 8]);
        await evaluate(() => {
            window.round26.watch = [-36, 2];
            window.round26.drag = [];
        });
        await click("[data-geo-node=G]"); await paint();
        await mouse("mousePressed", ...from); await paint();
        await mouse("mouseMoved", ...to); await paint();
        const pre = await evaluate(() => window.round26.drag);
        assert(pre.some(f => f.previewPosition && !f.committing), "The drag preview was visible before release");
        const oldPixel = pre.at(-1)!.oldPixel;
        await evaluate(() => window.round26.drag = []);
        await mouse("mouseReleased", ...to); await saved(); await paint();
        const frames = await evaluate(() => {
            window.round26.watch = undefined;
            return window.round26.drag;
        });
        const pending = frames.filter(f => f.projectPosition[0] === -36);
        assert(pending.length > 0);
        assert(pending.every(f => f.committing && f.previewPosition && f.previewPosition[0] > -36));
        const background = pre[0].oldPixel;
        assert.notDeepEqual(oldPixel, background);
        for (const f of pending) assert.deepEqual(f.oldPixel, background);
        assert(frames.some(f => f.projectPosition[0] > -36 && !f.previewPosition));
        await undo();

        console.log("Round 26: shorter canvas, mark bounds and list reveal");
        const markBefore = (await frame()).marks.find(m => m.id === "R")!;
        assert.deepEqual(markBefore.point, d.marks[0].point);
        await evaluate(() => window.round26.resized = []);
        const split = await point("[data-split=bottom]");
        await mouse("mousePressed", ...split);
        for (let i = 1; i <= 6; i++) {
            await mouse("mouseMoved", split[0], split[1] - i * 40);
            await wait(i => window.round26.resized.length >= i, i);
        }
        await mouse("mouseReleased", split[0], split[1] - 240);
        await paint();
        const resized = await evaluate(() => window.round26.resized);
        assert(resized.every(r => r.alpha === 255));
        assert(new Set(resized.map(r => r.height)).size >= 6);
        const smaller = await frame(), clipped = smaller.marks.find(m => m.id === "R")!;
        assert(clipped.point[1] < markBefore.point[1]);
        assert(clipped.box[0] >= 0 && clipped.box[1] >= 0 && clipped.box[2] <= smaller.width && clipped.box[3] <= smaller.height);
        assert(clipped.box[2] - clipped.point[0] > 80);
        assert.deepEqual((await authored()).marks[0].point, d.marks[0].point);
        const markClient = await evaluate(([x, y]): Point => {
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return [x + box.left + 22, y + box.top];
        }, clipped.point);
        await tap(markClient);
        assert.equal(await evaluate(() => document.querySelector("[data-mark=R]")?.getAttribute("aria-pressed")), "true");
        await drag(markClient, [markClient[0] + 10, markClient[1] - 28]); await saved();
        assert(distance((await authored()).marks[0].point, [clipped.point[0] + 10, clipped.point[1] - 28]) < .01);
        await undo();
        await show(screenMark);
        assert.deepEqual((await authored()).marks[0].point, clipped.point);
        const afterReveal = await disk(), writes = await evaluate(() => window.probe.writes);
        await show(screenMark);
        assert.equal(await disk(), afterReveal);
        assert.equal(await evaluate(() => window.probe.writes), writes);
        await undo(); assert.deepEqual((await authored()).marks[0].point, d.marks[0].point);

        await panel("terrain");
        await panAway();
        await menuFor(region);
        await screenshot("d-list-context");
        await click(".context-menu [data-option=show-in-view]"); await paint();
        for (const p of [[-36, -18], [18, 16]] as Point[]) assert(await inMap(p));
        const visible = await frame();
        await show(region); assert.deepEqual((await frame()).center, visible.center); assert.equal((await frame()).scale, visible.scale);
        await tap(await at([-26, 10]), 0, "right");
        assert(await text(".context-menu [data-option=add-path]"));
        assert.equal(await text(".context-menu [data-option=show-in-view]"), "");
        await key("Escape");
        await panel("marks");
        await show(section);
        for (const p of d.sections[0].points) assert(await inMap(p));
        await show(mapMark);
        const mapShown = await frame(), ruler = mapShown.marks.find(m => m.id === "M")!;
        assert(ruler.box[0] >= 0 && ruler.box[1] >= 0 && ruler.box[2] <= mapShown.width && ruler.box[3] <= mapShown.height);
        await click(section); await property("section");
        const icon = (selector: string) => evaluate(s => {
            const svg = document.querySelector(s + " svg")!;
            return [...svg.querySelectorAll("path")].map(path => path.getAttribute("d"));
        }, selector);
        const shape = "M10.5 12v5M10.5 14.5h7M17.5 12v5", line = "M3 5v8m0-4h12m0-4v8";
        const [flag, subtype] = await icon(section);
        assert.equal(subtype, shape);
        assert.deepEqual(await icon("#properties .property-title"), [flag, shape]);
        assert.deepEqual(await icon("[data-property-tab=section]"), [line]);
        assert.deepEqual(await icon("#properties button.geometry-box[aria-label=\"剖面线\"]"), [line]);
        await click("button[aria-label=新建标记]");
        for (const id of ["textMark", "scaleMark", "section"]) {
            const svg = ".creation-menu [data-option=" + id + "]";
            assert.equal((await icon(svg))[0], flag);
            assert(await evaluate(s => {
                const mask = document.querySelector(s + " mask rect[fill=\"black\"]");
                return mask?.getAttribute("x") === "8.6" && mask.getAttribute("stroke") === "none";
            }, svg));
        }
        assert.deepEqual(await icon(".creation-menu [data-option=section]"), [flag, shape]);
        await screenshot("g-mark-types");
        await key("Escape");
        await panel("inputs");
        for (const row of ["[data-select-input=A]", "[data-select-field=F]"]) {
            await menuFor(row);
            assert.equal(await text(".context-menu [data-option=show-in-view]"), "");
            await key("Escape");
        }

        console.log("Round 26: boundary controls, confirmation and clipped menu");
        await panel("terrain"); await click(region); await property("region"); await fit();
        assert.doesNotMatch(await text("#properties"), /构造方式/);
        assert.match(await text("button[aria-label=\"边界 1\"]"), /闭合曲线（4 个节点）/);
        const deleteBoundary = "button[aria-label=\"删除边界\"]";
        assert.equal(await evaluate(s => document.querySelectorAll(s).length, deleteBoundary), 0);
        await screenshot("b-boundary-one");
        await click("button[aria-label=添加边界]");
        assert.equal(await evaluate(() => document.querySelector("button[aria-label=添加边界]")?.getAttribute("aria-pressed")), "true");
        assert.equal(await text(status + " strong"), "给“台地 A”添加边界");
        for (const p of [[-32, 4], [-28, 4], [-30, 9]] as Point[]) await tap(await at(p));
        await key("Enter"); await saved();
        assert.equal(await evaluate(s => document.querySelectorAll(s).length, deleteBoundary), 2);
        const row2 = ".parameter-row:has(button[aria-label=\"边界 2\"])";
        const [rowX, rowY] = await point(row2);
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: rowX, y: rowY });
        await wait(s => getComputedStyle(document.querySelector(s)!).opacity === "1", row2 + " " + deleteBoundary);
        await screenshot("c-boundaries-two");
        await click(row2 + " " + deleteBoundary);
        assert.equal(await text("#remove-dialog h2"), "删除这条边界？");
        assert.equal(await text("#remove-dialog button[value=remove]"), "删除边界");
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
        await screenshot("f-clipped-dropdown");
        await key("Escape");

        console.log("Round 26: rendered ridge geometry opens and scrolls its inspector");
        await click("[data-geo-node=D]");
        const ridge: Point = [3, 31], vertex: Point = [-7, 31];
        await tap(await at(ridge));
        assert.equal(await evaluate(() => document.querySelector("[data-geo-node=D]")?.getAttribute("aria-pressed")), "true");
        await panel("layers"); await click("input[data-layer=geoNodes]");
        await tap(await at(ridge));
        const ridgeButton = "button.geometry-box[aria-label=\"山脊线\"][aria-pressed=\"true\"]";
        await wait(s => {
            const button = document.querySelector(s)?.getBoundingClientRect(), panel = document.querySelector("#property-content")!.getBoundingClientRect();
            return !!button && button.top >= panel.top && button.bottom <= panel.bottom;
        }, ridgeButton);
        assert.equal(await evaluate(() => document.querySelector("[data-geo-node=C]")?.getAttribute("aria-pressed")), "true");
        assert.equal(await evaluate(() => document.querySelector("[data-property-tab=function]")?.getAttribute("aria-pressed")), "true");
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll(".subitem-toggle[aria-expanded=true]")].map(el => el.textContent?.trim())), ["山脊 3"]);
        await tap(await at(vertex));
        const heightRow = "[data-parameter$=\".ridges.2.line.points.1.h\"]";
        await wait(s => !!document.querySelector(s), heightRow);
        await click("[data-geo-node=D]");
        await drag(await at(vertex), await at([-4, 32.3])); await saved();
        const mountain = (await authored()).geoNodes.find(n => n.id === "C")!.function;
        assert(mountain.type === "mountain" && distance(mountain.ridges[2].line.points[1].p, [-4, 32.3]) < .3);
        await undo();

        console.log("Round 26: section endpoints outside height and plots from the displayed field");
        await fit(); await panel("marks"); await click(section);
        const target: Point = [68, -27];
        assert(await inMap(target));
        const beforeSection = await authored();
        assert.equal(sampleField(new Project(beforeSection).terrain, "height", target), undefined);
        await drag(await at(beforeSection.sections[0].points[1]), await at(target)); await saved();
        assert(distance((await authored()).sections[0].points[1], target) < .3);
        await paint();
        assert.equal(await text(".bottom-tabs small"), "高度 / m");
        const heightPlot = await evaluate(() => ({ ...window.round26.plots, terrain: window.round26.terrain }));
        assert(heightPlot.ticks.includes("3.0") && heightPlot.fills === 1);
        await panel("layers"); await pickField("F");
        const fieldPlot = await evaluate(() => ({ ...window.round26.plots, terrain: window.round26.terrain }));
        assert.equal(await text(".bottom-tabs small"), "基质 / %");
        assert(fieldPlot.ticks.includes("0.47") && fieldPlot.ticks.every(tick => /^0\.\d\d$/.test(tick)));
        assert.equal(fieldPlot.fills, 1);
        assert.equal(fieldPlot.terrain, heightPlot.terrain);
        assert(fieldPlot.clears > heightPlot.clears);
        await screenshot("e-custom-field-section");
        await pickField("U"); assert.equal(await text(".bottom-tabs small"), "场 U");

        console.log("Round 26: numeric caret, expanded commits and rejected step values");
        await panel("inputs"); await paint();
        const chip = "[data-input=seed] .numeric-face [data-ref=\"input:A\"]";
        const caretAt = (after: boolean) => evaluate(after => {
            const el = document.querySelector(".numeric-edit")!, selection = document.getSelection()!;
            const chip = el.querySelector(".ref-chip")!, at = [...el.childNodes].indexOf(chip);
            return selection.isCollapsed && selection.anchorNode === el && selection.anchorOffset === at + Number(after) &&
                !selection.toString() && !chip.hasAttribute("data-selected");
        }, after);
        async function clickCaret(selector: string, fraction: number) {
            const at = await point(selector, fraction);
            const hit = await evaluate(({ at, selector }) => {
                const expected = document.querySelector(selector)!, target = document.elementFromPoint(...at);
                return { matches: target === expected || !!target?.closest(selector), target: target?.outerHTML.slice(0, 260),
                    box: expected.getBoundingClientRect().toJSON(), panel: document.querySelector("#panel")!.getBoundingClientRect().toJSON() };
            }, { at, selector });
            assert(hit.matches, "The numeric click must land on " + selector + " " + JSON.stringify(hit));
            await mouse("mousePressed", ...at);
            await mouse("mouseReleased", ...at);
        }
        await clickCaret(chip, .75);
        await wait(() => !!document.querySelector(".numeric-edit .ref-chip"));
        assert(await caretAt(true));
        await key("ArrowLeft"); assert(await caretAt(false));
        await key("ArrowRight", 8);
        await wait(() => !!document.querySelector(".numeric-edit .ref-chip[data-selected]"));
        await key("Backspace");
        await wait(() => !document.querySelector(".numeric-edit .ref-chip"));
        await key("Escape");
        await clickCaret("[data-input=seed] .numeric-face", .04);
        await wait(() => !!document.querySelector(".numeric-edit .ref-chip"));
        assert(await caretAt(false));
        await clickCaret(".numeric-edit .ref-chip", .75);
        assert(await caretAt(true));
        await clickCaret(".numeric-edit", .04);
        assert(await caretAt(false));
        await key("Escape");

        const long = "[data-input=B] .numeric-face";
        let formula = String(d.inputs.B.value);
        async function editLong() {
            await panel("inputs");
            await click(long);
            await wait(() => document.activeElement?.matches(".expanded-edit .numeric-edit"));
            await evaluate(() => {
                const el = document.activeElement!;
                document.getSelection()!.setPosition(el, el.childNodes.length);
            });
        }
        async function confirmFormula(expected: string) {
            await saved();
            assert.equal(await evaluate(() => !!document.querySelector(".expanded-edit")), false);
            assert.equal((await authored()).inputs.B.value, expected);
            assert.doesNotMatch(expected, /[\r\n]/);
        }
        for (const [suffix, modifiers] of [[" + 3", 0], [" + 4", 8]] as const) {
            await editLong();
            await cdp("Input.insertText", { text: suffix });
            await key("Enter", modifiers);
            formula += suffix;
            await confirmFormula(formula);
        }
        await editLong();
        await cdp("Input.insertText", { text: " + 5" });
        await cdp("Input.dispatchKeyEvent", { type: "char", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
        formula += " + 5";
        await confirmFormula(formula);
        await editLong();
        await evaluate(() => {
            const clipboardData = new DataTransfer();
            clipboardData.setData("text/plain", " +\r\n6");
            document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
        });
        await click("#map");
        formula += " + 6";
        await confirmFormula(formula);
        await editLong();
        await cdp("Input.insertText", { text: " / 0" });
        await click("#map");
        await confirmFormula(formula);
        assert.equal(await text("#toast"), "未保存：除数不能为 0");
        await editLong();
        await cdp("Input.insertText", { text: " + 7" });
        await key("Escape");
        await confirmFormula(formula);

        await tap(await at([70, 0]));
        assert.equal(await text("#properties .property-title h2"), "项目");
        const grid = "#properties [data-parameter=\"grid.step\"]";
        const step = grid + " button[aria-label=减小采样间距]";
        assert.equal(await text(grid + " .numeric-face"), "0.25");
        await evaluate(s => document.querySelector(s)!.scrollIntoView({ block: "nearest" }), step);
        const [stepX, stepY] = await point(step);
        await mouse("mousePressed", stepX, stepY);
        await wait(s => document.querySelector(s)?.textContent === "值 0.00 无效", grid + " [role=alert]");
        assert.equal(await text(grid + " .numeric-face"), "0.25");
        assert.equal(await text(grid + " [role=alert]"), "值 0.00 无效");
        await mouse("mouseReleased", stepX, stepY);
        assert.equal(await text(grid + " [role=alert]"), "");
        await evaluate(s => document.querySelector<HTMLButtonElement>(s)!.focus(), step);
        await key("Enter");
        assert.equal(await text(grid + " [role=alert]"), "值 0.00 无效");
        await click(grid + " .numeric-face");
        await wait(() => !!document.querySelector(".numeric-edit"));
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "0" });
        await key("Enter");
        assert.equal(await text(grid + " [role=alert]"), "无效");
        await key("Escape");
        assert.equal((await authored()).grid.step, .25);
    }
    finally {
        await browser.close();
    }
}