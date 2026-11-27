import assert from "node:assert/strict";
import { pathHandle } from "../../src/core/design/path.ts";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { evaluateStack } from "../../src/core/terrain/terrain.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { withNodeSlope, addLayer, fixtureCurve, literalCurve, openCurve, rect, syntheticDesign, fixtureConstruction } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

const zoomFace = "#zoom-value .numeric-face";
const nodeType = "[role=group][aria-label=节点类型]";
const sourcePoints: Point[] = [[10, 16], [21, 23], [34, 16]];
const slopePoints: Point[] = [[-36, 20], [-24, 27], [-12, 20]];

function designFixture(): Design {
    const d = syntheticDesign(), outline = rect(-29, -18, -12, -4), land = d.geoNodes[1];
    Object.assign(outline.outlines[0].curve.nodes[0], { in: [0, 4], out: [4, -1] });
    land.label = "西台"; land.construction = fixtureConstruction(d, outline);
    d.geometry.ridge = { label: "脊形", independent: true, curve: openCurve<never>(sourcePoints.map(p => ({ p })), "auto", "r") };
    d.geoNodes.push(
        { ...addLayer(d, "E", rect(9, -20, 26, -7), { type: "flat", amount: 3 }), label: "东台" },
        { ...addLayer(d, "M", rect(3, 9, 43, 40), { type: "mountain", valleys: [], ridges: [
            { curve: withNodeSlope(openCurve([{ p: [6, 30], h: 6 }, { p: [30, 32], h: 8 }]), 1) }
        ], peaks: [] }), label: "东山" },
        addLayer(d, "S", rect(-43, 10, -7, 38), { type: "slope", kind: "path",
            lines: [{ curve: openCurve(slopePoints.map((p, i) => ({ p, ...(i !== 1 && { h: i + 1 }) })), "corner", "s") }], center: [0, 0], radius: 5, value: 2, rate: -.2 })
    );
    return d;
}

type Page = Parameters<typeof withCurveMap>[2] extends (page: infer P) => Promise<void> ? P : never;

async function enterNumber(page: Page, face: string, value: string) {
    await page.click(face);
    await page.wait(() => !!document.activeElement?.matches(".numeric-edit"));
    await page.evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
    await page.cdp("Input.insertText", { text: value });
}

async function cropped(page: Page, name: string, selector: string) {
    const clip = await page.evaluate(selector => {
        const { left, top, width, height } = document.querySelector(selector)!.getBoundingClientRect();
        return { x: left - 3, y: top - 3, width: width + 6, height: height + 6 };
    }, selector);
    await page.screenshot(name, clip);
}

