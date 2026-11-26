import assert from "node:assert/strict";
import { arcHandle } from "../../src/core/edit/paths.ts";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { fixtureMark, addLayer, openCurve, rect, syntheticDesign, fixtureCurve } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

type Page = Parameters<Parameters<typeof withCurveMap>[2]>[0];

async function resizeSplit(page: Page, split: string, dx: number, dy: number) {
    const point = await page.evaluate(split => {
        const el = document.querySelector("[data-split=" + split + "]")!;
        el.scrollIntoView({ block: "nearest" });
        const { x, y, width, height } = el.getBoundingClientRect();
        return [x + width / 2, y + height / 2] as Point;
    }, split);
    const target: Point = [point[0] + dx, point[1] + dy];
    await page.pointer("mousePressed", point);
    await page.pointer("mouseMoved", target);
    await page.pointer("mouseReleased", target);
    await page.paint();
}

function narrowDesign(): Design {
    const d = syntheticDesign(), n = d.geoNodes[1], region = n.construction;
    assert(region.type === "outline");
    for (let i = 0; i < 16; i++) {
        const x = -41 + i % 8 * 4, y = -42 + Math.floor(i / 8) * 5;
        const item = rect(x, y, x + 2, y + 2).outlines[0];
        item.curve.nodes.forEach(node => node.id = "extra-" + i + "-" + node.id);
        region.outlines.push(fixtureCurve(d, item));
    }
    const last = rect(18, 10, 32, 25).outlines[0];
    last.curve.nodes.forEach(node => node.id = "target-" + node.id);
    region.outlines.push(fixtureCurve(d, last));
    return d;
}

export function checkNarrowInspector(url: string) {
    return withCurveMap(url, "round39-narrow-inspector", async page => {
        const { cdp, click, evaluate, frame, paint, pixels, pointer, saved, tap, wait } = page;
        await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 800, deviceScaleFactor: 1, mobile: false });
        await paint();
        await click("#fit");
        await click("[data-geo-node=T]");
        await click("[data-property-tab=region]");
        const row = "[data-curve-node=target-0] .subitem-heading";
        async function showMap() {
            await evaluate(() => {
                document.querySelector("#property-content")!.scrollTop = 0;
                window.scrollTo(0, window.scrollY + document.querySelector("#map")!.getBoundingClientRect().top);
            });
            await paint();
            return evaluate(() => {
                const { top, bottom } = document.querySelector("#map")!.getBoundingClientRect();
                return { y: scrollY, fullMap: top >= -1 && bottom <= innerHeight };
            });
        }
        const offscreen = await showMap();
        assert(offscreen.fullMap);
        assert(await evaluate(() => document.querySelector("#property-content")!.getBoundingClientRect().top >= innerHeight));
        await tap([18, 10], 2);
        await wait(s => !!document.querySelector(s), row);
        assert.deepEqual(await evaluate(() => [scrollY, document.querySelector("#property-content")!.scrollTop]), [offscreen.y, 0]);

        await resizeSplit(page, "upper", 0, -210);
        await click("[data-property-tab=label]");
        await click("[data-property-tab=region]");
        const visible = await showMap();
        assert(visible.fullMap);
        assert(await evaluate(() => document.querySelector("#property-content")!.getBoundingClientRect().top < innerHeight));
        const initiallyVisible = () => evaluate(s => {
            const target = document.querySelector(s), pane = document.querySelector("#property-content")!;
            const { top, bottom } = pane.getBoundingClientRect(), box = target?.getBoundingClientRect();
            return !!box && pane.scrollTop > 0 && box.top >= top - 1 && box.bottom <= bottom + 1;
        }, row);
        await tap([18, 10], 2);
        assert(await initiallyVisible());
        assert.equal(await evaluate(() => scrollY), visible.y);
        const from = pixels(await frame(), [18, 10]), to: Point = [from[0] + 19, from[1] + 12];
        await pointer("mousePressed", from, 2);
        await pointer("mouseMoved", to, 2);
        await pointer("mouseReleased", to, 2);
        await saved();
        await paint();
        assert(await initiallyVisible());
        assert.equal(await evaluate(() => scrollY), visible.y);
        const region = page.owner(await page.authored(), "T").construction;
        assert(region.type === "outline");
        assert.notDeepEqual(region.outlines.at(-1)!.nodes[0].p, [18, 10]);
        await assertRow(page, ".zoom-tools", ".icon-button, #zoom-value .numeric-face", 4);
    }, narrowDesign());
}

