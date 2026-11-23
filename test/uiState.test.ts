import { test } from "node:test";
import "../configs/register-svelte.ts";
import assert from "node:assert/strict";
import { fixtureOptions, readFixture } from "../configs/read-fixture.ts";
import { createGrid, distance } from "../src/core/math/geometry.ts";
import { handles } from "../src/core/edit/controls.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { History } from "../src/core/edit/history.ts";
import { propertyTabs } from "../src/app/state/inspector.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { pixelGridSpacing } from "../src/app/state/layers.ts";
import { geoLabelPoint } from "../src/render/labelLayout.ts";
import { makeShape, rasterRegion } from "../src/core/terrain/regions.ts";
import { IslandMap } from "../src/render/map.ts";
import { render } from "svelte/server";
import { polygon, rect, syntheticDesign } from "./scenarios.ts";

test("Map focus, hit radius and the selected inspector issue", fixtureOptions("round14-land.json"), async () => {
    const original = await readFixture("round14-land.json");
    const author = parseDesign(original), baseline = new Island(author);
    const session = await import("../src/app/state/session.svelte.ts");
    const { default: Network } = await import("../src/app/components/Network.svelte");
    const selected = baseline.issues.find(i => !!i.road)!;
    const view = Object.assign(Object.create(IslandMap.prototype) as IslandMap, {
        island: baseline.view(), width: 1000, height: 700, layers: { issues: true }, draw() { }, clearIssue() {
            view.activeIssue = null;
        }
    });
    const previousFrame: typeof requestAnimationFrame | undefined = Reflect.get(globalThis, "requestAnimationFrame");
    try {
        globalThis.requestAnimationFrame = () => 1;
        view.fit(false);
        view.focusIssue(selected);
        assert(distance(view.center, selected.point) < 5);
        const screen = view.screen(selected.point);
        assert(view.issueHits([screen[0] + 11.9, screen[1]]).includes(selected));
        assert(!view.issueHits([screen[0] + 12.1, screen[1]]).includes(selected));
        assert.equal(view.activeIssue, selected);
    }
    finally {
        if (previousFrame)
            globalThis.requestAnimationFrame = previousFrame;
        else
            Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    }
    const ui = new session.Editor();
    Object.assign(ui, { island: baseline, tab: "network", issue: selected });
    ui.setSelection({ kind: "edge", id: selected.road! });
    ui.changePropertyTab("issues");
    const { body: markup } = render(Network, { props: { editor: ui } });
    assert.match(markup, /data-property-tab="issues"[^>]*aria-pressed="true"/);
    assert.doesNotMatch(markup, /路线长度/);
    assert(markup.match(/<button[^>]*>/g)!.some(tag => tag.includes("issue-row is-selected") && tag.includes("data-issue=\"" + baseline.issues.indexOf(selected) + "\"")));
    ui.changePropertyTab("edge");
    const { body: route } = render(Network, { props: { editor: ui } });
    assert.match(route, /路线长度/);
    assert.doesNotMatch(route, /data-issue=/);
});

test("Variable preview keeps the alignment and release matches a freshly opened design", () => {
    const design = syntheticDesign(), preview = new Island(design), line = preview.routes[0].points;
    design.inputs.A.value++;
    preview.inputs();
    assert.equal(preview.routes[0].points, line);
    preview.inputs(true);
    const full = new Island(structuredClone(design));
    assert.deepEqual(preview.graded.heights, full.graded.heights);
    assert.deepEqual(preview.routes, full.routes);
    assert.deepEqual(preview.trees, full.trees);
    assert.deepEqual(preview.issues, full.issues);
});

