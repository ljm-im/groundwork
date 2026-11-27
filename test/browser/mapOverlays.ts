import { placedPoint } from "../../src/core/design/curveReferences.ts";
import assert from "node:assert/strict";
import { fixtureMark } from "../scenarios.ts";
import { type Mark, type Point, type Design } from "../../src/core/design/v5.ts";
import { distance, type Box } from "../../src/core/math/geometry.ts";
import { withLayeredMap } from "./layeredMapFixture.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export async function checkMapOverlays(url: string) {
    await checkOverlayPointers(url);
    await withLayeredMap(url, "screen-mark-resizing", async ({ authored, d, disk, drag, evaluate, frame, mouse, paint, point, saved, show, tap, undo, wait }) => {
        const screenMark = "[data-mark=R]";
        console.log("shorter canvas, mark bounds and list reveal");
        const markBefore = (await frame()).marks.find(m => m.id === "R")!;
        assert.deepEqual(markBefore.point, d.marks[0].screen);
        await evaluate(() => window.layeredMapProbe.resized = []);
        const split = await point("[data-split=bottom]");
        await mouse("mousePressed", ...split);
        for (let i = 1; i <= 6; i++) {
            await mouse("mouseMoved", split[0], split[1] - i * 40);
            await wait(i => window.layeredMapProbe.resized.length >= i, i);
        }
        await mouse("mouseReleased", split[0], split[1] - 240);
        await paint();
        const resized = await evaluate(() => window.layeredMapProbe.resized);
        assert(resized.every(r => r.alpha === 255));
        assert(new Set(resized.map(r => r.height)).size >= 6);
        const smaller = await frame(), clipped = smaller.marks.find(m => m.id === "R")!;
        assert(clipped.point[1] < markBefore.point[1]);
        assert(clipped.box[0] >= 0 && clipped.box[1] >= 0 && clipped.box[2] <= smaller.width && clipped.box[3] <= smaller.height);
        assert(clipped.box[2] - clipped.point[0] > 80);
        assert.deepEqual((await authored()).marks[0].point, d.marks[0].point);
        const markClient = await evaluate(([x, y]): Point => {
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return [x + box.left + 22, y + box.top];
        }, clipped.point);
        await tap(markClient);
        assert.equal(await evaluate(() => document.querySelector("[data-mark=R]")?.getAttribute("aria-pressed")), "true");
        await drag(markClient, [markClient[0] + 10, markClient[1] - 28]); await saved();
        assert(distance((await authored()).marks[0].screen, [clipped.point[0] + 10, clipped.point[1] - 28]) < .01);
        await undo();
        await show(screenMark);
        assert.deepEqual((await authored()).marks[0].point, d.marks[0].point);
        const afterReveal = await disk(), writes = await evaluate(() => window.probe.writes);
        await show(screenMark);
        assert.equal(await disk(), afterReveal);
        assert.equal(await evaluate(() => window.probe.writes), writes);
    });
    await withCurveMap(url, "bottom-map-overlays", async ({ cdp, evaluate, idle, moveOverMap, paint, pointer: mouse, saved, screenshot, wait }) => {
        for (const width of [1440, 375]) {
            await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
            await wait(width => innerWidth === width, width); await paint();
            await moveOverMap();
            await evaluate(() => window.curveMapProbe.editor!.message("已恢复未保存的草稿"));
            await paint();
            const boxes = await evaluate(() => {
                const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect().toJSON() as DOMRect;
                return { canvas: rect("#map"), map: rect(".map-wrap"), hint: rect("#mode-hint"),
                    position: rect("#position"), zoom: rect(".zoom-tools"), toast: rect("#toast"),
                    status: !!document.querySelector(".coords"), gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2")) };
            });
            const { canvas, map, hint, position, zoom, toast, gap } = boxes;
            assert(!boxes.status);
            assert.equal(canvas.bottom, map.bottom);
            assert.equal(hint.left - map.left, 12);
            assert.equal(map.right - position.right, 12);
            assert.equal(map.bottom - position.bottom, 12);
            assert.equal(zoom.right, position.right);
            assert.equal(position.top - zoom.bottom, gap);
            assert(Math.abs((toast.left + toast.right - map.left - map.right) / 2) < 1);
            if (width === 375) {
                assert(hint.bottom < position.top && hint.right <= zoom.left);
                assert(toast.bottom < hint.top);
            }
            else {
                assert(hint.right < toast.left && toast.right < position.left);
            }
            await screenshot(width === 375 ? "map-bottom-narrow" : "map-bottom-wide");
            await mouse("mouseMoved", [map.right - 5, map.top - 4], 0, "none");
            await wait(() => document.querySelector<HTMLElement>("#position")?.hidden);
        }

        const visible = () => evaluate(() => {
            const el = document.querySelector<HTMLElement>("#toast")!;
            return !el.hidden && Number(getComputedStyle(el).opacity) > 0 ? el.textContent : "";
        });
        assert.equal(await evaluate(async () => {
            const editor = window.curveMapProbe.editor!;
            editor.toast = null;
            let flashed = false, observing = true;
            function observe() {
                const el = document.querySelector<HTMLElement>("#toast")!;
                flashed ||= el.textContent === "计算中" && Number(getComputedStyle(el).opacity) > 0;
                if (observing) requestAnimationFrame(observe);
            }
            requestAnimationFrame(observe);
            await editor.working("正在更新地件…", () => {});
            observing = false;
            return flashed;
        }), false);
        assert.equal(await visible(), "");
        await evaluate(() => {
            const probe = window.curveMapProbe;
            void probe.editor!.working("正在更新地件…", () => new Promise<void>(resolve => {
                probe.release = resolve;
            }));
        });
        await wait(() => !!window.curveMapProbe.release);
        assert.equal(await visible(), "");
        await wait(() => {
            const toast = document.querySelector<HTMLElement>("#toast")!;
            return toast.textContent === "计算中" && !toast.hidden && Number(getComputedStyle(toast).opacity) === 1;
        });
        await evaluate(() => window.curveMapProbe.editor!.message("已新建设计"));
        assert.equal(await visible(), "已新建设计");
        await wait(() => document.querySelector("#toast")?.textContent === "计算中");
        assert.equal(await visible(), "计算中");
        await evaluate(() => window.curveMapProbe.release!());
        await idle(); await saved();
        assert.equal(await visible(), "");
    });
}