async function assertRow(page: Page, selector: string, controls: string, count: number) {
    const result = await page.evaluate(({ selector, controls }) => {
        const row = document.querySelector(selector)!;
        row.scrollIntoView({ block: "nearest" });
        const buttons = [...row.querySelectorAll<HTMLButtonElement>(controls)], rects = buttons.map(button => button.getBoundingClientRect());
        return {
            count: buttons.length,
            separated: rects.every((a, i) => a.width > 0 && rects.slice(i + 1).every(b =>
                Math.min(a.right, b.right) - Math.max(a.left, b.left) < .25 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < .25)),
            clickable: buttons.every((button, i) => {
                const box = rects[i], hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                return !button.disabled && button.contains(hit);
            }),
            iconsFit: [...row.querySelectorAll(".geometry-box svg")].every(icon => {
                const iconBox = icon.getBoundingClientRect(), button = icon.closest("button")!.getBoundingClientRect();
                return iconBox.left >= button.left && iconBox.right <= button.right;
            })
        };
    }, { selector, controls });
    assert.deepEqual(result, { count, separated: true, clickable: true, iconsFit: true }, selector);
}

export function checkInspectorActions(url: string) {
    const d: Design = syntheticDesign(), n = d.geoNodes[1], region = n.construction;
    assert(region.type === "outline" && "curve" in region.outlines[0]);
    const boundary = rect(-26, -16, -5, 2).outlines[0].curve;
    d.geometry.boundary = { label: "共享的台地边界曲线", listed: true, curve: boundary };
    region.outlines[0] = { curve: "boundary" };
    const ridgePoints: Point[] = [[-23, -12], [-19, -8], [-12, -8], [-9, -4]];
    const curve = openCurve<never>(ridgePoints.map(p => ({ p })), "corner", "ridge-");
    curve.nodes[1].bulge = .5;
    d.geometry.ridge = { label: "一条需要截断长名称的共享山脊线", listed: true, curve };
    n.function = { type: "mountain", valleys: [], ridges: [{ curve: "ridge", h: { "ridge-0": 7, "ridge-3": 7 }, slope: { "ridge-0": 2, "ridge-3": 2 } }], peaks: [] };
    return withCurveMap(url, "round39-inspector-actions", async page => {
        const { click, evaluate, key, tap, wait } = page;
        await resizeSplit(page, "right", 300, 0);
        assert.equal(await evaluate(() => Math.round(document.querySelector(".inspector")!.getBoundingClientRect().width)), 270);
        await click("[data-geo-node=T]");
        await click("[data-property-tab=region]");
        const outlineRow = "[data-outline] .geometry-control";
        if (!await evaluate(s => !!document.querySelector(s), outlineRow)) await click("[data-outline] .subitem-toggle");
        await assertRow(page, outlineRow, ":scope > button", 3);
        await click(outlineRow + " .geometry-reference");
        await wait(() => !!document.querySelector("[aria-label=引用曲线][role=listbox]"));
        await key("Escape");

        await click("[data-property-tab=function]");
        const ridgeRow = ".geometry-control:has([aria-label=山脊线])";
        if (!await evaluate(s => !!document.querySelector(s), ridgeRow)) await click("#properties .part:has([aria-label=添加山脊]) .subitem-toggle");
        await assertRow(page, ridgeRow, ":scope > button", 3);
        await tap(ridgePoints[0]); await tap(ridgePoints[0]);
        await assertRow(page, "[data-parameter$=\".ridges.0.slope.ridge-0\"]", ".number-box button", 4);
        await tap(arcHandle(ridgePoints[1], ridgePoints[2], .5), 2);
        await wait(() => !!document.querySelector("[aria-label=相切]"));
        await assertRow(page, ".parameter-row:has([aria-label=圆心角])", ".number-box button, .parameter-action button", 4);
        await click("[aria-label=相切]");
        await page.saved();

        await click("[data-tab=inputs]");
        await click("[data-select-geometry=ridge]");
        assert(await evaluate(() => document.querySelector("input[aria-label=曲线名称]") && document.querySelector("[aria-label=重画曲线]")));
    }, d);
}

