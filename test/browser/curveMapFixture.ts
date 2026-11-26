import { resolveDesign } from "../../src/core/design/parameters.ts";
import assert from "node:assert/strict";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { geometryPath } from "../../src/core/edit/geoControls.ts";
import { defaultFunction } from "../../src/core/edit/geoNodes.ts";
import { setNodeMode, setSegment } from "../../src/core/edit/paths.ts";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { mapColors, overlay } from "../../src/render/palette.ts";
import { layer, openCurve, rect, syntheticDesign } from "../scenarios.ts";
import { startChromium, type Chromium } from "./chromium.ts";
import { installPickers } from "./filePickers.ts";

type View = import("../../src/render/map.ts").MapView;
interface Stroke { points: Point[]; dash: number[]; color: string; width: number; alpha: number }
interface Reading { text: string; y: number; top: number; bottom: number; baseline: string; align: string }
interface Frame {
    origin: Point; localOrigin: Point; scale: number; selection: View["selection"]; hovered?: View["hovered"];
    geometry?: View["geometry"]; vertex?: View["vertex"]; outline?: number; hoverPart?: View["hoverPart"]; section?: [Point, Point];
}
interface Probe {
    editor?: import("../../src/app/state/session.svelte.ts").Editor;
    frame?: Frame; strokes: Stroke[]; pathStrokes: { color: string; width: number; hits?: boolean[] }[];
    pathChecks?: Point[];
    dots: { point: Point; color: string }[]; ticks: Reading[]; mapText: string[]; release?: () => void;
}
declare global {
    interface Window { curveMapProbe: Probe }
}

async function observeCurveMap() {
    const probe: Probe = { strokes: [], pathStrokes: [], dots: [], ticks: [], mapText: [] };
    window.curveMapProbe = probe;
    const mapModule = "/src/render/map.ts", editorModule = "/src/app/state/session.svelte.ts";
    const { ProjectMap } = await import(mapModule) as typeof import("../../src/render/map.ts");
    const { Editor } = await import(editorModule) as typeof import("../../src/app/state/session.svelte.ts");
    const reconcile = Editor.prototype.reconcileProject;
    Editor.prototype.reconcileProject = function (...args) {
        probe.editor = this;
        return reconcile.apply(this, args);
    };
    const ctx = CanvasRenderingContext2D.prototype;
    const { beginPath, moveTo, lineTo, arc, fill, stroke, clearRect, fillText } = ctx;
    let points: Point[] = [], dot: Point | undefined;
    ctx.beginPath = function () {
        if (this.canvas.id === "map") {
            points = [];
            dot = undefined;
        }
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
    ctx.arc = function (x, y, r, start, end, ccw) {
        if (this.canvas.id === "map") dot = [x, y];
        arc.call(this, x, y, r, start, end, ccw);
    };
    ctx.fill = function (...args: [path?: Path2D | CanvasFillRule, rule?: CanvasFillRule]) {
        if (this.canvas.id === "map" && !args.length && dot) probe.dots.push({ point: dot, color: String(this.fillStyle) });
        Reflect.apply(fill, this, args);
    };
    ctx.stroke = function (...args: [Path2D?]) {
        if (this.canvas.id === "map") {
            if (args.length) {
                probe.pathStrokes.push({ color: String(this.strokeStyle), width: this.lineWidth * this.getTransform().a / devicePixelRatio,
                    hits: probe.pathChecks?.map(([x, y]) => this.isPointInStroke(args[0]!, x * devicePixelRatio, y * devicePixelRatio)) });
            }
            else if (points.length >= 2) probe.strokes.push({ points: points.slice(), dash: this.getLineDash(), color: String(this.strokeStyle),
                width: this.lineWidth, alpha: this.globalAlpha });
        }
        Reflect.apply(stroke, this, args);
    };
    ctx.clearRect = function (...args) {
        if (this.canvas.closest("#plots")) probe.ticks = [];
        clearRect.apply(this, args);
    };
    ctx.fillText = function (text, x, y, width) {
        if (this.canvas.id === "map") probe.mapText.push(text);
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
        probe.pathStrokes = [];
        probe.dots = [];
        probe.mapText = [];
        draw.call(this, view, theme);
        const localOrigin = this.screen([0, 0]), box = this.canvas.getBoundingClientRect();
        probe.frame = {
            localOrigin, origin: [box.left + localOrigin[0], box.top + localOrigin[1]], scale: this.scale,
            selection: view.selection, hovered: view.hovered, geometry: view.geometry, vertex: view.vertex, outline: view.outline, hoverPart: view.hoverPart,
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
    mountain.ridges.push({ curve: line, slope: 1 });
    const region = rect(-46, 18, 43, 40), hole = rect(33, 31, 38, 36).outlines[0];
    for (const node of hole.curve.nodes) node.id = "hole-" + node.id;
    region.outlines.push(hole);
    const ground = rect(-57, -45, 57, 16), upper = rect(48, 20, 57, 41).outlines[0];
    for (const node of upper.curve.nodes) node.id = "upper-" + node.id;
    ground.outlines.push(upper);
    design.geoNodes = [
        layer("G", ground, { type: "ground", value: .2 }),
        layer("A", rect(-37, -13, 3, 13), { type: "flat", amount: 1 }),
        layer("B", rect(-12, -12, 25, 15), { type: "flat", amount: .4 }),
        layer("M", region, mountain)
    ];
    design.sections = [{ id: "Q", label: "剖面线 Q", points: [[-28, 25], [26, 25]], showLabel: false }];
    return design;
}

function curveMap(browser: Chromium, design: Design, name: string, url: string) {
    const { cdp, click, evaluate, wait, saved } = browser;
    const frame = () => evaluate((): Frame => {
        const current = window.curveMapProbe.frame!, { left, top } = document.querySelector("#map")!.getBoundingClientRect();
        return { ...current, origin: [left + current.localOrigin[0], top + current.localOrigin[1]] };
    });
    const paint = () => evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const disk = () => evaluate(name => window.disk(name), name);
    const text = (selector: string) => evaluate(s => document.querySelector<HTMLElement>(s)?.innerText.trim() ?? "", selector);
    const authored = async () => parseDesign(await disk(), true);
    const owner = (d: Design, id: string) => resolveDesign(d).geoNodes.find(n => n.id === id)!;
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
    async function open(first = false) {
        await cdp("Page.navigate", { url: url + "?scene=" + name + "&first=" + first });
        await wait(() => document.querySelector(".empty-state"));
        await evaluate(observeCurveMap);
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
        const strokes = await evaluate(() => window.curveMapProbe.strokes);
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
    return { ...browser, frame, paint, disk, text, authored, owner, curve, boundary, undo, penMode, nodeTitles, pixels, tap, drag, tool, open, translated, assertSectionStroke, moveOverMap, pointer: mouse };
}

export async function withCurveMap(url: string, scene: string, check: (page: ReturnType<typeof curveMap>) => Promise<void>, design = sample()) {
    const browser = await startChromium(), page = curveMap(browser, design, scene + ".json", url);
    const { cdp } = browser;
    try {
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await page.open(true);
        await check(page);
    }
    finally {
        await browser.close();
    }
}