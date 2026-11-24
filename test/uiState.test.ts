import { test } from "node:test";
import "../configs/register-svelte.ts";
import assert from "node:assert/strict";
import { createGrid, distance } from "../src/core/math/geometry.ts";
import { sectionHandles } from "../src/core/edit/controls.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { History } from "../src/core/edit/history.ts";
import { propertyTabs } from "../src/app/state/inspector.ts";
import { Project } from "../src/core/project.ts";
import { pixelGridSpacing } from "../src/app/state/layers.ts";
import { constrainGeoLabel, constrainSectionLabel, geoLabelPoint } from "../src/render/labelLayout.ts";
import { makeShape, rasterRegion } from "../src/core/design/regions.ts";
import { ProjectMap } from "../src/render/map.ts";
import { render } from "svelte/server";
import { polygon, rect, syntheticDesign } from "./scenarios.ts";

test("Map focus, hit radius and the selected inspector issue", async () => {
    const baseline = new Project(syntheticDesign());
    const session = await import("../src/app/state/session.svelte.ts");
    const { default: GeoProperties } = await import("../src/app/components/GeoProperties.svelte");
    const selected = baseline.issues.find(i => !!i.geoNode)!;
    const view = Object.assign(Object.create(ProjectMap.prototype) as ProjectMap, {
        project: baseline.view(), width: 1000, height: 700, layers: { issues: true }, draw() { }, clearIssue() {
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
    Object.assign(ui, { project: baseline, map: view, tab: "terrain", issue: selected, selectedIssues: [selected] });
    ui.setSelection({ kind: "geoNode", id: selected.geoNode! });
    ui.changePropertyTab("issues");
    const { body: markup } = render(GeoProperties, { props: { editor: ui } });
    assert.match(markup, /data-property-tab="issues"[^>]*aria-pressed="true"/);
    assert.doesNotMatch(markup, /构造方式/);
    assert(markup.match(/<button[^>]*>/g)!.some(tag => tag.includes("aria-pressed=\"true\"") && tag.includes("data-issue=\"" + baseline.issues.indexOf(selected) + "\"")));
    ui.changePropertyTab("region");
    const { body: route } = render(GeoProperties, { props: { editor: ui } });
    assert.match(route, /构造方式/);
    assert.doesNotMatch(route, /data-issue=/);
});

test("Variable preview keeps cached geometry and matches a freshly opened design", () => {
    const design = syntheticDesign(), preview = new Project(design), region = preview.terrain.regions.get("T");
    design.inputs.A.value++;
    preview.update();
    assert.equal(preview.terrain.regions.get("T"), region);
    const full = new Project(structuredClone(design));
    assert.deepEqual(preview.terrain.fields.height.values, full.terrain.fields.height.values);
    assert.deepEqual(preview.terrain.fields.height.defined, full.terrain.fields.height.defined);
    assert.deepEqual(preview.issues, full.issues);
});

test("A committed prompt, undo and redo preserve the live project and all geometry", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign(), project = new Project(design);
    Object.assign(editor, { project, map: { draw() {} } });
    editor.busy = null;
    editor.history = new History(design);
    t.mock.method(editor.files, "remember", () => {});
    const generation = [t.mock.method(editor, "replace"), t.mock.method(project, "update")];
    const target = { group: "geoNodes" as const, id: design.geoNodes[0].id };
    const { fields, regions } = project.terrain, heights = fields.height.values;
    const focus = Symbol();
    editor.describe(target, "第一行", focus);
    editor.describe(target, "第一行\n第二行", focus);
    editor.describe(target, "第一行\n第二行", focus);
    assert.equal(editor.history.states.length, 2);
    assert.equal(design.geoNodes[0].prompt, "第一行\n第二行");
    editor.navigate(false);
    assert(!Object.hasOwn(design.geoNodes[0], "prompt"));
    editor.navigate(true);
    assert.equal(design.geoNodes[0].prompt, "第一行\n第二行");
    editor.describe(target, "");
    assert(!Object.hasOwn(design.geoNodes[0], "prompt"));
    editor.navigate(false);
    editor.describe(target, "覆盖分支");
    assert.equal(editor.canRedo, false);
    assert.deepEqual(generation.map(spy => spy.mock.callCount()), [0, 0]);
    assert.equal(editor.project, project);
    assert.equal(project.terrain.fields.height.values, heights);
    assert.equal(project.terrain.fields, fields);
    assert.equal(project.terrain.regions, regions);
});

test("Terrain work runs synchronously on a hit and defers cold history steps for two frames", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign(), frames: FrameRequestCallback[] = [];
    Object.assign(editor, { map: { clearIssue() {}, draw() {}, scale: 4 } });
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
    const regions = editor.project.terrain.regions.get("G");
    const hot = editor.edit(d => {
        d.geoNodes[0].label = "A";
    });
    assert.equal(editor.history.index, 1);
    assert.equal(editor.project.terrain.regions.get("G"), regions);
    editor.navigate(false);
    assert.equal(editor.history.index, 0);
    editor.navigate(true);
    assert.equal(editor.history.index, 1);
    assert.equal(editor.busy, null);
    assert.equal(frames.length, 0);
    await hot;

    await finishCold(editor.edit(d => {
        d.inputs.A.value = Number(d.inputs.A.value) + 1;
    }), "正在更新地件…", 1);
    await finishCold(editor.navigate(false), "正在更新地件…", 2);
    assert.equal(editor.history.index, 1);
    await finishCold(editor.edit(d => {
        d.inputs.seed.value = Number(d.inputs.seed.value) + 1;
    }), "正在更新地件…", 1);
    assert.equal(editor.history.index, 2);
    assert.equal(editor.canRedo, false);
});

test("Opening, creating and recovering a design each starts with empty terrain caches", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign(), text = JSON.stringify(design);
    Object.assign(editor, { map: { clearIssue() {}, draw() {}, scale: 4 } });
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
    const surfaces = [editor.project.terrain];
    await editor.files.open(file);
    surfaces.push(editor.project.terrain);
    await editor.files.choose("new");
    surfaces.push(editor.project.terrain);
    editor.draft = { filename: file.name, text, date: "" };
    await editor.files.restore();
    surfaces.push(editor.project.terrain);
    for (const field of ["fields", "regions"] as const)
        assert.equal(new Set(surfaces.map(s => s[field])).size, 4, field);
    assert.equal(new Set(surfaces.map(s => s.fields.height.defined)).size, 4);
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
    Object.assign(editor, { map: { clearIssue() {}, draw() {}, scale: 4 } });
    t.mock.method(editor, "refresh", () => {});
    t.mock.method(editor.files, "remember", () => {});
    t.mock.method(editor, "terrainWork", async (_d: unknown, fn: () => void) => {
        fn();
    });
    editor.replace(design); editor.map.project = editor.project.view(); editor.history = new History(design);
    const selected = { kind: "geoNode", id: n.id } as const;
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
    const owner = editor.project.design.geoNodes[1], target = editor.map.geometry;
    assert.deepEqual(target, { kind: "parameter", index: 0 });
    const handles = geoControls(owner, target);
    assert.equal(handles.length, 3); assert(handles.every(c => c.role === "parameter" && c.path === 0));
    editor.setTool("peak", n.id);
    draftPointer(editor, "down", [4, 4], { ctrlKey: true } as PointerEvent);
    assert.deepEqual(editor.selection, selected); assert.equal(editor.history.index, 1);
    draftPointer(editor, "up", [4, 4], { ctrlKey: true } as PointerEvent);
    assert.equal(editor.map.draft, undefined);
    assert.equal(editor.history.index, 2);
    assert.deepEqual(editor.selection, selected);
    assert.equal(geoControls(editor.project.design.geoNodes[1], editor.map.geometry).length, 1);
});