export function checkParameterSources(url: string) {
    const d: Design = syntheticDesign();
    d.geoNodes.push(addLayer(d, "F", rect(2, -12, 14, 5), { type: "flat", amount: "{field:height} * .5" }));
    d.marks.push(fixtureMark(d, { id: "M", kind: "text", label: "测点", point: [0, 0], elevation: 13, follow: "map" }),
        fixtureMark(d, { id: "R", kind: "scale", label: "地图比例尺", point: [22, 23], length: 10, follow: "map" }));
    return withCurveMap(url, "round39-parameter-sources", async page => {
        const { authored, cdp, click, evaluate, key, saved, undo, wait } = page;
        const option = (id: string) => "[aria-label=可用变量] button[data-option=" + JSON.stringify(id) + "]";
        const toggle = (name: string) => "[aria-label=" + JSON.stringify("为" + name + "插入变量") + "]";
        await click("[data-geo-node=T]");
        await click("[data-property-tab=function]");
        const amount = ".numeric-edit[aria-label=增量]", variableMenu = ".reference-menu[aria-label=可用变量]";
        await click(".numeric-face[aria-label=增量]");
        await wait(s => document.activeElement?.matches(s), amount);
        await evaluate(() => {
            const input = document.activeElement!, chip = input.querySelector(".ref-chip")!;
            const index = [...input.childNodes].indexOf(chip);
            document.getSelection()!.setBaseAndExtent(input, index, input, index + 1);
        });
        await click(toggle("增量"));
        await wait(s => document.activeElement?.matches(s), variableMenu);
        assert(await evaluate(s => !document.querySelector(s + " button:focus-visible"), variableMenu));
        await key("ArrowDown");
        assert(await evaluate(s => document.activeElement?.matches(s + ":focus-visible"), option("input:seed")));
        await key("Enter");
        await wait(s => document.activeElement?.matches(s), amount);
        await key("Enter"); await saved();
        const changed = (await authored()).geoNodes[1].function;
        assert(changed.type === "flat");
        assert.equal(changed.amount, "{input:seed} - 4");
        await undo();

        await click(".numeric-face[aria-label=增量]");
        await wait(s => document.activeElement?.matches(s), amount);
        await evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
        await cdp("Input.insertText", { text: "种" });
        await wait(s => !!document.querySelector(s + "[aria-selected=true]"), option("input:seed"));
        assert(await evaluate(s => document.activeElement?.matches(s), amount));
        await key("Escape");

        await click(toggle("羽化宽度"));
        await click(option("geo:F"));
        assert.equal(await evaluate(s => !!document.querySelector(s), option("geo:F.amount")), false);
        await key("Escape");
        await click(toggle("羽化宽度"));
        await click(option("geo:T"));
        await wait(s => !!document.querySelector(s), option("geo:T.amount"));
        await key("Escape");
        await click(toggle("增量"));
        await click(option("geo:F"));
        await wait(s => !!document.querySelector(s), option("geo:F.amount"));
        await key("Escape");

        await click(toggle("羽化宽度"));
        await click(option("mark:R"));
        await wait(s => !!document.querySelector(s), option("mark:R.length"));
        await key("Escape");
        await click(toggle("羽化宽度"));
        await click(option("mark:M"));
        await click(option("mark:M.elevation"));
        await key("Enter");
        await saved();
        const f = (await authored()).geoNodes[1].function;
        assert(f.type === "flat");
        assert.equal(f.feather, "{mark:M.elevation}");
    }, d);
}