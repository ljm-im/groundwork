import assert from "node:assert/strict";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { type Box } from "../../src/core/math/geometry.ts";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { layer, rect, syntheticDesign, openCurve } from "../scenarios.ts";
import { startChromium, type Chromium } from "./chromium.ts";
import { installPickers } from "./filePickers.ts";

interface Frame {
    center: Point;
    scale: number;
    width: number;
    height: number;
    labels: { id: string; point: Point }[];
    marks: { id: string; point: Point; box: Box }[];
}
interface DragFrame { projectPosition: Point; previewPosition?: Point; committing: boolean; oldPixel: number[] }
interface LayeredMapProbe {
    frame?: Frame;
    watch?: Point;
    drag: DragFrame[];
    resized: { width: number; height: number; alpha: number }[];
    terrain: number;
    plots: { ticks: string[]; fills: number; clears: number };
}
declare global {
    interface Window { layeredMapProbe: LayeredMapProbe }
}
async function observeLayeredMap() {
    const probe: LayeredMapProbe = { drag: [], resized: [], terrain: 0, plots: { ticks: [], fills: 0, clears: 0 } };
    window.layeredMapProbe = probe;
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
            if (node.construction.type === "outline") {
                const [x, y] = this.screen(probe.watch).map(p => Math.floor(p * this.dpr));
                const oldPixel = [...this.ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
                probe.drag.push({ projectPosition: node.construction.outlines[0].nodes[0].p, committing: !!view.dragCommitting,
                    previewPosition: preview?.type === "outline" ? preview.outlines[0].nodes[0].p : undefined, oldPixel });
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
        mountain.ridges.push({ curve: openCurve([{ p: [-33, y], h: 5 }, { p: [-7, y], h: 5 }, { p: [18, y], h: 5 }], "corner", "ridge-" + y + "-"),
            slope: 2 });
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

function layeredMap(browser: Chromium, d: Design, filename: string) {
    const { cdp, click, evaluate, mouse, wait, saved } = browser;
    const panel = (id: string) => click("[data-tab=" + id + "]");
    const property = (id: string) => click("[data-property-tab=" + id + "]");
    const text = (selector: string) => evaluate(s => document.querySelector<HTMLElement>(s)?.innerText.trim() ?? "", selector);
    const paint = () => evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const disk = () => evaluate(name => window.disk(name), filename);
    const authored = async () => parseDesign(await disk(), true);
    const frame = () => evaluate(() => window.layeredMapProbe.frame!);
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
            const { center, scale, width, height } = window.layeredMapProbe.frame!;
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
    async function openDesign(name: string, design: Design) {
        await evaluate(async ({ name, bytes }) => {
            window.probe.openName = name;
            const file = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
        }, { name, bytes: serializeDesign(design) });
        await click("#open");
        await wait(name => document.querySelector("#filename")?.textContent === name && !!window.layeredMapProbe.frame, name);
        await saved();
        await fit();
    }
    return { ...browser, d, panel, property, text, paint, saved, disk, authored, frame, fit, undo, point, at, tap, drag, menuFor, show, panAway, inMap, pickField, openDesign };
}

export async function withLayeredMap(url: string, scene: string, check: (page: ReturnType<typeof layeredMap>) => Promise<void>) {
    const browser = await startChromium(), d = sampleDesign(), filename = scene + ".json";
    const page = layeredMap(browser, d, filename), { cdp, click, evaluate, wait, panel, fit, openDesign } = page;
    try {
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await cdp("Page.navigate", { url });
        await wait(() => !!document.querySelector(".empty-state"));
        await evaluate(observeLayeredMap);
        await openDesign(filename, d);
        await panel("layers");
        await click("input[data-layer=issues]");
        await click("input[data-layer=contours]");
        await click("input[data-layer=grid]");
        await panel("terrain"); await fit();
        await check(page);
    }
    finally {
        await browser.close();
    }
}