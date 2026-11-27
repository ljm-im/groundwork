import assert from "node:assert/strict";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { mapColors, overlay } from "../../src/render/palette.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { addLayer, fixtureCurve, fixtureMark, literalCurve, openCurve, rect, syntheticDesign, withNodeSlope } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkSelectionHierarchy(url: string) {
    const design: Design = syntheticDesign(), landform = design.geoNodes[1];
    assert(landform.construction.type === "outline");
    const secondOutline = rect(1, -32, 11, -20).outlines[0];
    landform.construction.outlines.push(fixtureCurve(design, secondOutline));
    const ridge = openCurve([{ p: [-25, 16], h: 8 }, { p: [-17, 22], h: 9 }, { p: [-9, 16], h: 8 }], "corner", "ridge-");
    design.geoNodes.push(
        addLayer(design, "M", rect(-33, 6, -4, 34), { type: "mountain", ridges: [{ curve: withNodeSlope(ridge, 2) }], valleys: [], peaks: [] }),
        addLayer(design, "B", rect(10, 7, 28, 28), { type: "flat", amount: 2 })
    );
    design.marks.push(fixtureMark(design, { id: "P", label: "标记 A", kind: "text", point: [32, -12], follow: "map" }));
    const curveId = (d: Design, id: string) => {
        const { construction } = d.geoNodes.find(n => n.id === id)!;
        assert(construction.type === "outline" && "curve" in construction.outlines[0]);
        return construction.outlines[0].curve;
    };
    return withCurveMap(url, "round43", async page => {
        const { authored, click, drag, evaluate, frame, key, paint, pointer, pixels, saved, screenshot, tap, text, undo } = page;
        const p: Point = [-14, -8], away: Point = [0, 54], row = "[data-outline] > .subitem-heading";
        const curveInput = "#properties .geometry-box[aria-label=曲线]", tab = "[data-property-tab=geometry]";
        const parts = "[data-curve-node], [data-curve-segment]";
        const move = async (point: Point) => {
            await pointer("mouseMoved", pixels(await frame(), point), 0, "none");
            await paint();
        };
        const active = (selector: string) => evaluate(s => document.querySelector(s)?.getAttribute("aria-pressed"), selector);
        const title = () => evaluate(() => document.querySelector<HTMLInputElement>(".property-title input")?.value);
        const fills = () => evaluate(() => window.curveMapProbe.geometryFills);
        const strokes = () => evaluate(() => window.curveMapProbe.strokes);
        const hoverStroke = async (width: number) => {
            const lines = (await strokes()).filter(s => s.alpha === overlay.segmentHoverOpacity);
            assert.deepEqual(lines.map(s => [s.color, s.width, s.dash]), [[mapColors.light.accent, width, []]]);
        };
        const depth = async () => (await frame()).selectionPath?.length ?? 0;
        const outlineId = curveId(design, "T"), outline = literalCurve(design, outlineId), vertex = outline.nodes[0].p;
        const otherVertex = secondOutline.curve.nodes[0].p;
        const dotsAt = async (point: Point) => {
            const at = pixels(await frame(), point, true);
            return (await evaluate(() => window.curveMapProbe.dots)).filter(dot => distance(dot.point, at) < .02).map(dot => dot.color);
        };
        const resetLandform = async () => {
            await click("[data-geo-node=T]"); await paint();
            assert.equal(await depth(), 1);
        };
        const accentStroke = async () => {
            const start = pixels(await frame(), vertex, true);
            return (await strokes()).find(s => s.color === mapColors.light.accent && s.width === 4 &&
                s.points.some(point => distance(point, start) < .02));
        };
        await click("[data-tab=layers]");
        await click("input[data-layer=issues]");
        await move(p);
        await tap(p);
        assert.equal(await title(), "T");
        assert.equal(await depth(), 1);
        assert.equal((await frame()).hoverPath, undefined);
        await move(away);
        const landformFills = await fills();
        assert.deepEqual(await dotsAt(vertex), [mapColors.light.bgPanel]);
        assert.deepEqual(await dotsAt(otherVertex), [mapColors.light.bgPanel]);
        await screenshot("round43-fix2-landform");
        await move(vertex);
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "vertex");
        assert.deepEqual(await dotsAt(vertex), [mapColors.light.bgPanel, mapColors.light.accent]);

        const dx = 30 / (await frame()).scale, [x, y] = vertex, moved: Point = [x + dx, y];
        const landformPath = (await frame()).selectionPath;
        const propertyTab = () => evaluate(() => document.querySelector("[data-property-tab][aria-pressed=true]")?.getAttribute("data-property-tab"));
        const landformTab = await propertyTab();
        const assertLandformSelected = async () => {
            assert.deepEqual((await frame()).selectionPath, landformPath);
            assert.equal(await title(), "T");
            assert.equal(await propertyTab(), landformTab);
            assert.equal(await text(parts), "");
        };
        await drag(vertex, 2, async () => {
            await assertLandformSelected();
            assert.deepEqual(await dotsAt(moved), [mapColors.light.accent]);
            await screenshot("round43-fix5-dragging-node");
        });
        await assertLandformSelected();
        const { nodes } = literalCurve(await authored(), outlineId);
        assert(distance(nodes[0].p, moved) < .02);
        assert.deepEqual(nodes.slice(1), outline.nodes.slice(1));
        await move(away);
        assert.deepEqual(await dotsAt(moved), [mapColors.light.bgPanel]);
        await screenshot("round43-fix5-landform-after-drag");
        await undo();
        await assertLandformSelected();

        await tap(vertex);
        assert.equal(await depth(), 4);
        await tap(vertex, 0, "left", 2);
        await saved(); await paint();
        assert.equal(literalCurve(await authored(), outlineId).nodes[0].mode, "auto");
        await undo();
        await resetLandform();

        await tap([-14, -14], 0, "left", 2);
        await saved(); await paint();
        assert.equal(literalCurve(await authored(), outlineId).nodes.length, outline.nodes.length + 1);
        assert.equal(await depth(), 4);
        await undo();
        await resetLandform();

        await tap(p);
        assert.equal(await depth(), 2);
        assert.equal(await text(row), "轮廓 1");
        assert(await evaluate(s => !!document.querySelector(s)?.parentElement?.classList.contains("selected"), row));
        assert.equal(await active(curveInput), "false");
        assert.equal(await text(parts), "");
        assert.deepEqual((await accentStroke())?.dash, []);
        assert.equal((await frame()).hoverPath, undefined);
        assert.deepEqual(await fills(), landformFills);
        await move([-13, -8]);
        assert.equal((await frame()).hoverPath, undefined);
        assert.deepEqual(await fills(), landformFills);
        await move(away);
        assert.deepEqual(await fills(), landformFills);
        assert.deepEqual(await dotsAt(vertex), [mapColors.light.bgPanel]);
        assert.deepEqual(await dotsAt(otherVertex), []);
        await screenshot("round43-outline");
        await move(p);
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "geometry");
        assert.deepEqual(await fills(), []);
        await hoverStroke(4);
        await screenshot("round43-fix4-hovered-outline-curve");
        await tap(p);
        assert.equal(await depth(), 3);
        assert.equal(await active(tab), "true");
        assert.equal(await title(), design.geometry[curveId(design, "T")].label);
        assert.deepEqual((await accentStroke())?.dash, []);
        assert.deepEqual(await fills(), [.1]);
        assert.deepEqual(await dotsAt(vertex), [mapColors.light.bgPanel]);
        await tap(p);
        assert.equal(await depth(), 3);
        await move(away);
        await screenshot("round43-closed-curve");

        await tap(vertex);
        assert.equal(await text("[data-curve-node] .subitem-label"), "节点 1");
        await move(away);
        assert.deepEqual(await fills(), [.1]);
        const start = pixels(await frame(), vertex, true);
        const curveStrokes = (await strokes()).filter(s => distance(s.points[0], start) < .02);
        assert.deepEqual(curveStrokes.map(s => [s.width, s.color, s.alpha, s.dash]), [[2, mapColors.light.accent, 1, []]]);
        await screenshot("round43-fix5-selected-node");
        await move(p);
        assert.deepEqual(await fills(), [.1]);
        await move(outline.nodes[1].p);
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "vertex");
        await tap(outline.nodes[1].p);
        assert.equal(await text("[data-curve-node] .subitem-label"), "节点 2");
        await tap(p);
        assert.equal(await depth(), 3);

        await click("[data-property-tab=function]"); await paint();
        assert.equal(await depth(), 1);
        assert.equal(await title(), "T");
        assert.equal(await active("[data-property-tab=function]"), "true");
        assert.equal(await accentStroke(), undefined);
        await tap(p); await tap(p);
        assert.equal(await depth(), 3);

        await click("[data-property-tab=region]"); await paint();
        assert.equal(await depth(), 2);
        assert.equal(await active(curveInput), "false");
        assert(await evaluate(s => !!document.querySelector(s)?.parentElement?.classList.contains("selected"), row));
        await move(p);
        assert.deepEqual(await fills(), []);
        await hoverStroke(4);
        await click(curveInput);
        const pick = ".property-title button[aria-label=选取或重画轮廓]";
        await click(pick); await paint();
        assert.deepEqual(await fills(), []);
        await move([18, 16]);
        assert.deepEqual(await fills(), []);
        await hoverStroke(4);
        assert((await strokes()).some(s => s.color === mapColors.light.parameterGeometry && s.width === 2 && !s.dash.length));
        await move([21, 19]);
        assert.deepEqual(await fills(), []);
        await hoverStroke(4);
        await tap([21, 19]);
        await saved(); await paint();
        const d = await authored();
        assert.equal(curveId(d, "T"), curveId(d, "B"));
        assert.equal(await title(), d.geometry[curveId(d, "B")].label);
        assert.equal(await depth(), 3);
        await key("Delete");
        assert.match(await text("#remove-dialog"), /仍在使用/);
        await click("#remove-dialog button[value=cancel]");

        const ridgeNode = ridge.nodes[0].p;
        await tap(ridgeNode);
        assert.equal(await depth(), 1);
        assert.deepEqual(await dotsAt(ridgeNode), []);
        await tap(ridgeNode);
        assert.equal(await depth(), 2);
        assert.equal(await active("#properties .geometry-box[aria-label=山脊线]"), "false");
        assert.equal(await text(parts), "");
        await move(away);
        assert.deepEqual(await dotsAt(ridgeNode), [mapColors.light.bgPanel]);
        await screenshot("round43-fix2-ridge");
        await tap(ridgeNode);
        assert.equal(await depth(), 4);
        assert.equal(await text("[data-curve-node] .part-title"), "山脊 1");
        assert.equal(await text("[data-curve-node] .subitem-label"), "节点 1");
        const height = () => evaluate(point => {
            const { terrain } = window.curveMapProbe.editor!.project;
            return terrain.fields.height.values[terrain.grid.index(...point)];
        }, ridgeNode);
        const before = await height();
        await click("[data-curve-node] .parameter-row:has(.numeric-face[aria-label=高度]) button.step[aria-label^=增大]");
        await saved(); await paint();
        assert(await height() > before);
        await evaluate(() => document.querySelector<HTMLCanvasElement>("#map")!.focus());
        for (const after of [3, 2, 1, 0]) {
            await key("Escape"); await paint();
            assert.equal(await depth(), after);
        }

        const mark: Point = [32, -12];
        await tap(mark); await tap(mark);
        assert.equal((await frame()).selectionPath?.[1]?.kind, "geometry");
        const at = pixels(await frame(), mark, true);
        const handles = (await evaluate(() => window.curveMapProbe.arcStrokes))
            .filter(arc => arc.color === mapColors.light.accent && distance(arc.point, at) < .02);
        assert.deepEqual(handles.map(arc => [arc.radius, arc.width, arc.alpha]), [[overlay.handleRadius, overlay.handleOutline, 1]]);
    }, design);
}

