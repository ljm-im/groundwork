import assert from "node:assert/strict";
import { distance } from "../../src/core/math/geometry.ts";
import { mapColors, overlay } from "../../src/render/palette.ts";
import { type Point } from "../../src/core/design/v5.ts";
import { coveredLandformPoints, overlappingLandforms } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export async function checkLayeredHits(url: string) {
    await withCurveMap(url, "layered-hits", async ({ click, evaluate, frame, key, paint, pixels, pointer, tap }) => {
        await click("[data-tab=layers]");
        await click("input[data-layer=geoNodes]");
        await click("input[data-layer=issues]");
        const blank: Point = [0, 53];
        const hoverColor = await evaluate(color => {
            const ctx = document.createElement("canvas").getContext("2d")!;
            ctx.strokeStyle = color;
            return String(ctx.strokeStyle);
        }, mapColors.light.accentHover);
        for (const point of coveredLandformPoints) {
            await tap(blank);
            await pointer("mouseMoved", pixels(await frame(), point), 0, "none"); await paint();
            const hover = await frame();
            assert.equal(hover.hovered?.id, "B");
            assert.equal(hover.hoverPart, undefined);
            const strokes = await evaluate(() => window.curveMapProbe.pathStrokes);
            assert.equal(strokes.filter(s => s.color === hoverColor && Math.abs(s.width - overlay.hoverWidth) < .001).length, 1);

            await tap(point);
            assert.equal((await frame()).selection?.id, "B");
            assert.equal((await frame()).outline, undefined);
            await tap(point, 1);
            assert.equal((await frame()).selection?.id, "A");

            await tap(blank);
            await tap(point, 0, "right");
            assert.equal((await frame()).selection?.id, "B");
            assert.deepEqual(await evaluate(() => [...document.querySelectorAll(".context-menu .group-name")].map(n => n.textContent)),
                ["轮廓 1", "区域", "地件"]);
            await key("Escape");
        }

        // The current selection keeps its editable controls even under another landform.
        await tap(blank);
        await tap(coveredLandformPoints[2]);
        await tap(coveredLandformPoints[2], 1);
        await tap(coveredLandformPoints[2]);
        const selected = await frame();
        assert.equal(selected.selection?.id, "A");
        assert.equal(selected.vertex?.role, "vertex");
    }, overlappingLandforms());
}

export async function checkSpacePan(url: string) {
    await withCurveMap(url, "space-pan", async ({ cdp, click, disk, evaluate, frame, key, paint, pixels, pointer, saved, tap, text, tool }) => {
        const space = (type: "keyDown" | "keyUp") => cdp("Input.dispatchKeyEvent", {
            type, key: " ", code: "Space", windowsVirtualKeyCode: 32, ...(type === "keyDown" && { text: " " })
        });
        const camera = () => evaluate(() => {
            const { center, scale } = window.curveMapProbe.editor!.map;
            return { center, scale };
        });
        const cursor = () => evaluate(() => getComputedStyle(document.querySelector("#map")!).cursor);
        const draftNodes = () => evaluate(() => window.curveMapProbe.editor!.geoDraft?.nodes.length);
        const at = async (point: Point) => pixels(await frame(), point);
        const move = async (point: Point) => pointer("mouseMoved", await at(point), 0, "none");
        async function pan(point: Point, dx: number, dy: number) {
            const before = await camera(), [x, y] = await at(point), to: Point = [x + dx, y + dy];
            await pointer("mousePressed", [x, y]);
            await pointer("mouseMoved", to);
            assert.equal(await cursor(), "grabbing");
            await pointer("mouseReleased", to); await paint();
            const after = await camera();
            assert.equal(after.scale, before.scale);
            assert(distance(after.center, [before.center[0] - dx / before.scale, before.center[1] + dy / before.scale]) < .02);
            assert.equal(await cursor(), "grab");
        }

        const face = coveredLandformPoints[0], other: Point = [32, 12];
        await tap(face);
        assert.equal((await frame()).selection?.id, "B");
        assert.equal(await text("#mode-hint"), "单击选择，Alt 单击选择下层，中键或按住空格拖动平移，滚轮缩放");
        await move(other);
        await evaluate(() => {
            const button = document.querySelector<HTMLButtonElement>("#fit")!;
            button.focus();
            button.addEventListener("click", () => button.dataset.spaceClick = "true", { once: true });
        });
        await space("keyDown");
        assert.equal(await cursor(), "grab");
        await space("keyUp");
        assert.equal(await cursor(), "default");
        assert.equal(await evaluate(() => document.querySelector<HTMLElement>("#fit")!.dataset.spaceClick), undefined);

        await space("keyDown");
        const before = await camera(), original = await disk();
        await tap(other);
        assert.deepEqual(await camera(), before);
        assert.equal((await frame()).selection?.id, "B");
        await pan(other, 45, -21);
        assert.equal((await frame()).selection?.id, "B");
        await space("keyUp");
        assert.equal(await cursor(), "default");
        assert.equal(await disk(), original);

        const name = ".property-title input";
        await click(name);
        await evaluate(selector => {
            const input = document.querySelector<HTMLInputElement>(selector)!;
            input.setSelectionRange(input.value.length, input.value.length);
        }, name);
        await move(face);
        const beforeTyping = await camera();
        await space("keyDown");
        assert.equal(await cursor(), "default");
        await space("keyUp");
        assert.equal(await evaluate(selector => document.querySelector<HTMLInputElement>(selector)!.value, name), "B ");
        assert.deepEqual(await camera(), beforeTyping);

        await tool("地件", "pen");
        const first: Point = [-33, 18], second: Point = [-24, 28], third: Point = [-14, 18];
        await tap(first); await tap(second);
        assert.equal(await draftNodes(), 2);
        await space("keyDown");
        await tap(third, 0, "left", 2);
        assert.equal(await draftNodes(), 2);
        await pan(third, -25, 32);
        assert.equal(await draftNodes(), 2);
        const [x, y] = await at(third);
        await pointer("mousePressed", [x, y]);
        const beforeRelease = await camera();
        await space("keyUp");
        assert.equal(await cursor(), "crosshair");
        await pointer("mouseMoved", [x + 35, y]);
        await pointer("mouseReleased", [x + 35, y]);
        assert.deepEqual(await camera(), beforeRelease);
        assert.equal(await draftNodes(), 2);
        await tap(third, 0, "left", 2);
        assert.equal(await draftNodes(), 3);
        await key("Enter"); await saved(); await paint();
        assert.equal(await draftNodes(), undefined);
        assert.notEqual(await disk(), original);
    }, overlappingLandforms());
}