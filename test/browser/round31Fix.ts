import assert from "node:assert/strict";
import { geometryPath } from "../../src/core/edit/geoControls.ts";
import { pathHandle } from "../../src/core/design/path.ts";
import { type PlacedGeoNode, type Point } from "../../src/core/design/v5.ts";
import { distance, mixPoint } from "../../src/core/math/geometry.ts";
import { mapColors, overlay, type Theme } from "../../src/render/palette.ts";
import { layer, openCurve, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

function scene() {
    const design = syntheticDesign(), outlines = rect(-43, -22, -6, 16);
    for (const [prefix, region] of [["hole", rect(-37, -16, -12, 10)], ["island", rect(-30, -8, -20, 3)]] as const) {
        const path = region.outlines[0];
        for (const node of path.curve.nodes) node.id = prefix + node.id;
        outlines.outlines.push(path);
    }
    const ridge = openCurve([{ p: [-43, 25], h: 12 }, { p: [-26, 28], h: 14 }, { p: [-9, 27], h: 7 }]);
    Object.assign(ridge.nodes[1], { mode: "manual", in: [-3, -9 / 17], out: [3, 9 / 17] });
    design.geoNodes = [
        layer("G", rect(-57, -45, 57, 45), { type: "ground", value: 3 }),
        layer("A", outlines, {
            type: "mountain",
            ridges: [
                { curve: openCurve([{ p: [-38, -19], h: 4 }, { p: [-13, -18], h: 15 }], "corner", "outer-ridge-"), slope: 1 },
                { curve: openCurve([{ p: [-29, -6], h: 7 }, { p: [-22, -6], h: 8 }], "corner", "island-ridge-"), slope: 1 },
                { curve: openCurve([{ p: [-41, 14], h: 9 }, { p: [-28, 1], h: 7 }], "corner", "cross-ridge-"), slope: 1 }
            ],
            peaks: [{ at: [-22, 1], height: 11, radius: 8, noise: 0, scale: 1 },
                { at: [-40, 9], height: 12, radius: 9, noise: 0, scale: 1 }]
        }),
        layer("M", rect(-48, 19, 31, 40), {
            type: "mountain",
            ridges: [{ curve: ridge, slope: 1 }],
            peaks: [{ at: [20, 31], height: 17, radius: 12, noise: 0, scale: 1 }]
        }),
        { ...layer("D", rect(23, -28, 43, -15), { type: "flat", amount: 3 }), disabled: true }
    ];
    design.marks = [{ id: "N", kind: "text", label: "标记 A", follow: "map", point: [25, -6] }];
    design.sections = [{ id: "Q", label: "剖面线 A", points: [[-18, -32], [41, -32]] }];
    return design;
}

export async function checkRound31Fix(url: string) {
    await withCurveMap(url, "outline-and-hover", async page => {
        const { authored, cdp, click, curve, disk, drag, evaluate, frame, key, paint, pixels, pointer, saved, screenshot, tap, text, translated, undo, wait } = page;
        const original = await authored(), owner = page.owner(original, "A"), inside: Point = [-25, -3], alt = 1;
        const outlineHeading = (id: string) => "[data-outline='" + id + "'] > .subitem-heading";
        const currentOutline = () => text("[data-outline].selected > .subitem-heading .subitem-toggle");
        const menu = ".context-menu", accent = mapColors.light.accent;
        const strokes = () => evaluate(width => window.curveMapProbe.strokes.filter(s => s.width > width), overlay.selectedWidth);
        const hoverStrokes = async () => (await strokes()).filter(s => Math.abs(s.alpha - .3) < 1e-6);
        async function assertHandle(point: Point, state: "normal" | "hovered" | "selected", theme: Theme = "light") {
            const pixel = await evaluate(point => {
                const { map } = window.curveMapProbe.editor!, [x, y] = map.screen(point);
                return [...map.ctx.getImageData(Math.round(x * map.dpr), Math.round(y * map.dpr), 1, 1).data];
            }, point);
            const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(n => Number.parseInt(n, 16));
            const colors = mapColors[theme], fill = rgb(colors.bgPanel), accent = rgb(colors.accent);
            const expected = state === "selected" ? accent : state === "normal" ? fill :
                fill.map((channel, i) => Math.round(channel + (accent[i] - channel) * overlay.segmentHoverOpacity));
            assert.equal(pixel[3], 255, "The handle center stays opaque");
            assert(pixel.slice(0, 3).every((channel, i) => Math.abs(channel - expected[i]) <= 1),
                `${theme} ${state} handle at ${point}: expected ${expected}, got ${pixel.slice(0, 3)}`);
        }
        async function moveMap(point: Point) {
            await pointer("mouseMoved", pixels(await frame(), point), 0, "none");
            await paint();
        }
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
        await click("input[data-layer=contourLabels]");
        await paint();

        console.log("Nested contours are chosen by area and cycle in layer order");
        await tap(inside);
        assert.equal((await frame()).selection?.id, "A");
        assert.equal((await frame()).outline, undefined);
        const shift = 30 / (await frame()).scale, fn = owner.function;
        assert(fn.type === "mountain");
        const peaks = fn.peaks;
        await drag(inside);
        const movedOwner = page.owner(await authored(), "A");
        for (const path of [-3, -2, -1, 0, 1, 2])
            translated(geometryPath(owner, path)!.nodes.map(n => n.p), geometryPath(movedOwner, path)!.nodes.map(n => n.p), shift);
        assert(movedOwner.function.type === "mountain");
        translated(peaks.map(peak => peak.at), movedOwner.function.peaks.map(peak => peak.at), shift);
        await undo();

        async function dragOutline(index: number, point: Point, ridgePath: number) {
            const checkGeometry = (moved: PlacedGeoNode) => {
                for (const path of [-3, -2, -1, 0, 1, 2]) {
                    const before = geometryPath(owner, path)!, after = geometryPath(moved, path)!;
                    if (path === index) translated(before.nodes.map(n => n.p), after.nodes.map(n => n.p), shift);
                    else assert.deepEqual(after, before);
                }
                const mountain = moved.function;
                assert(mountain.type === "mountain");
                assert.deepEqual(mountain.peaks, peaks);
            };
            const before = await disk();
            await drag(point, 0, async () => {
                const preview = await evaluate(() => window.curveMapProbe.editor!.dragNode!);
                checkGeometry(preview);
                const movedStart = pixels(await frame(), geometryPath(preview, ridgePath)!.nodes[0].p, true);
                const drawn = await evaluate(() => window.curveMapProbe.strokes);
                assert(drawn.some(s => s.color === mapColors.light.parameterGeometry && s.width === overlay.parameterWidth &&
                    s.points.some(p => distance(p, movedStart) < .02)));
                assert.equal(await disk(), before);
            });
            checkGeometry(page.owner(await authored(), "A"));
            await undo();
            assert.equal(await disk(), before);
            assert.equal((await frame()).outline, index);
        }
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
        const whole = await strokes();
        assert.deepEqual(whole.map(s => [s.width, s.color, s.dash, s.alpha, s.points.length]), [[4, accent, [], 1, 5]]);
        await screenshot("selected-outline");
        for (const [id, index] of [["A", 1], ["A", 0], ["G", undefined]] as const) {
            await tap(inside, alt);
            assert.equal((await frame()).selection?.id, id);
            assert.equal((await frame()).outline, index);
            if (index === 0) await dragOutline(0, [-40, 11], -1);
        }
        await tap(inside, 0, "right");
        assert.equal((await frame()).outline, 2);
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll(".context-menu .group-name")].map(n => n.textContent)), ["轮廓 3", "区域", "地件"]);
        await key("Escape");
        await dragOutline(2, inside, -2);
        const before = await disk();
        await key("Delete");
        await wait(() => document.querySelector("#remove-dialog[open]"));
        await click("#remove-dialog [value=remove]");
        await wait(() => {
            const owner = window.curveMapProbe.editor!.project.design.geoNodes.find(n => n.id === "A")!;
            return owner.construction.type === "outline" && owner.construction.outlines.length === 2;
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
        assert.deepEqual((await hoverStrokes()).map(s => [s.width, s.color, s.dash]), [[4, accent, []]]);
        await leave();
        assert.deepEqual(await hoverStrokes(), []);
        await moveTo(outlineHeading("island0"));
        assert.equal((await frame()).hoverPart?.role, "outline");
        assert.deepEqual(await hoverStrokes(), []);
        await leave();
        await click("[data-tab=layers]"); await click("input[data-layer=geoNodes]"); await click("[data-tab=terrain]");

        const outlineNode = geometryPath(owner, 2)!.nodes[0].p;
        await assertHandle(outlineNode, "normal");
        await moveMap(outlineNode);
        assert.equal((await frame()).hoverPart?.role, "vertex");
        await assertHandle(outlineNode, "hovered");
        await tap(outlineNode);
        await assertHandle(outlineNode, "selected");

        const ridge = await curve(), node = ridge.nodes[1].p;
        await tap(node);
        assert.equal((await frame()).geometry?.index, -1);
        await leave();
        await assertHandle(node, "normal");
        await moveMap(node);
        await assertHandle(node, "hovered");
        await tap(node);
        await assertHandle(node, "selected");
        const tangent = pathHandle(ridge, 1, "out");
        await moveMap(tangent);
        assert.equal((await frame()).hoverPart?.role, "out");
        await assertHandle(tangent, "hovered");
        await assertHandle(node, "selected");
        const nodeHeading = "[data-curve-node] > .subitem-heading";
        const local = pixels(await frame(), node, true);
        const nodeDots = async () => (await evaluate(() => window.curveMapProbe.dots)).filter(d => distance(d.point, local) < .01 && d.color === accent);
        assert.equal((await nodeDots()).length, 1);
        await moveTo(nodeHeading);
        assert.equal((await frame()).hoverPart?.role, "vertex");
        assert.equal((await nodeDots()).length, 1);
        await assertHandle(node, "selected");
        await leave();
        assert.equal((await frame()).hoverPart, undefined);
        await assertHandle(node, "selected");

        for (const selector of [".subitem-heading:has([aria-label=删除山脊])", ".parameter-row:has([aria-label=山脊线])"]) {
            await moveTo(selector);
            assert.equal((await frame()).hoverPart?.role, "curve");
            assert.deepEqual((await hoverStrokes()).map(s => [s.width, s.color, s.dash]), [[4, accent, [...overlay.dash]]]);
            await leave();
            assert.deepEqual(await hoverStrokes(), []);
        }
        await tap(mixPoint(ridge.nodes[0].p, node, .5));
        await moveTo("[data-curve-segment] > .subitem-heading");
        assert.equal((await frame()).hoverPart?.role, "segment");
        assert.deepEqual(await hoverStrokes(), []);
        assert.deepEqual((await strokes()).map(s => [s.width, s.color, s.alpha, s.dash]), [[4, accent, 1, [...overlay.dash]]]);
        await leave();

        const peak: Point = [20, 31];
        await moveTo(".subitem-heading:has([aria-label=删除山峰])");
        assert.equal((await frame()).hoverPart?.role, "parameter");
        await assertHandle(peak, "hovered");
        await leave();
        await assertHandle(peak, "normal");
        await moveMap(peak);
        await assertHandle(peak, "hovered");
        await tap(peak);
        await assertHandle(peak, "selected");

        const single: Point = [36, 10];
        await tap(single);
        assert.equal((await frame()).selection?.id, "G");
        assert.equal((await frame()).outline, undefined);
        await click("[data-property-tab=region]");
        await moveTo(outlineHeading("0"));
        assert.equal((await frame()).hoverPart?.role, "outline");
        assert.deepEqual(await strokes(), []);
        await leave();
        await tap(single);
        assert.equal((await frame()).outline, 0);
        assert.equal(await currentOutline(), "轮廓 1");
        assert.deepEqual(await strokes(), []);
        const outlines = await evaluate(() => window.curveMapProbe.pathStrokes);
        assert(outlines.some(s => s.color === accent && Math.abs(s.width - overlay.selectedWidth) < .001));

        const [start, end] = original.sections[0].points;
        await assertHandle(start, "normal");
        await moveMap(start);
        assert.equal((await frame()).hovered?.index, 0);
        await assertHandle(start, "hovered");
        await moveMap(end);
        assert.equal((await frame()).hovered?.index, 1);
        await assertHandle(start, "normal");
        await assertHandle(end, "hovered");
        await tap(end);
        assert.equal((await frame()).selection?.index, 1);
        await assertHandle(end, "selected");
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
        await wait(() => document.documentElement.dataset.theme === "dark");
        await moveMap(start);
        await assertHandle(start, "hovered", "dark");
        await assertHandle(end, "selected", "dark");
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await wait(() => document.documentElement.dataset.theme === "light");
        assert.deepEqual(await camera(), viewport);

        console.log("Browser menus are suppressed outside editable text and coordinates follow the design grid");
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
            const position = document.querySelector<HTMLOutputElement>("#position")!, zoom = document.querySelector(".zoom-tools")!;
            const box = position.getBoundingClientRect();
            return { width: box.width, right: box.right, zoomRight: zoom.getBoundingClientRect().right,
                clipped: position.scrollWidth > position.clientWidth,
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
        const originalCamera = await camera();
        await evaluate(() => window.curveMapProbe.editor!.map.zoomAt(.1));
        await paint();
        assert((await camera()).scale < originalCamera.scale);
        await readAt([10, 7]);
        assert.deepEqual(await readingSize(), reading);

        const panTo = async (center: Point) => {
            await evaluate(point => window.curveMapProbe.editor!.map.panTo(point), center);
            await paint();
            assert.deepEqual((await camera()).center, center);
        };
        await panTo([160, -90]);
        await readAt([10, 7]);
        assert.deepEqual(await readingSize(), reading);

        const far: Point = [6123.5, -7345.6];
        await panTo(far);
        assert.match(await readAt(far), /^X 61\d{2}\.\d m\s+Y -73\d{2}\.\d m\s+高度 –$/);
        const expanded = await readingSize();
        assert(expanded.width > reading.width && expanded.slots[0] > reading.slots[0] && expanded.slots[1] > reading.slots[1]);
        assert.equal(expanded.slots[2], reading.slots[2]);
        assert.equal(expanded.right, expanded.zoomRight);
        assert(!expanded.clipped);

        await panTo(originalCamera.center);
        await readAt([10, 7]);
        assert.deepEqual(await readingSize(), reading);
    }, scene());
}