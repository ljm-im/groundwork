import assert from "node:assert/strict";
import { arcGeometry, degreesFromBulge, pathBezier, pathHandle, segmentType, splitBezier } from "../../src/core/design/path.ts";
import { geometryPath } from "../../src/core/edit/geoControls.ts";
import { defaultFunction, holdPoint } from "../../src/core/edit/geoNodes.ts";
import { arcHandle } from "../../src/core/edit/paths.ts";
import { type Curve, type Point } from "../../src/core/design/v5.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { mapColors, overlay, type Theme } from "../../src/render/palette.ts";
import { fixtureSection, withNodeSlope, addLayer, openCurve, rect, syntheticDesign, fixtureCurve } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

function segmentPoint(path: Curve, index: number, t = .5): Point {
    const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length];
    if (a.bulge === undefined) return splitBezier(pathBezier(path, index), t)[0][3];
    const { cx, cy, radius, start, angle } = arcGeometry(a.p, b.p, a.bulge), at = start + t * angle;
    return [cx + radius * Math.cos(at), cy + radius * Math.sin(at)];
}

function scene() {
    const design = syntheticDesign(), region = rect(-45, -18, -10, 12), hole = rect(-36, -8, -25, 4).outlines[0];
    for (const node of hole.curve.nodes) node.id = "hole-" + node.id;
    region.outlines.push(hole);
    const mountain = defaultFunction(design, "mountain");
    assert(mountain.type === "mountain");
    const ridge: Point[] = [[-43, 27], [-32, 31], [-18, 28], [-4, 32], [10, 25]];
    mountain.ridges.push(fixtureCurve(design, { curve: withNodeSlope(openCurve(ridge.map((p, i) => ({ p, h: 5 + i })), "auto"), 1) }, ["h", "slope"]));
    mountain.peaks.push({ at: holdPoint(design, [11, 37]), height: 9, radius: 8, noise: 0, scale: 1 });
    const shore = rect(28, 19, 51, 38).outlines[0].curve;
    for (const node of shore.nodes) node.id = "shore-" + node.id;
    shore.nodes[0].bulge = .35;
    const coast = defaultFunction(design, "coast", { shore, center: [42, 34] });
    const slope = openCurve([{ p: [20, -22], h: 0 }, { p: [31, -16], h: 3 }, { p: [45, -14], h: 7 }]);
    design.geoNodes = [
        addLayer(design, "G", rect(-57, -45, 57, 45), { type: "ground", value: 4 }),
        addLayer(design, "A", region, { type: "flat", amount: 1 }),
        addLayer(design, "M", rect(-48, 18, 19, 42), mountain),
        addLayer(design, "C", rect(23, 12, 54, 42), coast),
        addLayer(design, "S", rect(14, -29, 49, 3), { type: "slope", kind: "path", lines: [{ curve: slope }], center: [0, 0], radius: 5, value: 2, rate: -.2 })
    ];
    design.sections = [fixtureSection(design, { id: "Q", label: "剖面线 Q", points: [[-44, -32], [9, -32]], showLabel: false })];
    return design;
}