test("A committed prompt, undo and redo preserve the live island and all geometry", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign(), island = new Island(design);
    editor.island = island;
    editor.busy = null;
    editor.history = new History(design);
    t.mock.method(editor.files, "remember", () => {});
    const generation = [t.mock.method(editor, "replace"), t.mock.method(editor, "rebuild"), t.mock.method(island, "reroute"), t.mock.method(island, "replant")];
    const target = { group: "buildings" as const, id: design.buildings[0].id };
    const heights = island.terrain.heights, routes = island.routes, trees = island.trees;
    editor.describe(target, "第一行\n第二行");
    editor.describe(target, "第一行\n第二行");
    assert.equal(editor.history.states.length, 2);
    assert.equal(design.buildings[0].prompt, "第一行\n第二行");
    editor.navigate(false);
    assert(!Object.hasOwn(design.buildings[0], "prompt"));
    editor.navigate(true);
    assert.equal(design.buildings[0].prompt, "第一行\n第二行");
    editor.describe(target, "");
    assert(!Object.hasOwn(design.buildings[0], "prompt"));
    editor.navigate(false);
    editor.describe(target, "覆盖分支");
    assert.equal(editor.canRedo, false);
    assert.deepEqual(generation.map(spy => spy.mock.callCount()), [0, 0, 0, 0]);
    assert.equal(editor.island, island);
    assert.equal(island.terrain.heights, heights);
    assert.equal(island.routes, routes);
    assert.equal(island.trees, trees);
});

test("Terrain work runs synchronously on a hit and defers cold history steps for two frames", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign(), frames: FrameRequestCallback[] = [];
    Object.assign(editor, { map: { clearIssue() {}, draw() {} } });
    t.mock.method(editor, "refresh", () => {});
    t.mock.method(editor.files, "remember", () => {});
    const previous = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = cb => frames.push(cb);
    t.after(() => {
        if (previous) globalThis.requestAnimationFrame = previous;
        else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    });
    async function finishCold(work: Promise<void> | void, label: string, index: number) {
        assert.equal(editor.busy, label);
        for (let i = 0; i < 2; i++) {
            assert.equal(editor.history.index, index);
            assert.equal(frames.length, 1);
            frames.shift()!(i * 16);
        }
        await work;
        assert.equal(editor.busy, null);
        assert.equal(frames.length, 0);
    }
    editor.replace(design, true);
    editor.history = new History(design);
    const regions = editor.island.terrain.regions.get("G");
    design.buildings[0].height++;
    const hot = editor.rebuild();
    assert.equal(editor.history.index, 1);
    assert.equal(editor.island.terrain.regions.get("G"), regions);
    editor.navigate(false);
    assert.equal(editor.history.index, 0);
    editor.navigate(true);
    assert.equal(editor.history.index, 1);
    assert.equal(editor.busy, null);
    assert.equal(frames.length, 0);
    await hot;

    editor.island.design.inputs.A.value = Number(editor.island.design.inputs.A.value) + 1;
    await finishCold(editor.rebuild(), "正在更新地件…", 1);
    await finishCold(editor.navigate(false), "正在更新地件…", 2);
    assert.equal(editor.history.index, 1);
    editor.island.design.inputs.seed.value = Number(editor.island.design.inputs.seed.value) + 1;
    await finishCold(editor.rebuild(), "正在更新地件…", 1);
    assert.equal(editor.history.index, 2);
    assert.equal(editor.canRedo, false);
});

test("Opening, creating and recovering a design each starts with empty terrain caches", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign(), text = JSON.stringify(design);
    Object.assign(editor, { map: { clearIssue() {}, draw() {} } });
    Object.assign(editor.files, { supported: true });
    t.mock.method(editor, "refresh", () => {});
    t.mock.method(editor, "message", () => {});
    t.mock.method(editor.files, "remember", () => {});
    t.mock.method(editor, "working", async (_label: string, fn: () => void) => fn());
    const file = {
        name: "A.json",
        async requestPermission() {
            return "granted" as const;
        },
        async getFile() {
            return new File([text], this.name);
        },
        async createWritable() {
            throw Error("Unexpected file write");
        }
    };
    editor.replace(design, true);
    const surfaces = [editor.island.terrain];
    await editor.files.open(file);
    surfaces.push(editor.island.terrain);
    await editor.files.choose("new");
    surfaces.push(editor.island.terrain);
    editor.draft = { filename: file.name, text, date: "" };
    await editor.files.restore();
    surfaces.push(editor.island.terrain);
    for (const field of ["fields", "defined", "regions"] as const)
        assert.equal(new Set(surfaces.map(s => s[field])).size, 4, field);
    assert.equal(editor.draft, null);
    assert.equal(editor.dirty, true);
});