export function checkHoverStyles(url: string) {
    const design = syntheticDesign("ground");
    const point: Point = [-31, 29], peak: Point = [-28, -12];
    const points: Point[] = [[-27, 14], [-18, 20], [-9, 14]];
    const open = openCurve(points.map(p => ({ p })), "corner", "open-");
    const ridge = openCurve(points.map(([x, y]) => ({ p: [x + 1, y - 19], h: 8 })), "corner", "ridge-");
    const closed = rect(12, 15, 25, 27).outlines[0].curve;
    const outline = rect(10, -19, 23, -7).outlines[0].curve;
    design.geometry.freePoint = { label: "独立点", point, independent: true };
    design.geometry.freeOpen = { label: "独立开放曲线", curve: open, independent: true };
    design.geometry.freeClosed = { label: "独立闭合曲线", curve: closed, independent: true };
    design.geoNodes.push(
        addLayer(design, "M", rect(-37, -23, -3, 5), {
            type: "mountain", ridges: [{ curve: withNodeSlope(ridge, 2) }], valleys: [],
            peaks: [{ at: peak, height: 11, radius: 8, noise: 0, scale: 1 }]
        }),
        addLayer(design, "T", rect(10, -19, 23, -7), { type: "flat", amount: 2 })
    );
    const { construction } = design.geoNodes.find(n => n.id === "T")!;
    assert(construction.type === "outline" && "curve" in construction.outlines[0]);
    const outlineId = construction.outlines[0].curve;
    return withCurveMap(url, "round43-hover-styles", async ({ click, evaluate, frame, key, paint, pixels, pointer, screenshot, tap }) => {
        const { accent, bgPanel } = mapColors.light, alpha = overlay.segmentHoverOpacity;
        const move = async (p: Point) => {
            await pointer("mouseMoved", pixels(await frame(), p), 0, "none");
            await paint();
        };
        const moveTo = async (selector: string) => {
            const target = await evaluate(selector => {
                const element = document.querySelector(selector)!;
                element.scrollIntoView({ block: "nearest" });
                const { x, y, width, height } = element.getBoundingClientRect();
                return [x + width / 2, y + height / 2] as Point;
            }, selector);
            await pointer("mouseMoved", target, 0, "none");
            await paint();
        };
        const capture = async (name: string, p: Point, width: number, height: number) => {
            const [x, y] = pixels(await frame(), p);
            await screenshot("round43-fix5-" + name, { x: Math.round(x - width / 2), y: Math.round(y - height / 2), width, height });
        };
        const verifyPoint = async (p: Point) => {
            const at = pixels(await frame(), p, true);
            const { dots, arcs } = await evaluate(() => ({ dots: window.curveMapProbe.dots, arcs: window.curveMapProbe.arcStrokes }));
            assert.deepEqual(dots.filter(dot => distance(dot.point, at) < .02).map(dot => dot.color), [bgPanel, accent]);
            assert.deepEqual(arcs.filter(arc => distance(arc.point, at) < .02)
                .map(arc => [arc.color, arc.radius, arc.width, arc.alpha, arc.dash]), [[accent, overlay.handleRadius, overlay.handleOutline, 1, []]]);
        };
        const verifyCurve = async (start: Point, width: number) => {
            const at = pixels(await frame(), start, true);
            const { geometryFills, strokes } = await evaluate(() => {
                const { geometryFills, strokes } = window.curveMapProbe;
                return { geometryFills, strokes };
            });
            const traces = strokes.filter(stroke => distance(stroke.points[0], at) < .02);
            assert.deepEqual(traces.map(trace => [trace.color, trace.width, trace.alpha, trace.dash]), [[accent, width, alpha, []]]);
            assert.deepEqual(geometryFills, []);
        };
        const landform = async (id: string, tab: string) => {
            await click("[data-tab=terrain]");
            await click("[data-geo-node=" + id + "]");
            await click("[data-property-tab=" + tab + "]");
            await paint();
        };
        const fill: Point = [18.5, 21], inside: Point = [16.5, -13];
        const pointRow = ".subitem:has([aria-label=删除山峰])", ridgeRow = ".subitem:has([aria-label=删除山脊])";
        const outlineRow = "#properties [data-outline]";
        const referenceOption = (id: string) => ".reference-menu [data-option=" + JSON.stringify("curve:" + id) + "]";

        await click("[data-tab=layers]");
        await click("input[data-layer=geometry]");
        await click("input[data-layer=geoNodes]");
        await click("input[data-layer=issues]");
        await click("input[data-layer=contours]");
        await click("input[data-layer=grid]");
        await move(point);
        assert.deepEqual((await frame()).hoverPath, [{ kind: "geometry", id: "freePoint" }]);
        await verifyPoint(point);
        await capture("point-independent", point, 106, 90);
        await move([-22.5, 17]);
        await verifyCurve(open.nodes[0].p, 2);
        await capture("open-independent", [-18, 17], 236, 115);
        await move(fill);
        await verifyCurve(closed.nodes[0].p, 4);
        await capture("closed-independent", fill, 208, 168);

        await click("[data-tab=inputs]");
        await moveTo("[data-select-geometry=freeOpen]");
        assert.deepEqual((await frame()).hoverPath, [{ kind: "geometry", id: "freeOpen" }]);
        await verifyCurve(open.nodes[0].p, 2);
        await screenshot("round43-fix5-variable-hover");

        await landform("M", "function");
        await move(peak);
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "holder");
        await verifyPoint(peak);
        await capture("point-peak-holder", peak, 106, 90);
        await click(pointRow + " .subitem-toggle");
        await moveTo(pointRow + " .geometry-box");
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "geometry");
        await verifyPoint(peak);
        await click(ridgeRow + " .subitem-toggle");
        await moveTo(ridgeRow + " .geometry-box");
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "geometry");
        await verifyCurve(ridge.nodes[0].p, 2);
        await capture("open-ridge", [-17, -2], 236, 115);

        await landform("T", "region");
        await moveTo(outlineRow + " .geometry-box");
        assert.equal((await frame()).hoverPath?.at(-1)?.kind, "geometry");
        await verifyCurve(outline.nodes[0].p, 4);

        await click(outlineRow + " .geometry-reference");
        await moveTo(referenceOption("freeClosed"));
        await verifyCurve(closed.nodes[0].p, 4);
        await key("Escape");
        await click(outlineRow + " .geometry-redraw");
        await move(fill);
        await verifyCurve(closed.nodes[0].p, 4);
        await key("Escape");
        await tap([0, 54]);

        await landform("M", "region");
        await click(outlineRow + " .geometry-reference");
        await moveTo(referenceOption(outlineId));
        await verifyCurve(outline.nodes[0].p, 4);
        await capture("closed-outline", inside, 208, 168);
        await key("Escape");
    }, design);
}

