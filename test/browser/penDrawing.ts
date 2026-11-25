import assert from "node:assert/strict";
import { type Point } from "../../src/core/design/v5.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export async function checkPenDrawing(url: string) {
    await withCurveMap(url, "pen-node-modes", async ({ authored, boundary, click, evaluate, frame, key, open, paint, penMode, saved, screenshot, tap, tool }) => {
        const ctrl = 2;
        const triangles: [Point, Point, Point][] = [[[-43, -33], [-33, -33], [-38, -24]], [[6, -34], [17, -34], [11, -24]]];
        for (const [i, points] of triangles.entries()) {
            await tool("地件", "pen"); assert.equal(await penMode(), "尖角");
            if (i) {
                await evaluate(() => document.querySelector<HTMLInputElement>("#terrain-search")!.focus());
                await key("s"); assert.equal(await penMode(), "尖角");
                await evaluate(() => document.querySelector<HTMLElement>("#map")!.focus());
                await key("s"); assert.equal(await penMode(), "自动平滑");
                await screenshot("pen-modes");
            }
            for (const point of [...points, points[0]]) await tap(point, ctrl);
            await saved(); await paint();
            const id = (await frame()).selection!.id, nodes = boundary(await authored(), id).nodes;
            assert.equal(nodes.length, 3);
            assert(nodes.every(n => n.mode === (i ? "auto" : "corner") && !("in" in n || "out" in n)));
        }
        await open();
        await tool("地件", "pen"); assert.equal(await penMode(), "自动平滑"); await key("Escape");
        await click("[data-geo-node=M]"); await click("[data-property-tab=function]");
        await click("[aria-label=添加山脊]"); assert.equal(await penMode(), "自动平滑"); await key("Escape");
    });
}