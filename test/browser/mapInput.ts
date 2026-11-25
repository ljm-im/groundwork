import assert from "node:assert/strict";
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