async function checkOverlayPointers(url: string) {
    await withLayeredMap(url, "map-overlays", async ({ cdp, click, d, evaluate, fit, frame, key, openDesign, paint, panel, point, saved, screenshot, wait }) => {
        const overlaySelectors = ["#mode-hint", "#position", ".zoom-tools"];
        const passThrough = ["#mode-hint .hint-entry", "#position"];
        const park = async () => {
            await evaluate(() => window.scrollTo(0, 0));
            await paint();
        };
        async function pointer(type: string, [x, y]: Point, button = "left") {
            await cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1,
                buttons: type === "mouseReleased" || button === "none" ? 0 : button === "middle" ? 4 : 1 });
        }
        async function drag(from: Point, to: Point, button = "left", during?: () => Promise<void>) {
            await pointer("mousePressed", from, button);
            await pointer("mouseMoved", to, button);
            await paint();
            await during?.();
            await pointer("mouseReleased", to, button);
            await paint();
        }
        async function tap(at: Point) {
            await pointer("mousePressed", at);
            await pointer("mouseReleased", at);
            await paint();
        }
        function layout() {
            return evaluate(selectors => {
                const canvas = document.querySelector("#map")!.getBoundingClientRect();
                const boxes = selectors.map(selector => {
                    const { left, top, right, bottom } = document.querySelector(selector)!.getBoundingClientRect();
                    return [left - canvas.x, top - canvas.y, right - canvas.x, bottom - canvas.y] as Box;
                });
                return { origin: [canvas.x, canvas.y] as Point, boxes, width: canvas.width, height: canvas.height };
            }, overlaySelectors);
        }
        const mark = async (id: string) => (await frame()).marks.find(m => m.id === id)!;
        const selected = () => evaluate(() => document.querySelector<HTMLElement>("[data-mark][aria-pressed=true]")?.dataset.mark);
        const authored = (name: string) => evaluate(async name => JSON.parse(await window.disk(name)) as Design, name);
        async function uncovered(id: string) {
            const [l, t, r, b] = (await mark(id)).box;
            for (const [a, c, x, y] of (await layout()).boxes)
                assert(l >= x - .01 || r <= a + .01 || t >= y - .01 || b <= c + .01, JSON.stringify({ id, mark: [l, t, r, b], overlay: [a, c, x, y] }));
        }
        for (const width of [1440, 375]) {
            const name = (width === 1440 ? "map-overlay-wide" : "map-overlay-narrow") + ".json";
            await cdp("Emulation.setDeviceMetricsOverride", { width, height: 960, deviceScaleFactor: 1, mobile: false });
            await park(); await fit();
            const { origin: [a, b], height, boxes } = await layout();
            const camera = await frame(), toWorld = ([x, y]: Point): Point => [
                camera.center[0] + (x - a - camera.width / 2) / camera.scale,
                camera.center[1] - (y - b - height / 2 - 9) / camera.scale
            ];
            const targets = await Promise.all(passThrough.map(s => point(s)));
            const [hint,, zoom] = boxes, home: Point = [a + 22, b + 75];
            const screenMarks: Mark[] = [
                fixtureMark(d, { kind: "scale", id: "hint-ruler", label: "提示比例尺", point: [hint[0] + 7, (hint[1] + hint[3]) / 2], follow: "screen" }),
                fixtureMark(d, { kind: "scale", id: "zoom-ruler", label: "工具栏比例尺", point: [zoom[0] - 14, (zoom[1] + zoom[3]) / 2], follow: "screen" }),
                fixtureMark(d, { kind: "text", id: "screen-text", label: "屏幕文字".repeat(20), point: [camera.width / 2, height - 20], follow: "screen" })
            ];
            const mapMarks: Mark[] = [...targets, await point("#fit")].map((at, i) => (fixtureMark(d, {
                kind: "text", id: "map-" + i, label: String.fromCharCode(65 + i), point: toWorld(at), follow: "map"
            })));
            const design = { ...d, marks: [...screenMarks, ...mapMarks] };
            await openDesign(name, design); await park();
            assert.deepEqual((await authored(name)).marks.map(m => m.point), design.marks.map(m => m.point));
            for (const m of screenMarks) await uncovered(m.id);
            const settled = await mark("screen-text");
            await pointer("mouseMoved", home, "none");
            await wait(() => !document.querySelector<HTMLElement>("#position")?.hidden);
            await pointer("mouseMoved", [a + camera.width - 20, b + height / 2], "none");
            await pointer("mouseMoved", [a + 10, b - 3], "none");
            await wait(() => document.querySelector<HTMLElement>("#position")?.hidden);
            assert.deepEqual(await mark("screen-text"), settled);
            await drag([a + settled.point[0], b + settled.point[1]], [a + camera.width / 2, home[1] + 65]); await saved();

            for (const [i, m] of screenMarks.slice(0, 2).entries()) {
                const { point: [x, y] } = await mark(m.id), from: Point = [a + x + 12, b + y];
                await drag(from, [home[0] + i * 125, home[1] + 25]); await saved();
                assert.equal(await selected(), m.id);
                assert(distance((await authored(name)).marks[i].screen, m.screen) > 25);
            }

            for (const [i, target] of targets.entries()) {
                await pointer("mouseMoved", target, "none");
                assert.equal(await evaluate(at => document.elementFromPoint(...at)?.id, target), "map");
                if (!i) await wait(() => document.querySelector("[data-mode-hint-details]:popover-open"));
                await tap(target);
                assert.equal(await selected(), "map-" + i);
                await drag(target, [target[0], target[1] - 34], "left", async () => {
                    assert(!await evaluate(() => !!document.querySelector("[data-mode-hint-details]:popover-open")));
                });
                await saved();
                const edited = await authored(name);
                assert(distance(placedPoint(edited, edited.marks.find(m => m.id === "map-" + i)!.point), placedPoint(d, mapMarks[i].point)) > 1);
                const before = (await frame()).scale;
                await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: target[0], y: target[1], deltaX: 0, deltaY: -120 });
                await paint();
                assert((await frame()).scale > before);
                await fit();
            }

            await panel("marks"); await click("[aria-label=新建标记]");
            await click(".creation-menu [data-option=scaleMark]");
            await park();
            await tap(await evaluate(() => {
                const { left, top } = document.querySelector(".zoom-tools")!.getBoundingClientRect();
                return [left + 2, top + 2];
            })); await saved(); await paint();
            const added = (await authored(name)).marks.at(-1)!;
            assert.equal(added.kind, "scale");
            await uncovered(added.id);
            const dragged = "hint-ruler", before = await frame(), beforeDrag = (await mark(dragged)).point;
            const [sx, sy] = beforeDrag, button = await point("#plus");
            let preview: Point | undefined;
            await drag([a + sx + 10, b + sy], button, "left", async () => {
                await uncovered(dragged);
                preview = (await mark(dragged)).point;
            });
            await saved();
            const placed = (await authored(name)).marks.find(m => m.id === dragged)!.screen;
            assert(preview && distance(placed, preview) < .02 && distance(placed, beforeDrag) > 3);
            assert.equal((await frame()).scale, before.scale, "Release over the zoom button finishes the canvas drag");
            assert.equal(await selected(), dragged);
            await click("#minus"); await paint();
            const smaller = (await frame()).scale;
            assert(smaller < before.scale);
            await click("#plus"); await paint();
            assert.equal((await frame()).scale, before.scale);
            await evaluate(() => document.querySelector<HTMLButtonElement>("#minus")!.focus());
            await key("Enter"); await paint();
            assert.equal((await frame()).scale, smaller);
            await fit();
            assert.equal((await frame()).scale, before.scale);
            assert.equal(await selected(), dragged);

            const middle = await point("#map"), covered = mapMarks.at(-1)!;
            await drag(middle, [middle[0] - 100, middle[1] - 140], "middle");
            const now = await mark(covered.id), v = await frame();
            const visibleX = a + (now.point[0] - v.center[0]) * v.scale + v.width / 2;
            const visibleY = b + (v.center[1] - now.point[1]) * v.scale + v.height / 2 + 9;
            await tap([visibleX, visibleY]);
            assert.equal(await selected(), covered.id);
            assert.deepEqual((await authored(name)).marks.find(m => m.id === covered.id)!.point, covered.point);
        }
        await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
        await park(); await fit();
        await panel("layers");
        if (!await evaluate(() => document.querySelector<HTMLInputElement>("[data-layer=grid]")!.checked)) await click("[data-layer=grid]");
        const [x, y] = await point("#map"), box = await layout();
        await drag([x, y], [x, y + 125], "middle");
        await pointer("mouseMoved", [x, y], "none");
        await wait(() => !document.querySelector<HTMLElement>("#position")?.hidden);
        for (const theme of ["light", "dark"]) {
            await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
            await wait(theme => document.documentElement.dataset.theme === theme, theme);
            await paint();
            assert(await evaluate(() => [...document.querySelectorAll(".map-chip")].every(el => {
                const style = getComputedStyle(el);
                return style.opacity === "1" && /\/ 0\.9\)$/.test(style.backgroundColor);
            })));
            await screenshot("map-overlay-" + theme, { x: box.origin[0], y: box.origin[1] + box.height - 114, width: box.width, height: 114 });
        }
    });
}