test("Attached menus open within the inspector and keep the control's edges", async () => {
    const { popupBounds } = await import("../src/app/state/popup.ts");
    const box = { left: 37, width: 184, top: 390, bottom: 418 };
    assert.deepEqual(popupBounds(box, 180, 430, 160), { left: 37, top: 228, width: 184, height: 160, upwards: true });
    assert.deepEqual(popupBounds(box, 375, 780, 160), { left: 37, top: 420, width: 184, height: 160, upwards: false });
    assert.equal(popupBounds(box, 360, 429, 200).height, 28);
});

test("Drawing or canceling a parameter keeps its owner and activates only the completed line", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const { draftPointer } = await import("../src/app/state/geoTools.ts");
    const { geoControls } = await import("../src/core/edit/geoControls.ts");
    const editor = new Editor(), design = syntheticDesign(), n = design.geoNodes[1];
    n.function = { type: "mountain", ridges: [], peaks: [] };
    Object.assign(editor, { map: { clearIssue() {}, draw() {} } });
    t.mock.method(editor, "refresh", () => {});
    t.mock.method(editor.files, "remember", () => {});
    t.mock.method(editor, "terrainWork", async (_d: unknown, fn: () => void) => {
        fn();
    });
    editor.replace(design); editor.map.island = editor.island.view(); editor.history = new History(design);
    const selected = { kind: "geoNode", id: n.id };
    editor.select(selected);
    for (const cancel of [true, false]) {
        editor.setTool("ridge", n.id); assert.deepEqual(editor.selection, selected);
        for (const p of [[2, 4], [6, 5], [7, 8]] as [number, number][]) {
            for (const phase of ["down", "up"] as const) draftPointer(editor, phase, p, { ctrlKey: true } as PointerEvent);
            assert.deepEqual(editor.selection, selected);
        }
        if (cancel) editor.setTool("select"); else await editor.completeDrawing();
        assert.equal(editor.tool, "select"); assert.deepEqual(editor.selection, selected);
        assert.equal(editor.history.index, cancel ? 0 : 1);
    }
    const owner = editor.island.design.geoNodes[1], target = editor.map.geometry;
    assert.deepEqual(target, { kind: "parameter", index: 0 });
    const handles = geoControls(owner, target);
    assert.equal(handles.length, 3); assert(handles.every(c => c.role === "parameter" && c.path === 0));
    editor.setTool("peak", n.id);
    for (const p of [[4, 4], [5, 5]] as [number, number][]) {
        for (const phase of ["down", "up"] as const) draftPointer(editor, phase, p, { ctrlKey: true } as PointerEvent);
        assert.deepEqual(editor.selection, selected); assert.equal(editor.history.index, 1);
    }
    assert.equal(editor.map.draft!.nodes.length, 1); await editor.completeDrawing();
    assert.equal(geoControls(editor.island.design.geoNodes[1], editor.map.geometry).length, 1);
});

test("Isolating a building centre, route, waypoint or section exposes only its own map handles", () => {
    const d = syntheticDesign();
    d.sections = [{ id: "S", label: "S", points: [[0, 0], [0, 5]], marks: [] }];
    d.edges[0].via = [[2, 3], [3, 4]];
    const design = resolveDesign(d), only = (kind: string, id: string, index = 0) =>
        handles(design, {}, null, { kind, id, index }).map(h => [h.kind, h.id, h.role, h.index]);
    assert.deepEqual(only("building", "A"), [["building", "A", "center", 0]]);
    assert.deepEqual(only("node", "a"), [["node", "a", "endpoint", 0]]);
    assert.deepEqual(only("via", "E", 1), [["via", "E", "vertex", 1]]);
    assert.deepEqual(only("edge", "E"), [["node", "a", "endpoint", 0], ["via", "E", "vertex", 0], ["via", "E", "vertex", 1], ["node", "b", "endpoint", 0]]);
    assert.deepEqual(only("section", "S"), [["section", "S", "vertex", 0], ["section", "S", "vertex", 1]]);
});

test("Fixed pixel grids choose the closest nice spacing at each zoom", () => {
    const nice = Array.from({ length: 19 }, (_, i) => [1, 2, 5].map(n => n * 10 ** (i - 9))).flat();
    for (const reference of [.2, 1, 4.13, 85]) for (const zoom of [.05, .09, .4, 1, 2.4, 9, 30]) {
        const scale = reference * zoom;
        for (const target of [17, 80, 103]) {
            const step = pixelGridSpacing(scale, target);
            assert(nice.includes(step));
            assert(nice.every(other => Math.abs(step * scale - target) <= Math.abs(other * scale - target) + 1e-9));
        }
    }
});