export function checkCurveZoom(url: string) {
    return withCurveMap(url, "round37-zoom", async page => {
        const { click, cdp, evaluate, frame, key, paint, tap, drag, saved, authored, boundary, wait, text, undo, nodeTitles } = page;
        const camera = () => evaluate(() => window.curveMapProbe.editor!.map.center.slice());
        const viewportCenter = () => evaluate(() => {
            const map = window.curveMapProbe.editor!.map;
            return map.world(map.width / 2, map.height / 2);
        });
        const originalCenter = await viewportCenter();
        await enterNumber(page, zoomFace, "250");
        await key("Enter"); await paint();
        assert.equal(await text(zoomFace), "250%");
        assert(distance(await viewportCenter(), originalCenter) < 1e-9);
        await enterNumber(page, zoomFace, "500%");
        await key("Escape");
        assert.equal(await text(zoomFace), "250%");
        await enterNumber(page, zoomFace, "3001%");
        await key("Enter");
        assert.match(await text("#zoom-value [role=alert]"), /5% 到 3000%/);
        assert(Math.abs(await evaluate(() => window.curveMapProbe.editor!.map.zoomFactor()) - 2.5) < 1e-9);
        await key("Escape");
        const positions = () => evaluate(() => [".zoom-tools", "#minus", "#plus", "#fit"].map(s => {
            const { width, x } = document.querySelector(s)!.getBoundingClientRect();
            return [width, x];
        }));
        await enterNumber(page, zoomFace, "5%"); await key("Enter"); await paint();
        const atMinimum = await positions();
        assert.equal(await text(zoomFace), "5%");
        await enterNumber(page, zoomFace, "3000"); await key("Enter"); await paint();
        assert.equal(await text(zoomFace), "3000%");
        assert.deepEqual(await positions(), atMinimum);
        await click("#fit"); await paint();
        assert.equal(await text(zoomFace), "100%");

        const wheel = (deltaY: number, deltaX = 0, shiftKey = false, ctrlKey = false) => evaluate(({ deltaY, deltaX, shiftKey, ctrlKey }) => {
            const canvas = document.querySelector("#map")!;
            const { x, y, width, height } = canvas.getBoundingClientRect();
            canvas.dispatchEvent(new WheelEvent("wheel", { clientX: x + width / 2, clientY: y + height / 2,
                deltaX, deltaY, shiftKey, ctrlKey, bubbles: true, cancelable: true }));
        }, { deltaY, deltaX, shiftKey, ctrlKey });
        async function exponent(y: number, x: number, shift = false, ctrl = false) {
            await click("#fit"); await paint();
            const before = (await frame()).scale;
            await wheel(y, x, shift, ctrl); await paint();
            return Math.log((await frame()).scale / before);
        }
        const ordinary = await exponent(-120, 0);
        assert(ordinary > 0);
        assert(Math.abs(await exponent(-120, 0, true) - ordinary * .25) < 1e-9);
        assert(Math.abs(await exponent(0, -120, true) - ordinary * .25) < 1e-9);
        const ctrl = await exponent(-120, 0, false, true);
        assert(Math.abs(await exponent(-120, 0, true, true) - ctrl * .25) < 1e-9);
        assert(Math.abs(await exponent(0, -120, true, true) - ctrl * .25) < 1e-9);
        const beforePan = await frame(), center = await camera();
        await wheel(9, 4, true); await paint();
        assert.equal((await frame()).scale, beforePan.scale);
        assert.notDeepEqual(await camera(), center);
        await enterNumber(page, zoomFace, "175%");
        await wheel(-120, 0, false, true); await paint();
        assert.equal(await text("#zoom-value .numeric-edit"), "175%");
        await key("Enter"); await paint();
        assert.equal(await text(zoomFace), "175%");

        await click("#fit"); await paint();
        await click("[data-geo-node=T]");
        const [corner] = boundary(await authored(), "T").nodes, other = structuredClone(corner.in);
        await page.tapLayer(corner.p, "vertex", "T");
        await wait(() => !!document.querySelector("[data-curve-node]"));
        const endpoint: Point = [corner.p[0] + corner.out![0], corner.p[1] + corner.out![1]];
        await drag(endpoint); await saved();
        const after = boundary(await authored(), "T").nodes[0];
        assert.equal(after.mode, "corner");
        assert.deepEqual(after.in, other);
        assert.notDeepEqual(after.out, corner.out);
        assert(await evaluate(selector => document.querySelector(selector + " [aria-label=尖角]")?.getAttribute("aria-pressed") === "true", nodeType));
        const outline = () => authored().then(d => boundary(d, "T"));
        const dragged = await outline(), menu = ".context-menu [data-option=retract-handle]";
        const out = pathHandle(dragged, 0, "out");
        await tap(out);
        await tap(out, 0, "left", 2);
        await saved();
        let retracted = (await outline()).nodes[0];
        assert.equal(retracted.mode, "corner");
        assert.deepEqual(retracted.in, other);
        assert(!Object.hasOwn(retracted, "out"));
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        await undo();
        assert.deepEqual((await outline()).nodes[0], after);

        await click(nodeType + " [aria-label=手动平滑]"); await saved(); await paint();
        const manual = await outline();
        assert.equal(manual.nodes[0].mode, "manual");
        await tap(manual.nodes[0].p, 0, "right");
        assert.equal(await text(menu), "");
        await key("Escape");
        await tap(pathHandle(manual, 0, "in"), 0, "right");
        await click(menu); await saved(); await paint();
        retracted = (await outline()).nodes[0];
        assert.equal(retracted.mode, "corner");
        assert(!Object.hasOwn(retracted, "in"));
        assert.deepEqual(retracted.out, manual.nodes[0].out);
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        await undo();
        assert.deepEqual((await outline()).nodes[0], manual.nodes[0]);
        await click(nodeType + " [aria-label=尖角]"); await saved();

        await cropped(page, "round37-node-types-light", nodeType);
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
        await wait(() => document.documentElement.dataset.theme === "dark");
        await cropped(page, "round37-node-types-dark", nodeType);
    }, designFixture());
}

