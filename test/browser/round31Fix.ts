import assert from "node:assert/strict";
import { geometryPath } from "../../src/core/edit/geoControls.ts";
import { type Point } from "../../src/core/design/v5.ts";
import { distance, mixPoint } from "../../src/core/math/geometry.ts";
import { mapColors, overlay } from "../../src/render/palette.ts";
import { layer, openCurve, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

function scene() {
    const design = syntheticDesign(), outlines = rect(-43, -22, -6, 16);
    for (const [prefix, region] of [["hole", rect(-37, -16, -12, 10)], ["island", rect(-30, -8, -20, 3)]] as const) {
        const path = region.paths[0];
        for (const node of path.nodes) node.id = prefix + node.id;
        outlines.paths.push(path);
    }
    design.geoNodes = [
        layer("G", rect(-57, -45, 57, 45), { type: "ground", value: 3 }),
        layer("A", outlines, { type: "slope", kind: "path", line: openCurve([{ p: [-38, -19], h: 4 }, { p: [-13, -18], h: 15 }]) }),
        layer("M", rect(-48, 19, 31, 40), {
            type: "mountain",
            ridges: [{ line: openCurve([{ p: [-43, 25], h: 12 }, { p: [-26, 28], h: 14 }, { p: [-9, 27], h: 7 }]), slope: 1 }],
            peaks: [{ at: { p: [20, 31], h: 17 }, radius: 12, noise: 0, scale: 1 }]
        }),
        { ...layer("D", rect(23, -28, 43, -15), { type: "flat", amount: 3 }), disabled: true }
    ];
    design.marks = [{ id: "N", kind: "text", label: "标记 A", follow: "map", point: [25, -6] }];
    design.sections = [{ id: "Q", label: "剖面线 A", points: [[-18, -32], [41, -32]] }];
    return design;
}

export async function checkRound31Fix(url: string) {
    await withCurveMap(url, "outline-and-hover", async page => {
        const { authored, click, curve, disk, drag, evaluate, frame, key, paint, pixels, pointer, saved, screenshot, tap, text, translated, undo, wait } = page;
        const original = await authored(), owner = page.owner(original, "A"), inside: Point = [-25, -3], alt = 1;
        const outlineHeading = (id: string) => "[data-outline='" + id + "'] > .subitem-heading";
        const currentOutline = () => text("[data-outline].selected > .subitem-heading .subitem-toggle");
        const menu = ".context-menu", accent = mapColors.light.accent;
        const strokes = (width = 4) => evaluate(width => window.curveMapProbe.strokes.filter(s => s.width === width), width);
        const hoverStrokes = async () => (await strokes()).filter(s => Math.abs(s.alpha - .3) < 1e-6);
        async function moveTo(selector: string) {
            const point = await evaluate(selector => {
                const target = document.querySelector<HTMLElement>(selector)!;
                target.scrollIntoView({ block: "nearest" });
                const box = target.getBoundingClientRect();
                return [box.left + box.width / 2, box.top + box.height / 2] as Point;
            }, selector);
            await pointer("mouseMoved", point, 0, "none");
            await paint();
        }
        async function leave() {
            await moveTo(".topbar h1");
            assert.equal((await frame()).hovered, undefined);
        }

        await click("[data-tab=layers]");
        await click("input[data-layer=geoNodes]");
        await click("input[data-layer=issues]");
        await paint();

        console.log("Nested contours are chosen by area and cycle in layer order");
        await tap(inside);
        assert.equal((await frame()).selection?.id, "A");
        assert.equal((await frame()).outline, undefined);
        const shift = 30 / (await frame()).scale;
        await drag(inside);
        const movedOwner = page.owner(await authored(), "A");
        for (const path of [-1, 0, 1, 2])
            translated(geometryPath(owner, path)!.nodes.map(n => n.p), geometryPath(movedOwner, path)!.nodes.map(n => n.p), shift);
        await undo();
        await tap(inside);
        assert.equal((await frame()).outline, 2);
        assert.equal((await frame()).vertex, undefined);
        assert.equal(await currentOutline(), "轮廓 3");
        assert(await evaluate(() => {
            const heading = document.querySelector("[data-outline].selected .subitem-heading")!, pane = document.querySelector("#property-content")!;
            const box = heading.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
            return box.top >= bounds.top && box.bottom <= bounds.bottom &&
                getComputedStyle(heading).backgroundColor === getComputedStyle(document.querySelector("[data-geo-node=A]")!.parentElement!).backgroundColor;
        }));
        const [whole] = await strokes();
        assert.equal(whole.color, accent);
        assert.deepEqual(whole.dash, []);
        assert.equal(whole.alpha, 1);
        assert.equal(whole.points.length, 5);
        await screenshot("selected-outline");
        for (const [id, index] of [["A", 1], ["A", 0], ["G", undefined]] as const) {
            await tap(inside, alt);
            assert.equal((await frame()).selection?.id, id);
            assert.equal((await frame()).outline, index);
        }
        await tap(inside, 0, "right");
        assert.equal((await frame()).outline, 2);
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll(".context-menu .group-name")].map(n => n.textContent)), ["轮廓 3", "区域", "地件"]);
        await key("Escape");
        await drag(inside);
        const movedOutline = page.owner(await authored(), "A");
        for (const path of [-1, 0, 1]) assert.deepEqual(geometryPath(movedOutline, path), geometryPath(owner, path));
        translated(geometryPath(owner, 2)!.nodes.map(n => n.p), geometryPath(movedOutline, 2)!.nodes.map(n => n.p), shift);
        await undo();
        assert.equal((await frame()).outline, 2);
        const before = await disk();
        await key("Delete");
        await wait(() => document.querySelector("#remove-dialog[open]"));
        await click("#remove-dialog [value=remove]");
        await wait(() => {
            const owner = window.curveMapProbe.editor!.project.design.geoNodes.find(n => n.id === "A")!;
            return owner.construction.type === "free" && owner.construction.paths.length === 2;
        });
        await saved(); await paint();
        assert.equal(geometryPath(page.owner(await authored(), "A"), 2), undefined);
        await undo();
        assert.equal(await disk(), before);
        assert.equal((await frame()).outline, 2);

        console.log("Sidebar hovering uses the same map strokes and handles without changing the camera");
        const camera = () => evaluate(() => {
            const { center, scale } = window.curveMapProbe.editor!.map;
            return { center, scale };
        });
        const viewport = await camera();
        await click("[data-tab=layers]"); await click("input[data-layer=geoNodes]"); await click("[data-tab=terrain]");
        for (const id of ["M", "D"]) {
            await moveTo("[data-geo-node=" + id + "]");
            assert.equal((await frame()).hovered?.id, id);
            assert(await evaluate(() => window.curveMapProbe.pathStrokes.some(s => Math.abs(s.width - 1) < .001 && s.color === "rgba(34, 102, 89, 0.5)")));
            await leave();
            assert(!await evaluate(() => window.curveMapProbe.pathStrokes.some(s => Math.abs(s.width - 1) < .001)));
        }
        await evaluate(() => document.querySelector<HTMLButtonElement>("[data-geo-node=D]")!.focus());
        await paint();
        assert.equal((await frame()).hovered, undefined);

        await moveTo(outlineHeading("0"));
        assert.equal((await frame()).hoverPart?.role, "outline");
        assert.deepEqual((await hoverStrokes()).map(s => s.dash), [[]]);
        await leave();
        assert.deepEqual(await hoverStrokes(), []);
        await moveTo(outlineHeading("island0"));
        assert.equal((await frame()).hoverPart?.role, "outline");
        assert.deepEqual(await hoverStrokes(), []);
        await leave();
        await click("[data-tab=layers]"); await click("input[data-layer=geoNodes]"); await click("[data-tab=terrain]");

        const ridge = await curve(), node = ridge.nodes[1].p;
        await tap(node); await tap(node);
        const nodeHeading = "[data-curve-node] > .subitem-heading";
        const local = pixels(await frame(), node, true);
        const nodeDots = async () => (await evaluate(() => window.curveMapProbe.dots)).filter(d => distance(d.point, local) < .01 && d.color === accent);
        assert.equal((await nodeDots()).length, 1);
        await moveTo(nodeHeading);
        assert.equal((await frame()).hoverPart?.role, "vertex");
        assert.equal((await nodeDots()).length, 1);
        await leave();
        assert.equal((await frame()).hoverPart, undefined);

        for (const selector of [".subitem-heading:has([aria-label=删除山脊])", ".parameter-row:has([aria-label=山脊线])"]) {
            await moveTo(selector);
            assert.equal((await frame()).hoverPart?.role, "curve");
            assert.deepEqual((await hoverStrokes()).map(s => s.dash), [[...overlay.dash]]);
            await leave();
            assert.deepEqual(await hoverStrokes(), []);
        }
        await tap(mixPoint(ridge.nodes[0].p, node, .5));
        await moveTo("[data-curve-segment] > .subitem-heading");
        assert.equal((await frame()).hoverPart?.role, "segment");
        assert.deepEqual(await hoverStrokes(), []);
        assert.deepEqual((await strokes())[0].dash, [...overlay.dash]);
        await leave();

        await moveTo(".subitem-heading:has([aria-label=删除山峰])");
        assert.equal((await frame()).hoverPart?.role, "parameter");
        const peak = pixels(await frame(), [20, 31], true);
        assert((await evaluate(() => window.curveMapProbe.dots)).some(d => distance(d.point, peak) < .01 && d.color === accent));
        await leave();
        assert(!(await evaluate(() => window.curveMapProbe.dots)).some(d => distance(d.point, peak) < .01 && d.color === accent));
        assert.deepEqual(await camera(), viewport);

        console.log("Browser menus are suppressed outside editable text and coordinate slots stay aligned");
        const contextAvailable = (selector: string) => evaluate(selector => {
            const target = document.querySelector(selector)!;
            const box = target.getBoundingClientRect();
            return target.dispatchEvent(new MouseEvent("contextmenu", {
                bubbles: true, cancelable: true, button: 2, clientX: box.left + 2, clientY: box.top + 2
            }));
        }, selector);
        await click("[data-tab=inputs]");
        for (const selector of ["[data-select-input=seed]", "[data-select-field=height]", ".topbar h1", "#panel", "#map"]) {
            assert.equal(await contextAvailable(selector), false);
            assert.equal(await text(menu), "");
        }
        await click("[data-tab=terrain]");
        assert.equal(await contextAvailable("[data-stack-row=viewport]"), false);
        assert.equal(await text(menu), "");
        assert.equal(await contextAvailable("#terrain-search"), true);

        const readingSize = () => evaluate(() => {
            const position = document.querySelector("#position")!, zoom = document.querySelector(".zoom-tools")!;
            const box = position.getBoundingClientRect();
            return { width: box.width, right: box.right, zoomRight: zoom.getBoundingClientRect().right,
                slots: [...position.querySelectorAll(".reading")].map(el => el.getBoundingClientRect().width),
                font: getComputedStyle(position).fontFamily, digits: getComputedStyle(position).fontVariantNumeric };
        });
        const readAt = async (p: Point) => {
            await pointer("mouseMoved", pixels(await frame(), p), 0, "none");
            await wait(() => !(document.querySelector<HTMLOutputElement>("#position")?.hidden));
            await paint();
            return text("#position");
        };
        assert.match(await readAt([-18, -34]), /高度 3\.0 m$/);
        const reading = await readingSize();
        assert.match(await readAt([10, 7]), /^X 10\.0 m\s+Y 7\.0 m/);
        assert.deepEqual(await readingSize(), reading);
        assert.match(await readAt([61, 0]), /高度 –$/);
        assert.deepEqual(await readingSize(), reading);
        assert.equal(reading.right, reading.zoomRight);
        assert.equal(reading.digits, "tabular-nums");
        assert.equal(reading.font, await evaluate(() => getComputedStyle(document.body).fontFamily));
        const clip = await evaluate(() => {
            const reading = document.querySelector("#position")!.getBoundingClientRect(), zoom = document.querySelector(".zoom-tools")!.getBoundingClientRect();
            const x = Math.min(reading.left, zoom.left) - 8, y = zoom.top - 8;
            return { x, y, width: reading.right - x + 8, height: reading.bottom - y + 8 };
        });
        await screenshot("coordinate-reading", clip);
        await evaluate(() => window.curveMapProbe.editor!.map.panTo([600, 600]));
        await paint();
        const panned = await readingSize();
        assert(panned.slots[0] > reading.slots[0] && panned.slots[1] > reading.slots[1]);
        assert.equal(panned.slots[2], reading.slots[2]);
    }, scene());
}