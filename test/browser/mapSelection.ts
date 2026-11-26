import assert from "node:assert/strict";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { distance, mixPoint } from "../../src/core/math/geometry.ts";
import { mapColors } from "../../src/render/palette.ts";
import { type Chromium } from "./chromium.ts";
import { type Curve, type GeoNode, type Section } from "../../src/core/design/v5.ts";
import { pathBezier, splitBezier } from "../../src/core/design/path.ts";
import { withLayeredMap } from "./layeredMapFixture.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export async function checkMapSelection(url: string) {
    await withLayeredMap(url, "map-label-selection", async ({ at, authored, cdp, click, d, evaluate, frame, inMap, key, menuFor, mouse, paint, panAway, panel, property, saved, screenshot, show, tap, text, undo }) => {
        const region = "[data-geo-node=A]", mapMark = "[data-mark=M]", section = "[data-section=S]";
        console.log("clicking and dragging map names");
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

        console.log("drag preview survives the pending terrain edit");
        const from = await at([-28, 4]), to = await at([-21, 8]);
        await evaluate(() => {
            window.layeredMapProbe.watch = [-36, 2];
            window.layeredMapProbe.drag = [];
        });
        await click("[data-geo-node=D]"); await paint();
        await mouse("mousePressed", ...from); await paint();
        await mouse("mouseMoved", ...to); await paint();
        const pre = await evaluate(() => window.layeredMapProbe.drag);
        assert(pre.some(f => f.previewPosition && !f.committing), "The drag preview was visible before release");
        const oldPixel = pre.at(-1)!.oldPixel;
        await evaluate(() => window.layeredMapProbe.drag = []);
        await mouse("mouseReleased", ...to); await saved(); await paint();
        const frames = await evaluate(() => {
            window.layeredMapProbe.watch = undefined;
            return window.layeredMapProbe.drag;
        });
        const pending = frames.filter(f => f.projectPosition[0] === -36);
        assert(pending.length > 0);
        assert(pending.every(f => f.committing && f.previewPosition && f.previewPosition[0] > -36));
        const background = pre[0].oldPixel;
        assert.notDeepEqual(oldPixel, background);
        for (const f of pending) assert.deepEqual(f.oldPixel, background);
        assert(frames.some(f => f.projectPosition[0] > -36 && !f.previewPosition));
        await undo();
        await panel("terrain");
        await panAway();
        await menuFor(region);
        await screenshot("list-context");
        await click(".context-menu [data-option=show-in-view]"); await paint();
        for (const p of [[-36, -18], [18, 16]] as Point[]) assert(await inMap(p));
        const visible = await frame();
        await show(region); assert.deepEqual((await frame()).center, visible.center); assert.equal((await frame()).scale, visible.scale);
        await tap(await at([-26, 10]), 0, "right");
        assert(await text(".context-menu [data-option=add-outline]"));
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
        await screenshot("mark-types");
        await key("Escape");
        await panel("inputs");
        for (const row of ["[data-select-input=A]", "[data-select-field=F]"]) {
            await menuFor(row);
            assert.equal(await text(".context-menu [data-option=show-in-view]"), "");
            await key("Escape");
        }
    });
    await withCurveMap(url, "map-object-selection", async ({ assertSectionStroke, authored, boundary, click, curve, drag, evaluate, frame, owner, paint, pixels, pointer: mouse, tap, text, translated, undo }) => {
        const alt = 1;
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
        assert.equal(await text(".geometry-box[aria-label=山脊线][aria-pressed=true]"), "曲线（8 个节点）");
        await tap([30, 37]);
        assert.equal((await frame()).selection?.id, "M");
        assert.deepEqual((await frame()).geometry, { kind: "outline", index: 0 });
        assert(await evaluate(() => !!document.querySelector("[data-property-tab=region][aria-pressed=true]") &&
            !!document.querySelector("[data-outline] [aria-current=true]")));
        assert.equal(await evaluate(() => {
            const { editor, frame } = window.curveMapProbe, ctx = editor!.map.ctx;
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
        await tap(originalLine.nodes[0].p); assert.equal((await frame()).vertex, undefined);
        await tap(originalLine.nodes[0].p); assert.equal((await frame()).vertex?.index, 0);
        await drag([-35, 25]);
        current = await authored();
        assert.equal((await frame()).geometry?.index, -1);
        assert.equal((await frame()).vertex, undefined);
        translated(originalLine.nodes.map(n => n.p), (await curve()).nodes.map(n => n.p), dx);
        assert.deepEqual(owner(current, "M").construction, owner(original, "M").construction);
        await undo();
    });
}

interface LineDragFixture extends Pick<Chromium, "click"> {
    authored: () => Promise<Design>;
    drag: (a: Point, b: Point, preview?: () => Promise<void>) => Promise<void>;
    frame: () => Promise<{ scale: number; section?: Section["points"]; selected?: string; vertex?: unknown; ridgePreview?: Curve }>;
    mountain: GeoNode;
    paint: () => Promise<void>;
    ridge: () => Promise<Curve>;
    saved: () => Promise<void>;
    screen: (point: Point) => Promise<Point>;
    section: () => Promise<Section["points"]>;
    text: (selector: string) => Promise<string>;
    undo: () => Promise<void>;
}

export async function checkLineDragging({ click, authored, drag, frame, mountain, paint, ridge, saved, screen, section, text, undo }: LineDragFixture) {
    console.log("dragging an unselected section or ridge moves the whole line in one undo step");
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