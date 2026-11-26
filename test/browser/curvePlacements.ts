import assert from "node:assert/strict";
import { type Point } from "../../src/core/design/v5.ts";
import { mixPoint } from "../../src/core/math/geometry.ts";
import { baseMap } from "../../src/render/palette.ts";
import { layer, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkCurvePlacements(url: string) {
    const d = syntheticDesign();
    d.curves.S = { label: "S", curve: rect(-23, 16, -15, 23).outlines[0] };
    d.geoNodes.splice(1, 1,
        layer("A", rect(-35, -19, -27, -11), { type: "flat", amount: 1 }),
        layer("B", { type: "outline", outlines: [{ ref: "{geo:A.construction.outlines.0}", offset: [16, 0] }] }, { type: "flat", amount: 2 }),
        layer("C", { type: "outline", outlines: [{ ref: "{geo:B.construction.outlines.0}", offset: [16, 1] }] }, { type: "flat", amount: 3 }),
        { ...layer("D", { type: "outline", outlines: [{ ref: "{curve:S}", offset: [15, 5] }] }, { type: "flat", amount: 1 }), outline: true },
        { ...layer("E", { type: "outline", outlines: [{ ref: "{geo:D.construction.outlines.0}", offset: [15, -3] }] }, { type: "flat", amount: 2 }), outline: true }
    );

    return withCurveMap(url, "round37-curve-placements", async page => {
        const { click, evaluate, frame, paint, drag, pixels, translated, authored } = page;
        const positions = (ids: string[]) => evaluate(ids => {
            const { resolved } = window.curveMapProbe.editor!.project;
            return ids.map(id => {
                const c = resolved.geoNodes.find(node => node.id === id)?.construction;
                if (c?.type !== "outline") throw Error("Missing outline for " + id);
                return c.outlines[0].nodes.map(n => n.p);
            });
        }, ids);
        const eastEdge = (points: Point[]) => mixPoint(points[1], points[2], .5);
        async function checkPoints(points: Point[]) {
            const view = await frame();
            await evaluate(points => window.curveMapProbe.pathChecks = points, points.map(p => pixels(view, p, true)));
        }
        const strokes = () => evaluate(() => window.curveMapProbe.pathStrokes);

        for (const [i, id] of ["A", "B"].entries()) {
            await click("[data-geo-node=" + id + "]"); await paint();
            const before = await positions(["A", "B", "C"]), dx = 30 / (await frame()).scale;
            const checks = before.slice(i + 1).flatMap(points => {
                const [x, y] = eastEdge(points);
                return [[x, y], [x + dx, y]] satisfies Point[];
            });
            await checkPoints(checks);
            await drag(mixPoint(before[i][0], before[i][2], .5), 0, async () => {
                const rendered = await strokes();
                for (let j = 0; j < checks.length; j += 2)
                    assert(rendered.some(s => Math.abs(s.width - .6) < .001 && s.color === "rgba(34, 102, 89, 0.5)" &&
                        s.hits?.[j] === false && s.hits[j + 1] === true), "A follower's preview outline should be drawn at its new position");
            });
            const after = await positions(["A", "B", "C"]);
            before.forEach((points, j) => translated(points, after[j], j < i ? 0 : dx));
        }
        const current = await authored(), c = current.geoNodes.find(n => n.id === "C")!.construction;
        assert(c.type === "outline");
        assert.deepEqual(c.outlines[0], { ref: "{geo:B.construction.outlines.0}", offset: [16, 1] });

        await click("[data-tab=inputs]"); await click("[data-select-curve=S]"); await paint();
        const oldShared = current.curves.S.curve.nodes.map(n => n.p), before = await positions(["D", "E"]);
        const dx = 30 / (await frame()).scale;
        await checkPoints(before.map(eastEdge));
        await drag(mixPoint(oldShared[0], oldShared[1], .5), 0, async () => {
            const preview = await evaluate(() => window.curveMapProbe.editor!.dragShared!.curve.nodes.map(n => n.p));
            translated(oldShared, preview, dx);
            const rendered = await strokes();
            for (const i of [0, 1])
                assert(rendered.some(s => s.color === baseMap.light.boundary && s.hits?.[i]),
                    "A reference stays at its original position while the shared curve moves");
        });
        const after = await positions(["D", "E"]);
        before.forEach((points, i) => translated(points, after[i], 0));
        translated(oldShared, (await authored()).curves.S.curve.nodes.map(n => n.p), dx);
        assert(await evaluate(() => window.curveMapProbe.editor!.dragShared === undefined));
    }, d);
}