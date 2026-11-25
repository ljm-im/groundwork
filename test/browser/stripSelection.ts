import assert from "node:assert/strict";
import { type Point } from "../../src/core/design/v5.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { Project } from "../../src/core/project.ts";
import { withLayeredMap } from "./layeredMapFixture.ts";

export async function checkStripSelection(url: string) {
    await withLayeredMap(url, "strip-selection", async ({ at, authored, click, evaluate, key, paint, saved, screenshot, tap, text, undo }) => {
        const status = ".drawing-status";
        async function stripTool() {
            await click("button[aria-label=新建地件]");
            await click(".creation-menu [data-option=strip]");
        }
        async function selectedPixels(p: Point) {
            const screen = await at(p);
            return evaluate(([x, y]) => {
                const canvas = document.querySelector<HTMLCanvasElement>("#map")!, box = canvas.getBoundingClientRect();
                const i = Math.floor((x - box.left) * canvas.width / box.width);
                const j = Math.floor((y - box.top) * canvas.height / box.height);
                const { data } = canvas.getContext("2d")!.getImageData(i - 1, j - 1, 3, 3);
                for (let k = 0; k < data.length; k += 4) if (data[k] === 34 && data[k + 1] === 102 && data[k + 2] === 89) return true;
                return false;
            }, screen);
        }
        async function assertStrip(ids: string[], common = false) {
            const doc = await authored();
            const node = doc.geoNodes.find(n => n.construction.type === "strip")!;
            assert(node.construction.type === "strip");
            assert.deepEqual(node.construction.of, ids);
            assert.equal(node.construction.range, undefined);
            const spine = new Project(doc).terrain.regions.get(node.id)?.shape.spine ?? [];
            assert(spine.length > 0);
            if (common) {
                assert(spine.every(({ a, b }) => [a, b].every(([x, y]) => x >= -36 && x <= 18 && y >= -18 && y <= 16)));
                assert(spine.some(({ a, b }) => a[1] === -12 && b[1] === -12));
            }
            else if (ids.length === 1) {
                assert.equal(spine.length, 4);
                assert.equal(spine.reduce((sum, edge) => sum + distance(edge.a, edge.b), 0), 176);
            }
        }
        console.log("whole strips, selection colors and Alt cycling");
        await stripTool();
        assert.equal(await text(status + " span"), "单击要沿的地件");
        assert.equal(await text("#mode-hint"), "单击要沿的地件，按住 Alt 单击可选被遮住的地件，Esc 取消");
        await tap(await at([-27, 7]));
        assert.equal(await text(status + " span"), "沿“台地 A”，回车确认");
        assert.equal(await text("#mode-hint"), "单击另一个地件改沿公共边，单击起止节点只取一段，或回车取整圈，Esc 取消");
        await key("Enter"); await saved(); await assertStrip(["A"]); await undo();
        await stripTool();
        await tap(await at([-27, 7]));
        await tap(await at([0, 6]));
        assert.equal(await text(status + " span"), "沿“台地 A”、“台地 B”，回车确认");
        assert.equal(await text("#mode-hint"), "单击起止节点只取一段，或回车取整条公共边，Esc 取消");
        await paint();
        assert(await selectedPixels([-36, 1]));
        assert(await selectedPixels([32, 1]));
        await screenshot("strip-two-sources");
        await key("Enter"); await saved(); await assertStrip(["B", "A"], true); await undo();
        await stripTool();
        await tap(await at([0, 6]));
        await tap(await at([0, 6]), 1);
        assert.equal(await text(status + " span"), "沿“台地 B”、“台地 A”，回车确认");
        await key("Enter"); await saved(); await assertStrip(["B", "A"], true); await undo();
        await stripTool();
        await tap(await at([-27, 7]));
        await tap(await at([0, 6]), 1);
        assert.equal(await text(status + " span"), "沿“台地 A”、“G”，回车确认");
        await key("Escape");
    });
}