test("Isolating a section exposes only its own map handles", () => {
    const d = syntheticDesign();
    d.sections = [{ id: "S", label: "S", points: [[0, 0], [0, 5]] },
        { id: "T", label: "T", points: [[1, 0], [1, 5]] }];
    const design = resolveDesign(d);
    assert.deepEqual(sectionHandles(design, false, { kind: "section", id: "S" }).map(h => [h.kind, h.id, h.role, h.index]),
        [["section", "S", "vertex", 0], ["section", "S", "vertex", 1]]);
    assert.equal(sectionHandles(design, true).length, 4);
    assert.equal(sectionHandles(design, false).length, 0);
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
    const map = Object.assign(Object.create(ProjectMap.prototype) as ProjectMap, { center: [0, 0], width: 800, height: 450, scale: 3, referenceScale: 3,
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
    const make = (paths: ReturnType<typeof polygon>[]) => makeShape({ field: "height", id: "A", label: "A", construction: { type: "free", paths }, function: { type: "ground", value: 0 } }, new Map(), .125);
    const outer = rect(-8, -6, 8, 6).paths[0], hole = rect(-2, -2, 2, 2).paths[0];
    const holed = make([outer, hole]), point = geoLabelPoint(rasterRegion(grid, holed), grid)!;
    assert(holed.contains(point));
    assert.equal(Math.hypot(...point), Math.hypot(2.5, .5));
    const crossing = make([rect(-9, -3, 0, 3).paths[0], rect(-3, -1, 4, 1).paths[0]]);
    const centroid = geoLabelPoint(rasterRegion(grid, crossing), grid)!;
    assert(distance(centroid, [-109 / 28, 0]) < 1e-9);
    const shape = makeShape({ field: "height", id: "B", label: "B", function: { type: "blend" },
        construction: { type: "strip", of: ["A"], widths: [1, 2], range: { from: "0", to: "2" } } }, new Map([["A", make([outer])]]), .125);
    assert.deepEqual(geoLabelPoint(rasterRegion(grid, shape), grid), [6, -6]);
});

test("Map name anchors stay in their region or on their section", () => {
    const project = new Project(syntheticDesign()), { grid, regions } = project.terrain;
    const region = regions.get("T")!;
    assert.deepEqual(constrainGeoLabel(region, grid, [-18, -5]), [-18, -5]);
    const closest = constrainGeoLabel(region, grid, [100, 100])!;
    assert(region.cells.some(cell => distance(grid.point(cell), closest) === 0));
    assert(region.cells.every(cell => distance(grid.point(cell), [100, 100]) >= distance(closest, [100, 100])));
    assert.deepEqual(constrainSectionLabel([[0, 0], [10, 0]], [3, 4]), [3, 0]);
    assert.deepEqual(constrainSectionLabel([[0, 0], [10, 0]], [12, -3]), [10, 0]);
});

test("The inspector keeps compatible tabs and chooses the first available tab", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor();
    editor.setSelection({ kind: "geoNode", id: "A" });
    assert.equal(editor.propertyTab, "label");
    editor.changePropertyTab("function");
    editor.setSelection({ kind: "geoNode", id: "B" });
    assert.equal(editor.propertyTab, "function");
    editor.changePropertyTab("issues");
    editor.setSelection({ kind: "geoNode", id: "C" });
    assert.equal(editor.propertyTab, "issues");
    editor.setSelection({ kind: "section", id: "D" });
    assert.equal(editor.propertyTab, "label");
    for (const kind of ["mark", "input", "field", null] as const) {
        const selection = kind ? { kind, id: "E" } : null;
        editor.setSelection(selection);
        assert.equal(editor.propertyTab, "general");
        assert.equal(propertyTabs(selection).length, 1);
    }
});

test("Expanding and collapsing inspector subitems leaves the authored design and undo history intact", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = syntheticDesign();
    editor.project = new Project(design);
    editor.history = new History(design);
    const before = structuredClone(design), history = [...editor.history.states];
    assert.equal(editor.subitemOpen("A", "ridges", 0), false);
    editor.toggleSubitem("A", "ridges", 1, true);
    assert.equal(editor.subitemOpen("A", "ridges", 1), true);
    assert.equal(editor.subitemOpen("A", "ridges", 0), false);
    assert.equal(editor.subitemOpen("B", "ridges", 1), false);
    editor.toggleSubitem("A", "ridges", 1);
    assert.equal(editor.subitemOpen("A", "ridges", 1), false);
    assert.deepEqual(editor.project.design, before);
    assert.deepEqual(editor.history.states, history);
    assert.equal(editor.history.canUndo, false);
});