export async function checkSegmentEditing(url: string) {
    await withCurveMap(url, "segment-editing", async page => {
        const { authored, boundary, cdp, click, curve, disk, drag, evaluate, frame, key, nodeTitles, paint, pixels, pointer,
            saved, screenshot, tap, text, translated, undo, wait } = page;
        const menu = ".context-menu", row = "[data-curve-segment]", prop = "#property-content";
        const segmentTitle = () => text(row + " .subitem-label");
        const deleteButton = row + " [aria-label=删除线段]", removeItem = menu + " [data-option=delete-segment]";
        const highlights = () => evaluate(width => window.curveMapProbe.strokes.filter(s => s.width > width), overlay.selectedWidth);
        async function selectedStroke(dashed: boolean, theme: Theme = "light") {
            const strokes = (await highlights()).filter(s => s.alpha === 1);
            assert.equal(strokes.length, 1);
            const [stroke] = strokes;
            assert.deepEqual([stroke.width, stroke.color, stroke.alpha, stroke.dash], [4, mapColors[theme].accent, 1, dashed ? [...overlay.dash] : []]);
            return stroke;
        }
        const menuGroups = () => evaluate(() => [...document.querySelectorAll(".context-menu .menu-column")].map(column =>
            [...column.querySelectorAll(".menu-group")].map(group => [
                group.querySelector(".group-name")!.textContent,
                ...[...group.querySelectorAll("button")].map(button => button.textContent!.trim())
            ])));
        const active = () => evaluate(() => {
            const option = document.activeElement as HTMLElement;
            return [option.dataset.option, [...document.querySelectorAll(".context-menu .menu-column")].indexOf(option.closest(".menu-column")!)];
        });
        const original = await authored(), outline = boundary(original, "A"), line = await curve();
        const edge = segmentPoint(outline, 0), inside: Point = [-41, 8], firstRidge = segmentPoint(line, 0), middleRidge = segmentPoint(line, 1);
        await click("[data-tab=layers]");
        await click("input[data-layer=geoNodes]");
        await click("input[data-layer=issues]");
        await paint();

        console.log("Contour and parameter segment clicks, hover, styling and navigation");
        await pointer("mouseMoved", pixels(await frame(), edge), 0, "none");
        await paint();
        assert.deepEqual(await highlights(), []);
        await tap(edge);
        assert.equal((await frame()).selection?.id, "A");
        assert.equal((await frame()).vertex, undefined);
        assert.equal(await segmentTitle(), "");
        await pointer("mouseMoved", pixels(await frame(), inside), 0, "none");
        await pointer("mouseMoved", pixels(await frame(), edge), 0, "none");
        await paint();
        const hoveredOutline = await highlights(), [hover] = hoveredOutline;
        assert.equal(hoveredOutline.length, 1);
        assert(Math.abs(hover.alpha - .3) < 1e-6);
        assert.deepEqual([hover.width, hover.color, hover.dash], [4, mapColors.light.accent, []]);
        await tap(edge);
        assert.equal((await frame()).vertex?.role, "segment");
        assert.equal(await segmentTitle(), "线段 1");
        assert.deepEqual(await nodeTitles(), []);
        assert.equal(await text(prop + " h3"), "区域");
        assert.equal(await text(row + " .param-name"), "线段类型");
        const selected = await selectedStroke(false), f = await frame();
        assert(selected.points.every((p, i) => distance(p, pixels(f, outline.nodes[i].p, true)) < .01));
        await screenshot("segment-light");
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
        await wait(() => document.documentElement.dataset.theme === "dark");
        await paint();
        await selectedStroke(false, "dark");
        await screenshot("segment-dark");
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await wait(() => document.documentElement.dataset.theme === "light");

        await click("[aria-label=上一个线段]"); await paint();
        assert.equal(await segmentTitle(), "线段 4");
        await click("[aria-label=下一个线段]"); await paint();
        assert.equal(await segmentTitle(), "线段 1");
        await tap(outline.nodes[0].p);
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        assert.equal(await segmentTitle(), "");
        await tap(inside);
        assert.equal((await frame()).selection?.id, "A");
        assert.equal((await frame()).vertex, undefined);
        await click("[data-geo-node=A]");
        await drag(edge);
        const moved = await authored(), dx = 30 / f.scale;
        translated(outline.nodes.map(n => n.p), boundary(moved, "A").nodes.map(n => n.p), dx);
        const hole = geometryPath(page.owner(original, "A"), 1)!, movedHole = geometryPath(page.owner(moved, "A"), 1)!;
        translated(hole.nodes.map(n => n.p), movedHole.nodes.map(n => n.p), dx);
        assert.deepEqual(await curve(), line);
        assert.equal((await frame()).vertex, undefined);
        await undo();

        await pointer("mouseMoved", pixels(await frame(), firstRidge), 0, "none"); await paint();
        const hoveredRidge = await highlights(), [ridgeHover] = hoveredRidge;
        assert.equal(hoveredRidge.length, 1);
        assert(Math.abs(ridgeHover.alpha - .3) < 1e-6);
        assert(ridgeHover.points.length > 2);
        assert.deepEqual([ridgeHover.width, ridgeHover.color, ridgeHover.dash], [4, mapColors.light.accent, [...overlay.dash]]);
        assert((await evaluate(() => window.curveMapProbe.strokes)).some(s => s.width === overlay.parameterWidth && s.dash.length));
        await tap(firstRidge);
        assert.equal((await frame()).selection?.id, "M");
        assert.equal(await segmentTitle(), "");
        await selectedStroke(true);
        assert.match(await text(".geometry-box[aria-pressed=true]"), /^曲线 \d+$/);
        await tap(firstRidge);
        assert.equal(await segmentTitle(), "线段 1");
        await selectedStroke(true);
        await screenshot("ridge-segment-light");
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
        await wait(() => document.documentElement.dataset.theme === "dark");
        await paint();
        await selectedStroke(true, "dark");
        await screenshot("ridge-segment-dark");
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        await wait(() => document.documentElement.dataset.theme === "light");
        assert.equal(await evaluate(() => document.querySelector("[data-curve-segment]")?.parentElement?.closest(".subitem")
            ?.querySelector(".subitem-toggle")?.textContent?.trim()), "山脊 1");
        assert(await evaluate(() => document.querySelector("[data-property-tab=function]")?.getAttribute("aria-pressed") === "true"));
        assert(await evaluate(() => {
            const row = document.querySelector("[data-curve-segment]")!.getBoundingClientRect(), pane = document.querySelector("#property-content")!.getBoundingClientRect();
            return row.top >= pane.top && row.bottom <= pane.bottom;
        }));
        assert(await evaluate(() => document.querySelector<HTMLButtonElement>("[aria-label=上一个线段]")?.disabled));
        await tap(inside);
        await drag(firstRidge);
        translated(line.nodes.map(n => n.p), (await curve()).nodes.map(n => n.p), dx);
        assert.deepEqual(page.owner(await authored(), "M").construction, page.owner(original, "M").construction);
        assert.equal((await frame()).vertex, undefined);
        await undo();

        console.log("Map menu ownership, compact layout and keyboard navigation");
        await tap(edge, 0, "right");
        const regionGroups = [
            ["轮廓 1", "删除轮廓"], ["区域", "添加轮廓"], ["地件", "复制地件", "禁用地件", "删除地件"]
        ];
        const outlineGroups = [
            [["线段类型", "直线", "曲线", "圆弧"], ["线段", "插入节点", "删除线段"], ["闭合曲线", "全部节点改为自动平滑", "全部线段改为直线"]],
            regionGroups
        ];
        assert.deepEqual(await menuGroups(), outlineGroups);
        assert.equal((await frame()).vertex?.role, "segment");
        assert(await evaluate(() => {
            const menu = document.querySelector(".context-menu")!, box = menu.getBoundingClientRect();
            const [left, right] = [...menu.querySelectorAll(".menu-column")].map(column => column.getBoundingClientRect());
            return menu.getAttribute("role") === "menu" && left.right + 1 === right.left && left.top === right.top &&
                left.width !== right.width && left.height !== right.height &&
                box.left >= 16 && box.right <= innerWidth - 16 && box.top >= 16 && box.bottom <= innerHeight - 16;
        }));
        await screenshot("context-menu-columns");
        assert(await evaluate(() => document.activeElement?.matches(".context-menu")));
        await key("ArrowDown");
        assert.deepEqual(await active(), ["line", 0]);
        await key("ArrowDown");
        assert.deepEqual(await active(), ["curve", 0]);
        const nearest = await evaluate(() => {
            const a = document.activeElement!.getBoundingClientRect(), y = a.top + a.height / 2;
            const menus = document.querySelectorAll(".context-menu .menu-column");
            return [...menus[1].querySelectorAll<HTMLButtonElement>("button:enabled")].map(button => {
                const box = button.getBoundingClientRect();
                return { id: button.dataset.option, gap: Math.abs(box.top + box.height / 2 - y) };
            }).sort((a, b) => a.gap - b.gap)[0].id;
        });
        await key("ArrowRight");
        assert.deepEqual(await active(), [nearest, 1]);
        await key("End"); await key("ArrowDown");
        assert.deepEqual(await active(), ["delete-outline", 1]);
        await key("ArrowLeft");
        assert.deepEqual(await active(), ["line", 0]);
        await key("Escape");

        await evaluate(() => document.querySelector<HTMLCanvasElement>("#map")!.focus());
        await key("s");
        assert(await evaluate(() => {
            const canvas = document.activeElement!;
            const { outlineStyle, boxShadow } = getComputedStyle(canvas);
            return canvas.id === "map" && outlineStyle === "none" && boxShadow === "none";
        }));
        await tap(outline.nodes[0].p, 0, "right");
        assert.deepEqual((await menuGroups()).map(column => column.map(group => group[0])), [["节点类型", "节点", "闭合曲线"],
            ["轮廓 1", "区域", "地件"]]);
        assert.equal((await frame()).vertex?.role, "vertex");
        assert(await evaluate(() => document.activeElement?.matches(".context-menu") && !document.querySelector(".context-menu button:focus-visible")));
        const { outlineStyle, boxShadow, popupShadow } = await evaluate(selector => {
            const sample = document.body.appendChild(document.createElement("div"));
            sample.style.boxShadow = "var(--shadow-pop)";
            const popupShadow = getComputedStyle(sample).boxShadow;
            sample.remove();
            const { outlineStyle, boxShadow } = getComputedStyle(document.querySelector(selector)!);
            return { outlineStyle, boxShadow, popupShadow };
        }, menu);
        assert.equal(outlineStyle, "none");
        assert.equal(boxShadow, popupShadow);
        await screenshot("round40-menu-container-focus");
        await key("ArrowDown");
        assert.deepEqual(await active(), ["corner", 0]);
        assert(await evaluate(() => {
            const item = document.activeElement!;
            return item.matches(".context-menu button:focus-visible") && getComputedStyle(item).boxShadow.includes("inset");
        }));
        await key("Escape");
        await tap(inside, 0, "right");
        assert.deepEqual(await menuGroups(), [regionGroups]);
        assert.equal((await frame()).vertex, undefined);
        await key("Escape");
        await click("[data-tab=terrain]");
        await click("[data-geo-node=M]");
        await click("[data-property-tab=function]");
        const peak = prop + " .subitem:has(> .subitem-heading [aria-label=删除山峰])";
        await click(peak + " .subitem-toggle[aria-expanded=false]");
        assert.equal((await frame()).vertex, undefined);
        assert.deepEqual(await evaluate(selector =>
            [...document.querySelectorAll(selector + " .param-name")].map(el => el.textContent),
        peak), ["位置", "高度", "半径", "半径起伏", "噪声尺度"]);
        const height = () => evaluate(async () => (await window.terrainFieldHashes!()).fields.height);
        const originalHeight = await height();
        await click(peak + " .numeric-face[aria-label=高度]");
        await wait(() => document.activeElement?.matches(".numeric-edit[aria-label=高度]"));
        await evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
        await cdp("Input.insertText", { text: "30" }); await key("Enter"); await saved(); await paint();
        const changedMountain = page.owner(await authored(), "M").function;
        assert(changedMountain.type === "mountain");
        assert.deepEqual([changedMountain.peaks[0].at, changedMountain.peaks[0].height], [[11, 37], 30]);
        assert.equal((await frame()).vertex, undefined);
        const changedHeight = await height();
        assert.notEqual(changedHeight.values, originalHeight.values);
        assert.equal(changedHeight.defined, originalHeight.defined);
        await undo();
        assert.deepEqual(await height(), originalHeight);

        await tap([11, 37], 0, "right");
        assert.deepEqual((await menuGroups())[0][0], ["山峰 1", "复制山峰", "删除山峰"]);
        await key("Escape");
        await tap([-17, -32], 0, "right");
        assert.deepEqual(await menuGroups(), [[["剖面线", "复制剖面线", "删除剖面线"]]]);
        await key("Escape");
        await click("[data-tab=terrain]");
        const list = await evaluate(() => {
            const button = document.querySelector("[data-geo-node=A]")!.getBoundingClientRect();
            return [button.x + button.width / 2, button.y + button.height / 2] as Point;
        });
        await pointer("mousePressed", list, 0, "right");
        await pointer("mouseReleased", list, 0, "right");
        await wait(() => document.querySelector(".context-menu:popover-open"));
        assert.deepEqual(await menuGroups(), [[["地件", "在视野中显示", "复制地件", "禁用地件", "删除地件"]]]);
        await key("ArrowUp");
        assert.deepEqual(await active(), ["delete", 0]);
        await key("Escape");

        await cdp("Emulation.setDeviceMetricsOverride", { width: 284, height: 425, deviceScaleFactor: 1, mobile: false });
        await wait(() => innerWidth === 284 && window.curveMapProbe.editor!.map.width <= 284);
        await click("#fit");
        await evaluate(() => window.scrollTo(0, 0));
        await paint();
        const edgeOnScreen = await evaluate(point => {
            const map = window.curveMapProbe.editor!.map, box = map.canvas.getBoundingClientRect(), [x, y] = map.screen(point);
            return [box.left + x, box.top + y] as Point;
        }, edge);
        await wait(([x, y]) => document.elementFromPoint(x, y)?.id === "map", edgeOnScreen);
        await pointer("mousePressed", edgeOnScreen, 0, "right");
        await pointer("mouseReleased", edgeOnScreen, 0, "right");
        await wait(() => document.querySelector(".context-menu:popover-open"));
        assert.deepEqual(await menuGroups(), outlineGroups);
        assert(await evaluate(() => {
            const menu = document.querySelector(".context-menu")!, box = menu.getBoundingClientRect();
            const [top, bottom] = [...menu.querySelectorAll(".menu-column")].map(column => column.getBoundingClientRect());
            const divider = menu.querySelector(".menu-separator")!.getBoundingClientRect();
            return top.bottom < bottom.top && top.left === bottom.left && divider.height === 1 && menu.scrollHeight > menu.clientHeight &&
                box.top >= 16 && box.bottom <= innerHeight - 16 && box.left >= 16 && box.right <= innerWidth - 16;
        }));
        await key("ArrowRight"); assert.equal((await active())[1], 1);
        await key("End");
        assert(await evaluate(() => document.querySelector(".context-menu")!.scrollTop > 0));
        await key("Escape");
        await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
        await wait(() => innerWidth === 1440 && window.curveMapProbe.editor!.map.width > 1000);
        await click("#fit"); await paint();

        console.log("Segment deletion through the menu, inspector and keyboard");
        await tap(edge, 0, "right");
        await click(removeItem); await saved(); await paint();
        let merged = boundary(await authored(), "A");
        assert.deepEqual(merged.nodes[0].p, edge);
        assert.equal(merged.nodes[0].id, outline.nodes[0].id);
        assert.equal(merged.nodes[0].mode, "corner");
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        await undo();
        assert.equal(await segmentTitle(), "线段 1");
        await click("#redo"); await saved(); await paint();
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        await undo();
        await click(deleteButton); await saved();
        merged = boundary(await authored(), "A");
        assert.equal(merged.nodes.length, 3);
        await undo();
        await tap(edge); await key("Delete"); await saved();
        assert.equal(boundary(await authored(), "A").nodes.length, 3);
        await undo();

        await tap(middleRidge, 0, "right");
        assert.deepEqual((await menuGroups()).map(column => column.map(group => group[0])), [["线段类型", "线段", "曲线"], ["山脊 1", "地件"]]);
        assert.deepEqual((await menuGroups())[1][0], ["山脊 1", "复制山脊", "删除山脊"]);
        assert.equal(await text(removeItem), "");
        await key("Escape");
        await tap(middleRidge);
        assert.equal(await text(deleteButton), "");
        const unchanged = await disk();
        await key("Delete"); await paint();
        assert.equal(await disk(), unchanged);
        assert.equal(await segmentTitle(), "线段 2");

        await tap(firstRidge, 0, "right");
        await click(removeItem); await saved(); await paint();
        assert.deepEqual((await curve()).nodes.map(n => n.id), line.nodes.slice(1).map(n => n.id));
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        await undo();
        await tap(segmentPoint(line, 3));
        assert(await evaluate(() => document.querySelector<HTMLButtonElement>("[aria-label=下一个线段]")?.disabled));
        await click(deleteButton); await saved(); await paint();
        assert.deepEqual((await curve()).nodes.map(n => n.id), line.nodes.slice(0, -1).map(n => n.id));
        assert.deepEqual(await nodeTitles(), ["节点 4"]);
        await undo();

        await tap(pathHandle(line, 1, "out"), 0, "right");
        assert.equal((await menuGroups())[0][0][0], "节点类型");
        assert.deepEqual(await nodeTitles(), ["节点 2"]);
        await key("Escape");
        for (const method of ["double click", "menu"]) {
            if (method === "menu") {
                await tap(middleRidge, 0, "right");
                await click(menu + " [data-option=insert-node]");
            }
            else {
                await tap(middleRidge);
                await tap(middleRidge, 0, "left", 2);
            }
            await saved(); await paint();
            const inserted = await curve();
            assert.equal(inserted.nodes.length, line.nodes.length + 1);
            assert.deepEqual(inserted.nodes.slice(1, 4).map(n => n.mode), ["auto", "auto", "auto"]);
            assert.deepEqual(inserted.nodes.filter((_, i) => i !== 2), line.nodes);
            assert(distance(inserted.nodes[2].p, middleRidge) < .25);
            assert.deepEqual(await nodeTitles(), ["节点 3"]);
            await undo();
            assert.equal(await segmentTitle(), "线段 2");
        }

        const shore = geometryPath(page.owner(original, "C"), -1)!;
        await tap(segmentPoint(shore, 0, .3));
        assert.equal((await frame()).selection?.id, "C");
        assert.equal(await segmentTitle(), "");
        assert.match(await text(".geometry-box[aria-pressed=true]"), /^曲线 \d+$/);
        await tap(segmentPoint(shore, 0, .3));
        assert.equal(await segmentTitle(), "线段 1");
        assert.equal(segmentType(shore, 0), "arc");
        assert((await selectedStroke(true)).points.length > 2);
        const arc = arcHandle(shore.nodes[0].p, shore.nodes[1].p, shore.nodes[0].bulge!);
        await tap(arc, 0, "right");
        const groups = await menuGroups();
        assert.deepEqual(groups[0][0], ["线段类型", "直线", "曲线", "圆弧"]);
        assert.deepEqual(groups[0][1], ["线段", "插入节点", "相切", "删除线段"]);
        assert.deepEqual(groups[1].map(group => group[0]), ["地件"]);
        await key("Escape");

        const angleFace = row + " .numeric-face[aria-label=圆心角]", tangent = row + " button[aria-label=相切]";
        const readShore = () => authored().then(d => geometryPath(page.owner(d, "C"), -1)!);
        const readAngle = async () => Number(await text(angleFace));
        const enterAngle = async (value: string) => {
            await click(angleFace);
            await wait(() => document.activeElement?.matches(".numeric-edit[aria-label=圆心角]"));
            await evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
            await cdp("Input.insertText", { text: value });
            await key("Enter");
        };
        const initialStroke = (await selectedStroke(true)).points;
        await enterAngle("120"); await saved(); await paint();
        let current = await readShore();
        assert(Math.abs(degreesFromBulge(current.nodes[0].bulge!) - 120) < 1e-10);
        assert.equal(await readAngle(), 120);
        assert.notDeepEqual((await selectedStroke(true)).points, initialStroke);
        const expectedMidpoint = pixels(await frame(), segmentPoint(current, 0), true);
        assert((await selectedStroke(true)).points.some(p => distance(p, expectedMidpoint) < 1));

        await enterAngle("0");
        assert.match(await text(row + " [role=alert]"), /非零/);
        assert.deepEqual(await readShore(), current);
        await key("Escape");

        const [ax, ay] = pixels(await frame(), segmentPoint(current, 0));
        await pointer("mousePressed", [ax, ay], 0);
        await pointer("mouseMoved", [ax, ay - 20], 0);
        await pointer("mouseReleased", [ax, ay - 20], 0);
        await saved(); await paint();
        current = await readShore();
        const draggedAngle = await readAngle();
        assert.notEqual(draggedAngle, 120);
        assert(Math.abs(draggedAngle - degreesFromBulge(current.nodes[0].bulge!)) < .0001);

        assert(await evaluate(selector => {
            const button = document.querySelector<HTMLButtonElement>(selector);
            const angleRow = button?.closest(".parameter-row");
            return !button?.disabled && angleRow?.querySelector(".param-name")?.textContent === "圆心角" &&
                angleRow.querySelector(".unit")?.textContent === "°";
        }, tangent));
        await click(tangent); await saved(); await paint();
        current = await readShore();
        assert(Math.abs(current.nodes[0].bulge! - 1) < 1e-10);
        assert.equal(await readAngle(), 180);
        const slope = geometryPath(page.owner(original, "S"), -1)!;
        await tap(slope.nodes[0].p);
        assert.equal((await frame()).selection?.id, "S");
        assert.equal(await segmentTitle(), "");
        assert.deepEqual(await nodeTitles(), []);
        assert.match(await text(".geometry-box[aria-pressed=true]"), /^曲线 \d+$/);
        await tap(slope.nodes[0].p);
        assert.deepEqual(await nodeTitles(), ["节点 1"]);
        await tap(segmentPoint(slope, 0));
        assert.equal(await segmentTitle(), "线段 1");
        await click(row + " button[aria-label=圆弧]"); await saved(); await paint();
        assert(await evaluate(selector => document.querySelector<HTMLButtonElement>(selector)?.disabled, tangent));
    }, scene());
}