export function checkSharedCurves(url: string) {
    return withCurveMap(url, "round37-shared", async page => {
        const { click, evaluate, key, saved, authored, frame, tap, drag, paint, text, undo, wait } = page;
        const menu = ".reference-menu[aria-label=引用曲线]";
        const owner = (d: Design, id: string) => d.geoNodes.find(node => node.id === id)!;
        const option = (id: string) => menu + " [data-option=" + JSON.stringify(id) + "]";
        const region = async (id: string) => {
            await click("[data-geo-node=" + id + "]");
            await click("[data-property-tab=region]");
        };
        const ridge = async () => {
            await click("[data-geo-node=M]");
            await click("[data-property-tab=function]");
            if (!await evaluate(() => !!document.querySelector("[aria-label=山脊线]")))
                await click(".part:has([aria-label=添加山脊]) .subitem-toggle");
        };
        async function useSource(label: string, id: string) {
            await click("[aria-label=" + JSON.stringify("为“" + label + "”引用曲线") + "]");
            await click(option(id)); await saved(); await paint();
        }
        const terrain = () => evaluate(() => {
            const samples = window.curveMapProbe.editor!.project.terrain.fields.height;
            return { values: Array.from(samples.values), defined: Array.from(samples.defined) };
        });

        const nameIsSelected = (label: string) => wait(name => {
            const input = document.activeElement;
            return input instanceof HTMLInputElement && input.getAttribute("aria-label") === name &&
                input.value.length > 0 && input.selectionStart === 0 && input.selectionEnd === input.value.length;
        }, label);
        await click("[data-tab=inputs]");
        await click("[data-add=input]"); await saved();
        await nameIsSelected("自定义输入名称");
        await click("[data-add=field]"); await saved();
        await nameIsSelected("场名称");
        await click("[data-add=geometry]");
        await click(".creation-menu [data-option=geometryClosed]");
        const ring: Point[] = [[-29, -18], [-12, -18], [-12, -4], [-29, -4]];
        for (const p of ring) await tap(p, 2);
        await tap(ring[0], 2); await saved(); await paint();
        const id = (await frame()).selection!.id;
        const original = literalCurve(await authored(), id);
        assert(original.closed && original.nodes.length === 4);
        assert.equal((await frame()).selection?.id, id);
        await nameIsSelected("曲线名称");
        await cropped(page, "round37-curve-group", "#panel .part:has([data-add=geometry])");

        await click("[data-tab=terrain]");
        await region("T"); await useSource("轮廓 1", "curve:" + id);
        await region("E"); await useSource("轮廓 1", "curve:" + id);
        const before = await authored(), beforeWest = owner(before, "T").construction;
        await click("[data-geo-node=E]");
        const from = page.pixels(await frame(), [-21, -11]), to: Point = [from[0] + 144, from[1]];
        await page.pointer("mousePressed", from); await page.pointer("mouseMoved", to);
        await page.pointer("mouseReleased", to); await saved(); await paint();
        const moved = await authored(), east = owner(moved, "E").construction;
        assert(east.type === "outline" && "curve" in east.outlines[0] && east.outlines[0].curve === id);
        const offset = east.outlines[0].offset!;
        assert(offset[0] > 15 && Math.abs(offset[1]) < .01);
        assert.deepEqual(owner(moved, "T").construction, beforeWest);
        assert.deepEqual(literalCurve(moved, id), original);

        const at: Point = [original.nodes[0].p[0] + offset[0], original.nodes[0].p[1] + offset[1]];
        await page.tapLayer(at, "vertex", "E");
        await drag(at, 2);
        const reshaped = await authored();
        assert(literalCurve(reshaped, id).nodes[0].p[0] > original.nodes[0].p[0]);
        assert.deepEqual(owner(reshaped, "T").construction, beforeWest);
        assert.deepEqual(owner(reshaped, "E").construction, east);
        const westNode = await evaluate(() => {
            const c = window.curveMapProbe.editor!.project.resolved.geoNodes.find(n => n.id === "T")!.construction;
            return c.type === "outline" && c.outlines[0].nodes[0].p;
        });
        assert.deepEqual(westNode, literalCurve(reshaped, id).nodes[0].p);

        await click("[data-property-tab=region]");
        await click("[aria-label='为“轮廓 1”引用曲线']");
        assert(await evaluate(s => document.querySelector(s)?.getAttribute("aria-selected") === "true", option("curve:" + id)));
        await cropped(page, "round37-curve-reference-menu", menu);
        await key("Escape");
        const sameMenu = ".reference-menu[aria-label=引用轮廓]";
        await click("#properties [aria-label=引用轮廓]");
        assert.equal(await text(sameMenu + " [data-option='geo:T.construction.outlines.0']"), "西台.轮廓 1");
        await click(sameMenu + " [data-option='geo:T.construction.outlines.0']"); await saved();
        const eastAttached = owner(await authored(), "E").construction;
        assert(eastAttached.type === "outline" && "ref" in eastAttached.outlines[0]);
        await click("#properties [aria-label=引用轮廓]");
        await click(sameMenu + " [data-option=unlink]"); await saved();
        const detached = owner(await authored(), "E").construction, west = owner(reshaped, "T").construction;
        assert(detached.type === "outline" && west.type === "outline" && "curve" in detached.outlines[0] && "curve" in west.outlines[0]);
        assert.notEqual(detached.outlines[0].curve, west.outlines[0].curve);
        assert.deepEqual(literalCurve(await authored(), detached.outlines[0]), literalCurve(reshaped, west.outlines[0]));

        await click("[data-tab=inputs]"); await click("[data-select-geometry=" + id + "]");
        await click("[aria-label=删除曲线]");
        assert.match(await text("#remove-dialog"), /无法删除“曲线 \d+”[\s\S]*西台.轮廓 1/);
        await click("#remove-dialog button[value=cancel]");

        await click("[data-tab=terrain]"); await ridge();
        await useSource("山脊线", "curve:ridge");
        for (const [i, value] of [[0, 12], [2, 19]]) {
            await page.tapLayer(sourcePoints[i], "vertex", "M");
            await enterNumber(page, "[data-parameter$='.ridges.0.h.r" + i + "'] .numeric-face", String(value));
            await key("Enter"); await saved(); await paint();
        }
        const equivalent = await authored(), f = owner(equivalent, "M").function;
        assert(f.type === "mountain");
        const holder = f.ridges[0];
        assert("curve" in holder && holder.curve === "ridge");
        assert.equal(holder.h?.r0, 12);
        assert.equal(holder.h?.r2, 19);
        assert(Number.isFinite(holder.h?.r1));
        assert.deepEqual(holder.slope, { r0: 1, r1: 1, r2: 1 });
        assert.deepEqual(holder.interpolate?.r1, ["h", "slope"]);
        f.ridges[0] = fixtureCurve(equivalent, { curve: withNodeSlope(openCurve(sourcePoints.map((p, i) => ({ p, ...(i !== 1 && { h: i ? 19 : 12 }) })), "auto", "r"), 1) }, ["h", "slope"]);
        const expected = evaluateStack(equivalent).fields.height;
        assert.deepEqual(await terrain(), { values: Array.from(expected.values), defined: Array.from(expected.defined) });

        await tap(sourcePoints[2], 0, "right");
        await click("[data-option=continue-curve]");
        assert.equal(await text(".drawing-status strong"), "继续画“东山.山脊 1.山脊线”");
        await tap([38, 22], 2); await tap([42, 26], 2);
        await key("Backspace"); await key("Enter"); await saved(); await paint();
        const tail = literalCurve(await authored(), "ridge");
        assert.equal(tail.nodes.length, 4);
        assert(distance(tail.nodes[3].p, [38, 22]) < .25 && !Object.hasOwn(tail.nodes[3], "h"));
        assert.equal((await frame()).vertex?.index, 3);
        await undo();
        assert.equal(literalCurve(await authored(), "ridge").nodes.length, 3);

        await tap(sourcePoints[0], 0, "right");
        await click("[data-option=continue-curve]");
        await tap([5, 18], 2); await key("Escape"); await paint();
        assert.equal(literalCurve(await authored(), "ridge").nodes.length, 3);
        await tap(sourcePoints[0], 0, "right");
        await click("[data-option=continue-curve]");
        await tap([5, 18], 2); await key("Enter"); await saved(); await paint();
        const head = literalCurve(await authored(), "ridge");
        assert.equal(head.nodes.length, 4);
        assert(distance(head.nodes[0].p, [5, 18]) < .25);
        assert.equal((await frame()).vertex?.index, 0);
        await undo();

        await click("[data-geo-node=S]"); await click("[data-property-tab=function]");
        await click(".part:has([aria-label=添加坡线]) .subitem-toggle");
        await click("[aria-label=坡线]"); await tap(slopePoints[2], 0, "right");
        await click(".context-menu [data-option=continue-curve]");
        await tap([-18, 16], 2); await tap(slopePoints[0]); await saved(); await paint();
        const slope = owner(await authored(), "S").function;
        assert(slope.type === "slope" && slope.kind === "path");
        const held = slope.lines[0], line = literalCurve(await authored(), held);
        assert("curve" in held && line.closed && line.nodes.length === 4);
        assert(held.interpolate?.[line.nodes[3].id].includes("h") && Number.isFinite(held.h?.[line.nodes[3].id]));
        assert.deepEqual(line.nodes.slice(0, 3).map(n => n.p), slopePoints);
    }, designFixture());
}