test("Zoom stays between 5 and 3000 percent and keeps its anchor fixed", () => {
    const map = Object.assign(Object.create(IslandMap.prototype) as IslandMap, { center: [0, 0], width: 800, height: 450, scale: 3, referenceScale: 3,
        draw() {} });
    const anchor = map.world(200, 300);
    map.zoomAt(.001, 200, 300);
    assert(Math.abs(map.zoomFactor() - .05) < 1e-12);
    const min = map.scale;
    map.zoomAt(.9, 200, 300);
    assert.equal(map.scale, min);
    assert(distance(map.world(200, 300), anchor) < 1e-9);
    map.zoomAt(10000, 200, 300);
    assert.equal(map.zoomFactor(), 30);
    map.zoomAt(1.4, 200, 300);
    assert.equal(map.zoomFactor(), 30);
    assert(distance(map.world(200, 300), anchor) < 1e-9);
});

test("Terrain labels use the even-odd centroid, the nearest cell in a hole and the strip midpoint", () => {
    const grid = createGrid({ xMin: -12, xMax: 12, yMin: -12, yMax: 12, step: 1 });
    const make = (paths: ReturnType<typeof polygon>[]) => makeShape({ id: "A", label: "A", construction: { type: "free", paths }, function: { type: "ground", value: 0 } }, new Map(), .125);
    const outer = rect(-8, -6, 8, 6).paths[0], hole = rect(-2, -2, 2, 2).paths[0];
    const holed = make([outer, hole]), point = geoLabelPoint(rasterRegion(grid, holed), grid)!;
    assert(holed.contains(point));
    assert.equal(Math.hypot(...point), Math.hypot(2.5, .5));
    const crossing = make([rect(-9, -3, 0, 3).paths[0], rect(-3, -1, 4, 1).paths[0]]);
    const centroid = geoLabelPoint(rasterRegion(grid, crossing), grid)!;
    assert(distance(centroid, [-109 / 28, 0]) < 1e-9);
    const shape = makeShape({ id: "B", label: "B", function: { type: "blend" },
        construction: { type: "strip", of: ["A"], widths: [1, 2], range: { from: "0", to: "2" } } }, new Map([["A", make([outer])]]), .125);
    assert.deepEqual(geoLabelPoint(rasterRegion(grid, shape), grid), [6, -6]);
});

test("The inspector keeps compatible tabs, chooses the first available tab, and opens a waypoint on its road", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor();
    editor.setSelection({ kind: "geoNode", id: "A" });
    assert.equal(editor.propertyTab, "label");
    editor.changePropertyTab("function");
    editor.setSelection({ kind: "geoNode", id: "B" });
    assert.equal(editor.propertyTab, "function");
    editor.setSelection({ kind: "building", id: "C" });
    assert.equal(editor.propertyTab, "label");
    editor.changePropertyTab("issues");
    editor.setSelection({ kind: "edge", id: "D" });
    assert.equal(editor.propertyTab, "issues");
    editor.setSelection({ kind: "via", id: "D", index: 0 });
    assert.equal(editor.propertyTab, "edge");
    for (const kind of ["mark", "input", "field", null]) {
        const selection = kind ? { kind, id: "E" } : null;
        editor.setSelection(selection);
        assert.equal(editor.propertyTab, "general");
        assert.equal(propertyTabs(selection).length, 1);
    }
});

test("Expanding and collapsing inspector subitems leaves the authored design and undo history intact", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign();
    editor.island = new Island(design);
    editor.history = new History(design);
    const before = structuredClone(design), history = [...editor.history.states];
    assert.equal(editor.subitemOpen("A", "ridges", 0), false);
    editor.toggleSubitem("A", "ridges", 1, true);
    assert.equal(editor.subitemOpen("A", "ridges", 1), true);
    assert.equal(editor.subitemOpen("A", "ridges", 0), false);
    assert.equal(editor.subitemOpen("B", "ridges", 1), false);
    editor.toggleSubitem("A", "ridges", 1);
    assert.equal(editor.subitemOpen("A", "ridges", 1), false);
    assert.deepEqual(editor.island.design, before);
    assert.deepEqual(editor.history.states, history);
    assert.equal(editor.history.canUndo, false);
});