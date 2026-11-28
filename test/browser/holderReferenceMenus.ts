import assert from "node:assert/strict";
import { addLayer, fixtureCurve, openCurve, rect, syntheticDesign, withNodeSlope } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkHolderMenus(url: string) {
    const d = syntheticDesign(), construction = d.geoNodes[1].construction;
    assert(construction.type === "outline");
    for (const x of [2, 15]) construction.outlines.push(fixtureCurve(d, rect(x, -14, x + 7, -2).outlines[0]));
    d.geoNodes.push(addLayer(d, "M", rect(-32, 12, 32, 34), {
        type: "mountain", peaks: [], valleys: [],
        ridges: [-24, -8, 8].map(x => ({ curve: withNodeSlope(openCurve([{ p: [x, 18], h: 8 }, { p: [x + 9, 24], h: 14 }]), .5) }))
    }));
    return withCurveMap(url, "round44-holder-menus", async page => {
        const { click, key, evaluate, paint, saved, authored, screenshot } = page;
        async function checkWidth(row: string, label: string, labels: string[], screenshotName: string) {
            assert.deepEqual(await evaluate(({ row, label }) => {
                const heading = document.querySelector(row)!;
                const menu = document.querySelector<HTMLElement>(".reference-menu[aria-label=\"" + label + "\"]")!;
                const box = heading.getBoundingClientRect(), rect = menu.getBoundingClientRect();
                const items = [...menu.querySelectorAll<HTMLElement>("[role=option]")];
                return {
                    aligned: Math.abs(box.left - rect.left) <= 1 && Math.abs(box.width - rect.width) <= 1 &&
                        (Math.abs(box.bottom + 2 - rect.top) <= 1 || Math.abs(box.top - 2 - rect.bottom) <= 1),
                    scrolling: menu.scrollWidth > menu.clientWidth,
                    labels: items.map(option => option.innerText.trim()),
                    singleLine: items.every(option => {
                        const name = option.querySelector("span.option-name")!;
                        const range = document.createRange();
                        range.selectNodeContents(name);
                        return Boolean(name.getBoundingClientRect().width) && range.getClientRects().length === 1 &&
                            Math.abs(option.clientHeight - parseFloat(getComputedStyle(option).minHeight)) <= 1;
                    })
                };
            }, { row, label }), { aligned: true, scrolling: false, labels, singleLine: true });
            await screenshot(screenshotName);
        }

        const outlineRow = "#properties [data-outline] > .subitem-heading", outline = outlineRow + " [aria-label=引用轮廓]";
        const caption = outlineRow + " .subitem-toggle";
        await click("[data-geo-node=T]");
        await click("[data-property-tab=region]");
        await click(outline);
        await checkWidth(outlineRow, "引用轮廓", ["G.轮廓 1", "T.轮廓 2", "T.轮廓 3", "M.轮廓 1"], "round44-outline-reference");
        await click(outline);
        assert.equal(await evaluate(sel => document.querySelector(sel)?.getAttribute("aria-expanded"), outline), "false");
        await click(outline);
        const wasOpen = await evaluate(sel => document.querySelector(sel)?.getAttribute("aria-expanded"), caption);
        await click(caption);
        assert.equal(await evaluate(sel => document.querySelector(sel)?.getAttribute("aria-expanded"), outline), "false");
        assert.notEqual(await evaluate(sel => document.querySelector(sel)?.getAttribute("aria-expanded"), caption), wasOpen);

        await evaluate(sel => document.querySelector<HTMLElement>(sel)?.focus(), outline);
        await key("Enter"); await paint();
        const focusText = () => evaluate(() => document.activeElement?.textContent?.trim());
        assert.equal(await focusText(), "G.轮廓 1");
        await key("ArrowDown");
        assert.equal(await focusText(), "T.轮廓 2");
        await key("ArrowUp");
        assert.equal(await focusText(), "G.轮廓 1");
        await key("ArrowDown");
        await key("ArrowDown");
        assert.equal(await focusText(), "T.轮廓 3");
        await key("Enter"); await saved();
        const next = (await authored()).geoNodes[1].construction;
        assert(next.type === "outline");
        assert.deepEqual(next.outlines[0], { ref: "{geo:T.construction.outlines.2}" });
        assert(await evaluate(sel => document.activeElement === document.querySelector(sel), outline));
        await key("Enter"); await paint();
        await key("Escape");
        assert(await evaluate(sel => document.activeElement === document.querySelector(sel), outline));
        assert.equal(await evaluate(sel => document.querySelector(sel)?.getAttribute("aria-expanded"), outline), "false");

        await click("[data-geo-node=M]");
        await click("[data-property-tab=function]");
        const ridgeRow = "#properties .subitem-heading:has([aria-label=引用山脊])";
        await click(ridgeRow + " [aria-label=引用山脊]");
        await checkWidth(ridgeRow, "引用山脊", ["M.山脊 2", "M.山脊 3"], "round44-ridge-reference");
    }, d);
}