import assert from "node:assert/strict";
import { placedPoint } from "../../src/core/design/curveReferences.ts";
import { type Design, type Point } from "../../src/core/design/v5.ts";
import { distance } from "../../src/core/math/geometry.ts";
import { mapColors } from "../../src/render/palette.ts";
import { addLayer, fixtureMark, fixtureSection, literalCurve, rect, syntheticDesign } from "../scenarios.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export function checkPointReferences(url: string) {
    const d = syntheticDesign(), source = d.geoNodes[1];
    assert(source.construction.type === "outline" && "curve" in source.construction.outlines[0]);
    const { curve: curveId } = source.construction.outlines[0], curve = literalCurve(d, curveId);
    const node = curve.nodes[2], nodeAt: Point = [node.p[0] + 5, node.p[1]], otherNode = curve.nodes[3],
        otherAt: Point = [otherNode.p[0] + 5, otherNode.p[1]], free: Point = [33, 26];
    source.construction.outlines[0].offset = [5, 0];
    source.outline = true;
    d.geometry[curveId].label = "备选轮廓";
    const m = addLayer(d, "M", rect(-34, 12, -7, 34), {
        type: "mountain", ridges: [], valleys: [], peaks: [{ at: [-18, 22], height: 14, radius: 3, noise: 0, scale: 1 }]
    });
    m.label = "山";
    d.geoNodes.push(m);
    const section = fixtureSection(d, { id: "Q", label: "剖面 1", points: [[26, 14], [32, 7]] });
    const point = section.points[0];
    assert("point" in point);
    point.offset = [-4, 1];
    d.geometry[point.point].label = "共用点";
    d.sections.push(section);
    d.marks.push({ id: "L", label: "说明", kind: "text", point: { ...point, offset: [-5, 6] }, follow: "map", screen: [0, 0] });
    const screen = fixtureMark(d, { id: "S", label: "屏幕标记", kind: "text", follow: "screen", point: [105, 95] });
    assert("point" in screen.point);
    d.geometry[screen.point.point].label = "屏幕专用点";
    d.marks.push(screen);
    d.geometry.free = { point: free, independent: true, label: "自由点" };

    return withCurveMap(url, "round44-point-references", async page => {
        const { click, text, key, paint, pointer, pixels, frame, evaluate, screenshot, tap, drag, saved, authored, disk, undo, wait } = page;
        const status = ".drawing-status", position = "#properties .geometry-box[aria-label=位置]";
        const pen = "#properties [aria-label=选取或移动位置]", ref = "#properties .geometry-reference[data-tip=引用点]";
        const menu = ".reference-menu[aria-label=\"引用点\"]";
        const root = (id: string) => "#properties [aria-label=" + id + "]";
        const peak = (design: Design) => {
            const f = design.geoNodes.find(n => n.id === "M")!.function;
            assert(f.type === "mountain");
            return f.peaks[0].at;
        };
        const move = async (p: Point) => {
            await pointer("mouseMoved", pixels(await frame(), p), 0, "none"); await paint();
        };
        const dotColors = async (p: Point) => {
            const at = pixels(await frame(), p, true);
            return (await evaluate(() => window.curveMapProbe.dots)).filter(dot => distance(dot.point, at) < .05).map(dot => dot.color);
        };
        const menuNames = () => evaluate(sel => [...document.querySelectorAll(sel + " [role=option]")].map(option => option.textContent!.trim()), menu);
        async function peakRow() {
            await click("[data-geo-node=M]");
            await click("[data-property-tab=function]");
            if (!(await evaluate(sel => !!document.querySelector(sel), pen))) await evaluate(() => {
                [...document.querySelectorAll<HTMLButtonElement>("#properties .subitem-toggle")]
                    .find(button => button.textContent?.trim() === "山峰 1")!.click();
            });
            await paint();
        }
        await peakRow();
        await click(ref);
        const names = await menuNames();
        assert(names.includes("共用点") && names.includes("自由点"));
        assert(!names.includes("解除引用") && !names.includes("备选轮廓") && !names.includes("屏幕专用点"));
        await key("Escape");

        await click(pen);
        assert.equal(await text(status + " strong"), "选取或移动“山”的山峰 1");
        assert.equal(await text(status + " > span"), "单击点或节点换用它，单击空白处移到那里");
        assert(!(await dotColors(nodeAt)).includes(mapColors.light.accent));
        await move(nodeAt);
        assert((await dotColors(nodeAt)).includes(mapColors.light.accent));
        await screenshot("round44-node-candidate");
        await tap(nodeAt); await saved();
        assert.equal(await text(position), "备选轮廓.节点 3");
        assert.deepEqual(peak(await authored()), { curve: curveId, node: node.id, offset: [5, 0] });
        assert.deepEqual(placedPoint(await authored(), peak(await authored())), nodeAt);

        await click(position);
        await paint();
        assert.deepEqual((await frame()).selectionPath, [{ kind: "geoNode", id: "M" }, { kind: "holder", group: "peaks", index: 0 }, { kind: "vertex", nodeId: node.id }]);
        assert.equal((await frame()).vertex?.index, 2);
        assert.equal(await evaluate(() => document.querySelector<HTMLInputElement>(".property-title input")?.value), "备选轮廓");
        assert.equal(await text("#properties [data-curve-node] .subitem-label"), "节点 3");
        assert.equal(await text("#properties [aria-label=\"山.山峰 1.位置\"] button"), "山.山峰 1.位置");
        await click(".property-title " + "[aria-label=选取或移动位置]");
        const beforeEscape = await disk();
        await key("Escape"); await paint();
        assert.equal(await disk(), beforeEscape);
        assert.equal(await text(status), "");

        await drag(nodeAt, 2);
        const dragged = await authored(), moved = literalCurve(dragged, curveId).nodes[2].p;
        assert(moved[0] > node.p[0]);
        assert.deepEqual(placedPoint(dragged, peak(dragged)), [moved[0] + 5, moved[1]]);
        assert.deepEqual(peak(dragged), { curve: curveId, node: node.id, offset: [5, 0] });
        await undo();
        await drag(otherAt, 2);
        assert.equal((await frame()).selectionPath?.at(-1)?.kind, "vertex");
        const siblingEdit = await authored();
        assert(literalCurve(siblingEdit, curveId).nodes[3].p[0] > otherNode.p[0]);
        assert.deepEqual(placedPoint(siblingEdit, peak(siblingEdit)), nodeAt);
        await undo();
        await click("#properties [data-curve-node] [aria-label=删除节点]");
        await wait(() => document.querySelector<HTMLDialogElement>("#remove-dialog")?.open);
        assert.equal(await text("#remove-heading"), "无法删除“节点 3”");
        assert.match(await text("#remove-dialog"), /山\.山峰 1\.位置/);
        await click("#remove-dialog [value=cancel]");
        await click("[data-property-tab=function]");
        assert.equal((await frame()).selectionPath?.at(-1)?.kind, "holder");
        await drag(nodeAt, 2);
        const placed = await authored();
        assert.deepEqual(literalCurve(placed, curveId).nodes[2].p, node.p);
        assert(placedPoint(placed, peak(placed))[0] > nodeAt[0]);
        await undo();

        await click("[data-geo-node=T]");
        await click("[data-property-tab=region]");
        if (!(await evaluate(() => !!document.querySelector("#properties [aria-label=选取或重画轮廓]"))))
            await click("#properties [data-outline] .subitem-toggle");
        await click("#properties [aria-label=选取或重画轮廓]");
        await tap([38, -18]);
        await wait(() => document.querySelector<HTMLDialogElement>("#remove-dialog")?.open);
        assert.equal(await text("#remove-heading"), "无法重画“备选轮廓”");
        assert.match(await text("#remove-dialog"), /山\.山峰 1\.位置/);
        await click("#remove-dialog [value=cancel]");
        await peakRow();

        await click(pen);
        await tap(free, 2); await saved();
        const ctrl = await authored();
        assert.deepEqual(peak(ctrl), { curve: curveId, node: node.id, offset: [5, 0] });
        assert(distance(placedPoint(ctrl, peak(ctrl)), free) < .02);
        await undo();
        await peakRow();

        await click(ref);
        assert((await menuNames()).includes("解除引用"));
        await click(menu + " [data-option=unlink]"); await saved();
        const unlinked = await authored(), ownPoint = peak(unlinked);
        assert("point" in ownPoint && !unlinked.geometry[ownPoint.point].independent);
        assert.deepEqual(placedPoint(unlinked, ownPoint), nodeAt);
        await click(ref);
        assert(!(await menuNames()).includes("解除引用"));
        const option = menu + " [data-option=\"point:" + point.point + "\"]";
        const optionCenter = await evaluate(sel => {
            const { left, top, width, height } = document.querySelector(sel)!.getBoundingClientRect();
            return [left + width / 2, top + height / 2] as [number, number];
        }, option);
        await pointer("mouseMoved", optionCenter, 0, "none"); await paint();
        for (const p of [[22, 15], [21, 20]] as Point[]) assert((await dotColors(p)).includes(mapColors.light.accent));
        await click(option); await saved();
        assert.equal(await text(position), "共用点");
        assert.deepEqual(peak(await authored()), { point: point.point, offset: [-4, 1] });

        await click(pen);
        await tap([10, 26]); await saved();
        const movedPoint = await authored();
        assert(distance(placedPoint(movedPoint, peak(movedPoint)), [10, 26]) < .02);
        assert(distance(placedPoint(movedPoint, movedPoint.marks[0].point), [9, 31]) < .02);

        await click("[data-tab=layers]");
        if (!(await evaluate(() => document.querySelector<HTMLInputElement>("input[data-layer=geometry]")!.checked)))
            await click("input[data-layer=geometry]");
        await click(pen);
        await tap(free); await saved();
        assert.deepEqual(peak(await authored()), { point: "free" });

        await click("[data-tab=marks]");
        await click("[data-section=Q]");
        await click("[data-property-tab=section]");
        assert(await evaluate(() => document.querySelector("[aria-label=\"为“起点”引用点\"]") && document.querySelector("[aria-label=\"为“终点”引用点\"]")));
        await click(root("选取或移动起点"));
        assert.equal(await text(status + " strong"), "选取或移动“剖面 1”的起点");
        await tap(otherAt); await saved();
        assert.deepEqual((await authored()).sections[0].points[0], { curve: curveId, node: otherNode.id, offset: [5, 0] });

        await click("[data-mark=L]");
        assert(await evaluate(() => document.querySelector("[aria-label=\"为“位置”引用点\"]")));
        await click(pen);
        assert.equal(await text(status + " strong"), "选取或移动“说明”的位置");
        await tap(nodeAt); await saved();
        assert.deepEqual((await authored()).marks[0].point, { curve: curveId, node: node.id, offset: [5, 0] });
        await click("[data-mark=S]");
        assert.equal(await text(position), "");

        await click("[data-tab=inputs]");
        await click("[data-select-geometry=free]");
        await click(".property-title [aria-label=移动点]");
        assert.equal(await text(status + " strong"), "移动点");
        await tap(nodeAt); await saved();
        const movedFree = await authored(), independent = movedFree.geometry.free;
        assert("point" in independent && distance(independent.point, nodeAt) < .02);
        assert.deepEqual(peak(movedFree), { point: "free" });
    }, d);
}