export function checkMapHints(url: string) {
    return withCurveMap(url, "round43-map-hints", async ({ cdp, evaluate, moveOverMap, paint, pointer, screenshot, wait }) => {
        const bar = "#mode-hint", popup = "[data-mode-hint-details]";
        const primaries = ["逐层选中", "回到上一层", "切换重叠的对象"];
        const all = [...primaries, "打开菜单", "拖动平移", "缩放"];
        const texts = (selector: string) => evaluate(s => [...document.querySelectorAll(s + " .hint-text")].map(el => el.textContent), selector);
        const hoverBar = async () => {
            const at = await evaluate(s => {
                const box = document.querySelector(s + " .hint-entry")!.getBoundingClientRect();
                return [box.left + box.width / 2, box.top + box.height / 2] as Point;
            }, bar);
            await pointer("mouseMoved", at, 0, "none");
            await wait(s => document.querySelector(s + ":popover-open"), popup);
        };
        const clip = (selectors: string[]) => evaluate(selectors => {
            const boxes = selectors.map(s => document.querySelector(s)!.getBoundingClientRect());
            const x = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.left))) - 8);
            const y = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.top))) - 8);
            return { x, y, width: Math.ceil(Math.max(...boxes.map(b => b.right))) + 8 - x,
                height: Math.ceil(Math.max(...boxes.map(b => b.bottom))) + 8 - y };
        }, selectors);

        await wait(s => document.querySelectorAll(s + " > .hint-entry").length === 3, bar);
        assert.deepEqual(await texts(bar), primaries);
        const accessibility = await evaluate(({ bar, popup }) => {
            const hint = document.querySelector<HTMLElement>(bar)!, details = document.querySelector(popup)!;
            return { description: hint.getAttribute("aria-describedby") === details.id, label: hint.getAttribute("aria-label"),
                focusable: hint.tabIndex >= 0 || !!hint.querySelector("button, [tabindex]") };
        }, { bar, popup });
        assert.deepEqual(accessibility, { description: true, label: "更多操作", focusable: false });
        assert(!await evaluate(s => document.querySelector(s)?.matches(":popover-open"), popup));
        await moveOverMap();
        await evaluate(() => window.curveMapProbe.editor!.toast = null);
        await screenshot("round43-fix3-hints-wide");
        await hoverBar();
        assert.deepEqual(await texts(popup), all);
        const symbols = await evaluate(s => {
            const panel = document.querySelector(s)!;
            return {
                keys: [...panel.querySelectorAll("kbd")].map(el => [el.textContent, el.getBoundingClientRect().height]),
                mice: [...panel.querySelectorAll(".hint-mouse")].map(el => {
                    const svg = el.querySelector("svg")!;
                    return [el.querySelector(".mouse-name")?.textContent, svg.getAttribute("viewBox"), getComputedStyle(svg).width];
                })
            };
        }, popup);
        assert.deepEqual(symbols.keys, [["Esc", 18], ["Alt", 18], ["Space", 18]]);
        assert.deepEqual([...new Map(symbols.mice.map(([name, ...appearance]) => [name, appearance]))], [
            ["左键", ["0 0 18 18", "14px"]], ["右键", ["0 0 18 18", "14px"]],
            ["中键", ["0 0 18 18", "14px"]], ["滚轮", ["0 0 18 18", "14px"]]
        ]);
        const popupBox = await clip([bar, popup]);
        await screenshot("round43-fix3-hints-details", popupBox);
        await pointer("mouseMoved", [popupBox.x + 15, popupBox.y + 15], 0, "none");
        assert(await evaluate(s => document.querySelector(s)?.matches(":popover-open"), popup));
        await moveOverMap();
        await wait(s => !document.querySelector(s)?.matches(":popover-open"), popup);

        for (const width of [960, 375]) {
            await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
            await moveOverMap(); await paint();
            const visible = await texts(bar);
            assert(visible.length > 0 && visible.length < primaries.length);
            assert.deepEqual(visible, primaries.slice(0, visible.length));
            const layout = await evaluate(s => {
                const chip = document.querySelector<HTMLElement>(s)!, box = chip.getBoundingClientRect();
                const position = document.querySelector("#position")!.getBoundingClientRect();
                const zoom = document.querySelector(".zoom-tools")!.getBoundingClientRect();
                const surface = document.querySelector(".map-wrap")!.getBoundingClientRect();
                const area = chip.parentElement!.getBoundingClientRect();
                const style = getComputedStyle(chip);
                const first = chip.querySelector(".hint-entry")!.getBoundingClientRect().width +
                    [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce((sum, v) => sum + parseFloat(v), 0);
                return { whole: chip.scrollWidth <= chip.clientWidth && style.textOverflow === "clip",
                    sameRow: box.bottom === zoom.bottom && box.right <= position.left, mapWidth: surface.width,
                    above: box.bottom < position.top && box.right === zoom.right,
                    room: area.width, first };
            }, bar);
            assert(layout.whole && layout.mapWidth < 680);
            if (width === 375) {
                assert(layout.above && layout.room < layout.first);
                await screenshot("round43-fix3-hints-narrow");
            }
            else {
                assert(layout.sameRow && layout.room >= layout.first);
                await screenshot("round43-fix3-hints-compact");
            }
            await hoverBar();
            assert.deepEqual(await texts(popup), all);
            await moveOverMap();
        }
    });
}