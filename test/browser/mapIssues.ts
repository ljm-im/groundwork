import assert from "node:assert/strict";
import { type Point } from "../../src/core/design/v5.ts";
import { parseDesign } from "../../src/core/design/model.ts";
import { Project } from "../../src/core/project.ts";
import { layer, rect } from "../scenarios.ts";
import { withLayeredMap } from "./layeredMapFixture.ts";

export async function checkMapIssues(url: string) {
    await withLayeredMap(url, "map-issues", async ({ at, cdp, click, d, evaluate, fit, frame, menuFor, openDesign, paint, panel, point, property, tap, text }) => {
        const design = { ...d, sections: [], marks: [], geoNodes: [
            layer("G", rect(-60, -38, 60, 38), { type: "ground", value: 3 }),
            layer("A", rect(-32, -13, -12, 12), { type: "flat", amount: 4 }),
            layer("B", rect(18, -16, 40, 14), { type: "flat", amount: 0 }),
            ...["X", "Y"].map(id => layer(id, { type: "strip", of: ["missing", "B"], widths: [3, 3] }, { type: "split" }))
        ] };
        const { issues } = new Project(parseDesign(design, true));
        const warning = issues.find(i => i.severity === "warning")!, errors = issues.filter(i => i.severity === "error");
        assert.equal(errors.length, 2);
        assert.deepEqual(errors[0].point, errors[1].point);
        await openDesign("off-center-issues.json", design);
        await panel("layers"); await click("input[data-layer=issues]");
        const camera = async () => {
            const { center, scale } = await frame();
            return { center, scale };
        };
        const rows = () => evaluate(() => [...document.querySelectorAll<HTMLElement>("#panel [data-issue][aria-pressed=true]")]
            .map(el => Number(el.dataset.issue)).sort((a, b) => a - b));
        async function panToEdge(p: Point, offset: number) {
            const [x] = await at(p), left = await evaluate(() => document.querySelector("#map")!.getBoundingClientRect().left);
            const dx = left - offset - x, [sx, sy] = await point("#map", dx < 0 ? .9 : .1);
            for (const [type, shift, buttons] of [["mousePressed", 0, 4], ["mouseMoved", dx, 4], ["mouseReleased", dx, 0]] as const)
                await cdp("Input.dispatchMouseEvent", { type, x: sx + shift, y: sy, button: "middle", buttons, clickCount: 1 });
            await paint();
        }
        async function unchanged(action: () => Promise<void>, center?: Point) {
            const before = await camera();
            await action(); await paint();
            assert.deepEqual(await camera(), { ...before, ...(center && { center }) });
        }
        for (const issue of [warning, errors[0]]) {
            await fit(); await click("#plus"); await paint();
            const index = issues.indexOf(issue), group = issue.severity === "error" ? errors : [issue];
            assert.notDeepEqual((await camera()).center, issue.point);
            await unchanged(async () => {
                await tap(await at(issue.point), 0, "right");
                assert.equal(await text(".context-menu"), "");
            });
            const mapHit = () => at(issue.point).then(tap);
            await unchanged(mapHit);
            assert.deepEqual(await rows(), group.map(i => issues.indexOf(i)));
            const listRow = "#panel [data-issue='" + index + "']";
            await unchanged(() => click(listRow));
            assert.deepEqual(await rows(), [index]);
            await property("issues");
            const propertyRow = "#properties [data-issue='" + index + "']";
            await unchanged(() => click(propertyRow));

            await panToEdge(issue.point, 5);
            const [edgeX, edgeY] = await at(issue.point), edge = await evaluate(() => document.querySelector("#map")!.getBoundingClientRect().left);
            assert(Math.abs(edgeX - edge + 5) < .5);
            await unchanged(() => tap([edge + 2, edgeY]));
            assert.deepEqual(await rows(), group.map(i => issues.indexOf(i)));
            async function reveal(selector: string) {
                await menuFor(selector);
                assert.equal(await text(".context-menu .group-name"), issue.severity === "error" ? "错误" : "警告");
                assert.equal(await text(".context-menu button"), "在视野中显示");
                await click(".context-menu [data-option=show-in-view]");
            }
            await unchanged(() => reveal(listRow), issue.point);
            await panToEdge(issue.point, 24);
            await property("issues");
            await unchanged(() => reveal(propertyRow), issue.point);
        }
    });
}