test("Selection history restores edited elements and list tabs preserve the selection", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d = syntheticDesign(), editor = new Editor();
    Object.assign(editor, { map: { draw() {}, clearIssue() {} } });
    t.mock.method(editor, "refresh", () => {});
    t.mock.method(editor, "terrainWork", async (_d: unknown, fn: () => void) => fn());
    t.mock.method(editor.files, "remember", () => {});
    editor.replace(d, true);
    editor.history = new History(d);
    editor.select({ kind: "geoNode", id: "T" });
    editor.select({ kind: "geoNode", id: "G" });
    const original = editor.selection;
    editor.changeTab("marks");
    assert.equal(editor.selection, original);
    await editor.addMark("text", [4, 5]);
    const created = editor.selection;
    assert.equal(created?.kind, "mark");
    await editor.navigate(false);
    assert.deepEqual(editor.selection, original);
    await editor.navigate(true);
    assert.deepEqual(editor.selection, created);
    await editor.removeElement(created!);
    assert.equal(editor.selection, null);
    await editor.navigate(false);
    assert.deepEqual(editor.selection, created);
    await editor.navigate(true);
    assert.equal(editor.selection, null);
});

test("Mark follow changes preserve the displayed anchor and screen coordinates ignore camera changes", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d = syntheticDesign(), editor = new Editor();
    const map = Object.assign(Object.create(ProjectMap.prototype) as ProjectMap, { center: [0, 0], width: 800, height: 450, scale: 3, referenceScale: 3,
        draw() {}, clearIssue() {} });
    Object.assign(editor, { map });
    t.mock.method(editor, "refresh", () => {});
    t.mock.method(editor, "terrainWork", async (_d: unknown, fn: () => void) => fn());
    t.mock.method(editor.files, "remember", () => {});
    editor.replace(d, true);
    editor.history = new History(d);
    await editor.addMark("scale", [64, 80]);
    const id = editor.selection!.id, anchor = editor.project.design.marks[0].point;
    assert.deepEqual(map.markScreen(editor.project.design.marks[0]), anchor);
    map.zoomAt(2);
    map.center = [16, 18]; map.width = 1900;
    assert.deepEqual(map.markScreen(editor.project.design.marks[0]), anchor);
    await editor.setMarkFollow(id, "map");
    const mark = editor.project.design.marks[0];
    assert.notDeepEqual(mark.point, anchor);
    assert(distance(map.markScreen(mark), anchor) < 1e-9);
    await editor.setMarkFollow(id, "screen");
    assert(distance(editor.project.design.marks[0].point, anchor) < 1e-9);
});