import assert from "node:assert/strict";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { mapColors } from "../../src/render/palette.ts";
import { layer, openCurve, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

type Page = Parameters<Parameters<typeof withCurveMap>[2]>[0];
const ctrl = 2, shift = 8;

async function mapScreenshot(page: Page, name: string) {
    const clip = await page.evaluate(() => {
        const { x, y, width, height } = document.querySelector("#map")!.getBoundingClientRect();
        return { x: x + scrollX, y: y + scrollY, width, height };
    });
    await page.screenshot(name, clip);
}

export function checkSegmentDragAndGuides(url: string) {
    const d: Design = syntheticDesign();
    d.geoNodes.push(layer("A", rect(-29, 17, -14.4, 28), { type: "flat", amount: 1 }),
        layer("B", rect(10, -20, 32, -7), { type: "flat", amount: 1 }));
    return withCurveMap(url, "round39-segment-drag", async page => {
        const { authored, boundary, cdp, click, evaluate, frame, paint, pixels, pointer, saved, tap, undo, wait } = page;
        await click("[data-tab=layers]");
        await click("input[data-layer=geoNodes]");
        await click("input[data-layer=issues]");
        await click("[data-tab=terrain]");
        await click("[data-geo-node=T]");
        const points = async () => boundary(await authored(), "T").nodes.map(node => node.p);
        const before = await points(), f = await frame(), middle: Point = [-14, -14];
        const from = pixels(f, middle), to: Point = [from[0] + 44, from[1] - 26];
        const assertPositions = (actual: Point[], dx: number, dy: number, segment: boolean) => {
            for (const [i, p] of before.entries()) {
                const expected: Point = segment && i >= 2 ? p : [p[0] + dx / f.scale, p[1] + dy / f.scale];
                assert(distance(actual[i], expected) < 1e-7, JSON.stringify({ i, actual: actual[i], expected }));
            }
        };
        await pointer("mousePressed", from, ctrl | shift);
        await pointer("mouseMoved", to, ctrl | shift);
        await pointer("mouseReleased", to, ctrl | shift);
        await saved();
        assertPositions(await points(), 44, 26, false);
        await undo();
        assert.deepEqual(await points(), before);

        await click("[data-geo-node=T]");
        await tap(middle, ctrl);
        assert.equal((await frame()).vertex?.role, "segment");
        await pointer("mousePressed", from, ctrl);
        await pointer("mouseMoved", to, ctrl);
        await paint();
        const preview = () => evaluate(() => {
            const region = window.curveMapProbe.editor?.dragNode?.construction;
            return region?.type === "outline" ? region.outlines[0].nodes.map(node => node.p) : [];
        });
        assertPositions(await preview(), 44, 26, true);
        const modifier = (key: "Shift" | "Control", pressed: boolean, modifiers: number) => cdp("Input.dispatchKeyEvent", {
            type: pressed ? "keyDown" : "keyUp", key, code: key + "Left", windowsVirtualKeyCode: key === "Shift" ? 16 : 17, modifiers
        });
        await modifier("Shift", true, ctrl | shift);
        assertPositions(await preview(), 44, 26, true);
        await modifier("Control", false, shift);
        assertPositions(await preview(), 35, 35, true);
        await modifier("Control", true, ctrl | shift);
        assertPositions(await preview(), 44, 26, true);
        await modifier("Control", false, shift);
        await pointer("mouseReleased", to, shift);
        await modifier("Shift", false, 0);
        await saved();
        await paint();
        assertPositions(await points(), 35, 35, true);
        assert.equal((await frame()).vertex?.role, "segment");
        await undo();
        assert.deepEqual(await points(), before);

        await tap(middle, ctrl);
        const nearGuides = pixels(await frame(), [middle[0] + 5, middle[1] + 11.6]);
        await pointer("mousePressed", from);
        await pointer("mouseMoved", nearGuides);
        await pointer("mouseReleased", nearGuides);
        await saved();
        assertPositions(await points(), 5 * f.scale, 12 * f.scale, true);
        await undo();

        await tap(before[0], ctrl);
        const view = await frame(), start = pixels(view, before[0]);
        const unrelated = pixels(view, [-28, -7.4]), related = pixels(view, [-31, -2.4]);
        const checkPoint = (actual: Point, expected: Point) => assert(distance(actual, expected) < .001, JSON.stringify({ actual, expected }));
        await pointer("mousePressed", start);
        await pointer("mouseMoved", unrelated);
        await paint();
        checkPoint((await preview())[0], [-28, -7.4]);
        assert.equal(await evaluate(() => window.curveMapProbe.editor?.snapGuides?.length), undefined);
        await pointer("mouseMoved", related);
        await wait(() => window.curveMapProbe.editor?.snapGuides?.length === 1);
        await paint();
        const visible = () => evaluate(accent => window.curveMapProbe.strokes.filter(stroke =>
            stroke.color === accent && stroke.width === 1 && stroke.dash.join(",") === "4,4"), mapColors.light.accent);
        assert.equal((await visible()).length, 1);
        checkPoint((await preview())[0], [-31, -2]);
        await mapScreenshot(page, "round40-related-alignment");
        await modifier("Shift", true, shift);
        await paint();
        checkPoint((await preview())[0], [-31.8, -3.2]);
        assert.equal((await visible()).length, 0);
        await modifier("Shift", false, 0);
        await pointer("mouseReleased", related);
        await saved();
        await paint();
        checkPoint((await points())[0], [-31, -2]);
        assert.equal((await visible()).length, 0);
    }, d);
}

export function checkDrawingConstraints(url: string) {
    return withCurveMap(url, "round39-shift-drawing", async page => {
        const { authored, boundary, frame, key, paint, pixels, pointer, saved, tap, text, tool, undo } = page;
        const latest = async () => {
            const d = await authored();
            return boundary(d, d.geoNodes.find(n => n.id.startsWith("geo-"))!.id).nodes;
        };
        const checkPoint = (actual: Point, expected: Point) => assert(distance(actual, expected) < 1e-7, JSON.stringify({ actual, expected }));

        await tool("地件", "rect");
        assert.match(await text("#mode-hint"), /按住 Shift 画正方形，按住 Ctrl 不吸附/);
        const f = await frame(), start = pixels(f, [9, 13]), end = pixels(f, [22, 20]);
        await pointer("mousePressed", start, shift);
        await pointer("mouseMoved", end, shift);
        await pointer("mouseReleased", end, shift);
        await saved();
        const box = await latest();
        checkPoint(box[2].p, [22, 26]);
        await undo();

        await tool("地件", "rect");
        await pointer("mousePressed", start, ctrl | shift);
        await pointer("mouseMoved", end, ctrl | shift);
        await pointer("mouseReleased", end, ctrl | shift);
        await saved();
        checkPoint((await latest())[2].p, [22, 20]);
        await undo();

        await tool("地件", "sector");
        await tap([10, 14], shift);
        await tap([19, 16], shift);
        await tap([15, 23], shift);
        await saved();
        const sector = await latest();
        checkPoint(sector[1].p, [19, 14]);
        checkPoint(sector[2].p, [10 + 9 / Math.sqrt(2), 14 + 9 / Math.sqrt(2)]);
        await undo();

        await tool("地件", "pen");
        assert.match(await text("#mode-hint"), /按住 Shift 约束方向，按住 Ctrl 不吸附/);
        await tap([4, 12], shift);
        const penView = await frame(), node = pixels(penView, [16, 21]), handle = pixels(penView, [21, 22]);
        await pointer("mousePressed", node, shift);
        await pointer("mouseMoved", handle, shift);
        await pointer("mouseReleased", handle, shift);
        await tap([27, 10], shift);
        await key("Enter");
        await saved();
        await paint();
        const pen = await latest();
        checkPoint(pen[0].p, [4, 12]);
        checkPoint(pen[1].p, [14.5, 22.5]);
        checkPoint(pen[1].out!, [6.5, 0]);
        checkPoint(pen[2].p, [27, 10]);

        await tool("标记", "section");
        await tap([-22, 20], shift);
        await tap([-13, 27], shift);
        await saved();
        const [section] = (await authored()).sections;
        checkPoint(section.points[0], [-22, 20]);
        checkPoint(section.points[1], [-14, 28]);

        const sectionView = await frame(), endpoint = pixels(sectionView, section.points[1]), moved = pixels(sectionView, [-6, 31]);
        for (const [modifiers, expected] of [[shift, [-6, 28]], [ctrl | shift, [-6, 31]]] as const) {
            await pointer("mousePressed", endpoint, modifiers);
            await pointer("mouseMoved", moved, modifiers);
            await pointer("mouseReleased", moved, modifiers);
            await saved();
            checkPoint((await authored()).sections[0].points[1], [...expected]);
            await undo();
        }
    }, syntheticDesign());
}

export function checkContourScales(url: string) {
    const d: Design = syntheticDesign();
    const area = rect(-40, -28, 40, 28);
    d.grid.step = .5;
    d.geoNodes = [layer("G", area, { type: "ground", value: 0 }),
        layer("S", structuredClone(area), { type: "slope", kind: "path",
            line: { curve: openCurve([{ p: [-40, 0], h: -66 }, { p: [40, 0], h: 94 }]) } })];
    return withCurveMap(url, "round39-contour-scales", async page => {
        const { cdp, click, evaluate, key, paint, text, wait } = page;
        await click("[data-tab=layers]");
        await click("input[data-layer=grid]");
        const zoom = "#zoom-value .numeric-face";
        for (const percent of [55, 500, 1600]) {
            await click(zoom);
            await wait(() => !!document.activeElement?.matches(".numeric-edit"));
            await evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
            await cdp("Input.insertText", { text: String(percent) });
            await key("Enter");
            await paint();
            assert.equal(await text(zoom), percent + "%");
            const labels = await evaluate(() => window.curveMapProbe.mapText.filter(value => /^[-−]?\d+(\.\d+)?$/.test(value)));
            assert(labels.length > 0, "No contour labels at " + percent + "%");
            await mapScreenshot(page, "round39-contours-" + percent);
        }
    }, d);
}