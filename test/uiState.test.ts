import { test } from "node:test";
import "../configs/register-svelte.ts";
import assert from "node:assert/strict";
import { createGrid, distance, type Point } from "../src/core/math/geometry.ts";
import { sectionHandles } from "../src/core/edit/controls.ts";
import { geoParameterName, resolveDesign } from "../src/core/design/parameters.ts";
import { History } from "../src/core/edit/history.ts";
import { commitControl, controlPreview, geometryPath, insertCurveNode } from "../src/core/edit/geoControls.ts";
import { holderLayer, holderTarget, selectionLayers, type SelectionPath } from "../src/core/edit/selection.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { type Design } from "../src/core/design/v5.ts";
import { positionReadings, readingRange } from "../src/app/state/mapText.ts";
import { controlSnap, sectionSnap } from "../src/app/state/mapSnaps.ts";
import { draftPointer } from "../src/app/state/geoTools.ts";
import { propertyTabs } from "../src/app/state/inspector.ts";
import { designProblemText } from "../src/app/state/designMessages.ts";
import { Project } from "../src/core/project.ts";
import { pixelGridSpacing } from "../src/core/edit/display.ts";
import { constrainGeoLabel, constrainSectionLabel, geoLabelPoint } from "../src/render/labelLayout.ts";
import { makeShape, rasterRegion, regionMaskAt } from "../src/core/design/regions.ts";
import { clampMarkPoint, dragMapHit, mapControlDrag, nextMapHit, ProjectMap } from "../src/render/map.ts";
import { testProjectModel, testTerrainClient } from "./computeFixture.ts";
import { render } from "svelte/server";
import { fixtureConstruction, fixtureFunction, fixtureMark, fixtureSection, withNodeSlope, coveredLandformPoints, addLayer, openCurve, overlappingLandforms, polygon, rect, resolvedRect, syntheticDesign } from "./scenarios.ts";

test("Hit branches follow the paint order, with parameters ahead of the containing outline", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const design = syntheticDesign(), point: Point = [-14, -8];
    design.geoNodes.push(addLayer(design, "M", rect(-25, -17, 5, 3), {
        type: "mountain", valleys: [], peaks: [{ at: point, height: 12, radius: 20, noise: 0, scale: 1 }],
        ridges: [{ curve: withNodeSlope(openCurve([{ p: [-23, -8] }, { p: [-4, -8] }]), 2) }]
    }));
    design.sections = [fixtureSection(design, { id: "Q", label: "Q", points: [[-24, -8], [1, -8]] })];
    const project = new Project(design), map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width: 1000, height: 700 });
    map.fit(project.terrain, false);
    const screen = map.screen(point), [x, y] = screen;
    const marks = ["A", "B"].map(id => ({ mark: { kind: "mark", id, role: "body", point }, box: [x - 5, y - 5, x + 5, y + 5] }));
    Object.assign(map, { markBoxes: marks });
    const editor = new Editor(testTerrainClient());
    Object.assign(editor, { project: testProjectModel(project), map });
    editor.layers.geoNodes = editor.layers.sections = true;
    const hits = [...map.objectHits(editor.mapView!, screen)];
    assert.deepEqual(hits.map(h => h.path[0].id), ["B", "A", "Q", "M", "T", "G"]);
    const mountain = hits[3].path, peak = selectionLayers(mountain);
    assert.deepEqual(peak.holder, holderLayer("peaks"));
    assert(peak.geometry && "point" in design.geometry[peak.geometry.id]);
    const ridge = [...map.objectHits(editor.mapView!, map.screen([-17, -8]))].find(h => h.path[0].id === "M")!;
    assert.deepEqual(selectionLayers(ridge.path).holder, holderLayer("ridges"));
    assert.deepEqual(nextMapHit(hits, null)?.path, [hits[0].path[0]]);
    assert.deepEqual(nextMapHit(hits, [{ kind: "geoNode", id: "other" }])?.path, [hits[0].path[0]]);
    for (const [i, hit] of hits.entries())
        assert.deepEqual(nextMapHit(hits, hit.path, true)?.path, [hits[(i + 1) % hits.length].path[0]]);
    editor.layers.geoNodes = false;
    assert.deepEqual([...map.objectHits(editor.mapView!, screen)].map(h => h.path[0].id), ["B", "A", "Q", "M", "T", "G"]);
    assert.equal(nextMapHit([], [{ kind: "geoNode", id: "M" }]), undefined);
});

test("Outline hits expose vertices and segments only on their selected geometry branch", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const project = new Project(overlappingLandforms()), editor = new Editor(testTerrainClient());
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width: 1000, height: 700, markBoxes: [] });
    map.fit(project.terrain, false);
    Object.assign(editor, { project: testProjectModel(project), map });
    editor.layers.geoNodes = true;
    for (const point of coveredLandformPoints) {
        const screen = map.screen(point), view = editor.mapView!;
        assert.equal(map.objectHits(view, screen).next().value?.path[0].id, "B");
        const next = nextMapHit(map.objectHits(view, screen), [{ kind: "geoNode", id: "B" }], true);
        assert.deepEqual(next?.path, [{ kind: "geoNode", id: "A" }]);
    }
    const hit = (point: Point) => [...map.objectHits(editor.mapView!, map.screen(point))].find(h => h.path[0].id === "A")!;
    assert.deepEqual(selectionLayers(hit([0, 10]).path).holder, holderLayer("ridges", 1));
    const vertex: Point = [-16, 10], edge: Point = [-16, 8];
    const path = hit(vertex).path;
    assert.equal(path.length, 3);
    assert.deepEqual(path[1], holderLayer("outlines"));
    assert.equal(hit(edge).path.length, 3);
    editor.selectPath([path[0], path[1]!]);
    assert.equal(hit(vertex).path.length, 3);
    editor.selectPath(path);
    assert.equal(hit(vertex).control?.role, "vertex");
    assert.equal(hit(edge).control?.role, "segment");
    assert.equal(hit(vertex).path.length, 4);
});

test("Map face hits include holes while the terrain raster uses even-odd coverage", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const design = syntheticDesign(), outline = rect(-20, -18, 20, 18), hole = rect(-8, -7, 8, 7).outlines[0];
    for (const node of hole.curve.nodes) node.id = "hole-" + node.id;
    outline.outlines.push(hole);
    design.geoNodes[1].construction = fixtureConstruction(design, outline);
    const project = new Project(design), editor = new Editor(testTerrainClient());
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width: 1000, height: 700, markBoxes: [] });
    map.fit(project.terrain, false);
    Object.assign(editor, { project: testProjectModel(project), map });
    const point: Point = [0, 0], screen = map.screen(point), { grid, regions } = project.terrain;
    const region = regions.get("T")!;
    assert.equal(regionMaskAt(region, grid.index(...point)), 0);
    assert.equal(regionMaskAt(region, grid.index(12, 0)), 1);
    assert.equal(map.pickGeo(project.view(), point)?.id, "T");
    const click = (at = screen, alt = false) => {
        const path = nextMapHit(map.objectHits(editor.mapView!, at), editor.selectionPath, alt)?.path ?? null;
        editor.selectPath(path);
        return path;
    };
    const [hit] = map.objectHits(editor.mapView!, screen);
    assert.deepEqual(hit.path.slice(0, 2), [{ kind: "geoNode", id: "T" }, holderLayer("outlines", 1)]);
    for (const depth of [1, 2, 3, 3]) assert.equal(click()?.length, depth);
    assert.deepEqual(click(map.screen([12, 0])), [hit.path[0]]);
    click();
    assert.deepEqual(click(screen, true), [{ kind: "geoNode", id: "G" }]);
});

test("Map gestures use only related alignment points and Shift and Ctrl bypass nearby snaps", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const design = syntheticDesign(), nodes: Point[] = [[-28, 6], [-14, 16], [2, 23], [25, 30]];
    const line = openCurve(nodes.map((p, i) => ({ p, h: 4 + i })));
    line.nodes[1].out = [3, 0];
    design.geoNodes.push(addLayer(design, "M", rect(-39, 0, 36, 38), {
        type: "mountain", valleys: [], ridges: [{ curve: withNodeSlope(line, 1) }], peaks: [{ at: [0, 28], height: 5, radius: 8, noise: 0, scale: 1 }]
    }), addLayer(design, "A", rect(10, 40, 20, 45), { type: "flat", amount: 1 }), addLayer(design, "B", rect(40, 16, 44, 24), { type: "flat", amount: 1 }));
    design.sections.push(fixtureSection(design, { id: "Q", label: "Q", points: [[-28, 30], [-16, 29]] }));
    const project = new Project(design), editor = new Editor(testTerrainClient());
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width: 1000, height: 700 });
    map.fit(project.terrain, false);
    map.scale = 4;
    Object.assign(editor, { project: testProjectModel(project), map });
    editor.layers.geoNodes = true;
    const selection = { kind: "geoNode" as const, id: "M" };
    const plain = { ctrlKey: false, shiftKey: false }, shift = { ...plain, shiftKey: true }, ctrl = { ...plain, ctrlKey: true };
    const guide = (from: Point, to: Point) => ({ kind: "align", from, to });
    const vertex = controlSnap(editor, selection, { role: "vertex", path: -1, index: 1, point: nodes[1] })!;
    assert.deepEqual(vertex([30, 5.2], plain), { point: [30, 6], snapped: true, guides: [guide(nodes[0], [30, 6])] });
    assert.deepEqual(vertex([30, 16.2], plain), { point: [30, 16.2] });
    assert.deepEqual(vertex([10, 41], plain), { point: [10, 40], snapped: true, guides: [{ kind: "point", point: [10, 40] }] });
    assert.deepEqual(vertex([14, 41], plain), { point: [14, 40], snapped: true });
    assert.deepEqual(vertex([10, 41], shift), { point: [10.5, 40.5] });
    assert.deepEqual(vertex([14, 41], shift), { point: [12.5, 42.5] });
    assert.deepEqual(vertex([10, 41], ctrl), { point: [10, 41] });
    assert.deepEqual(vertex([10, 41], { ...ctrl, shiftKey: true }), { point: [10, 41] });

    const handle = controlSnap(editor, selection, { role: "out", path: -1, index: 1, point: [-11, 16] })!;
    assert.deepEqual(handle([30, 16.2], plain), { point: [30, 16], snapped: true, guides: [guide(nodes[1], [30, 16])] });
    assert.deepEqual(handle([30, 5.2], plain), { point: [30, 5.2] });
    const segment = controlSnap(editor, selection, { role: "segment", path: -1, index: 1, point: [-6, 19.5] })!;
    assert.deepEqual(segment([-1, 10.25], plain), { point: [-1, 9.5], snapped: true, guides: [guide(nodes[0], [-9, 6])] });
    assert.deepEqual(segment([-1, 26], plain), { point: [-1, 26.5], snapped: true, guides: [guide(nodes[3], [7, 30])] });
    const peak = controlSnap(editor, selection, { role: "parameter", path: 1, index: 1, point: [0, 28] })!;
    const section = sectionSnap(editor, { kind: "section", id: "Q", role: "vertex", index: 0, point: [-28, 30] })!;
    for (const snap of [peak, section]) assert.deepEqual(snap([30, 16.2], plain), { point: [30, 16.2] });

    editor.setTool("pen");
    const first: Point = [-26, 6], middle: Point = [-20, 18], last: Point = [-6, 13];
    editor.geoDraft!.nodes.push(...[first, middle, last].map(p => ({ id: "", p, mode: "corner" as const })));
    const move = (point: Point) => draftPointer(editor, "move", point, { ...plain, altKey: false });
    move([30, 6.3]);
    assert.deepEqual(editor.snapGuides, [guide(first, [30, 6])]);
    move([30, 13.3]);
    assert.deepEqual(editor.snapGuides, [guide(last, [30, 13])]);
    move([30, 18.3]);
    assert.equal(editor.snapGuides, undefined);
    editor.setTool("rect");
    move([30, 16.2]);
    assert.equal(editor.snapGuides, undefined);
});

test("Map issue hits keep the view and inspector issues only pan from outside it", async () => {
    const baseline = new Project(syntheticDesign());
    const session = await import("../src/app/state/session.svelte.ts");
    const { default: GeoProperties } = await import("../src/app/components/GeoProperties.svelte");
    const selected = baseline.issues.find(i => i.severity === "warning" && i.geoNode)!;
    const error = { kind: "test", severity: "error" as const, message: "测试错误", point: selected.point };
    baseline.issues.push(error);
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), {
        width: 1000, height: 700, cameraChanged() {}
    });
    map.fit(baseline.terrain, false);
    const ui = new session.Editor();
    Object.assign(ui, { project: testProjectModel(baseline), map, tab: "terrain" });
    ui.setSelection({ kind: "geoNode", id: selected.geoNode! });
    map.scale *= 1.4;
    map.center = [selected.point[0] + (map.width / 2 + 6) / map.scale, selected.point[1] + 4];
    const scale = map.scale, center = [...map.center];
    const [x, y] = map.screen(selected.point);
    assert(x < 0 && x > -12);
    const hits = map.issueHits(ui.mapView!, [x + 11.9, y]);
    assert(hits.includes(selected) && hits.includes(error));
    assert(!map.issueHits(ui.mapView!, [x + 12.1, y]).includes(selected));
    ui.pickMarkers(hits);
    assert.deepEqual(map.center, center);
    assert.equal(map.scale, scale);
    assert.deepEqual(ui.mapView!.selectedIssues, hits);
    assert.equal(ui.tab, "issues");
    ui.issueAt(selected);
    assert.deepEqual(map.center, selected.point);
    assert.equal(map.scale, scale);
    map.center = [selected.point[0] + 4, selected.point[1]];
    const visibleCenter = [...map.center];
    ui.issueAt(error);
    assert.deepEqual(map.center, visibleCenter);
    assert.equal(map.scale, scale);
    ui.issueAt(selected);
    ui.changePropertyTab("issues");
    const { body: markup } = render(GeoProperties, { props: { editor: ui } });
    assert.match(markup, /data-property-tab="issues"[^>]*aria-pressed="true"/);
    assert.doesNotMatch(markup, /构造方式/);
    assert(markup.match(/<button[^>]*>/g)!.some(tag => tag.includes("aria-pressed=\"true\"") && tag.includes("data-issue=\"" + baseline.issues.indexOf(selected) + "\"")));
    ui.changePropertyTab("region");
    const { body: route } = render(GeoProperties, { props: { editor: ui } });
    assert.doesNotMatch(route, /构造方式/);
    assert.match(route, /轮廓 1/);
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

test("A shared strip quotes a side label and a full property path independently", () => {
    const d = syntheticDesign(), west = { ...d.geoNodes[1], label: "西台" },
        east = { ...addLayer(d, "B", rect(-7, -14, 5, -2), { type: "flat", amount: 3 }), label: "东台" };
    const strip = { ...addLayer(d, "S", { type: "strip", of: [west.id, east.id], widths: [2, 3] }, { type: "split" }), label: "条带" };
    d.geoNodes.push(east, strip);
    d.geoNodes[1] = west;
    const message = "无效", path = ["construction", "widths", 0];
    assert.equal(geoParameterName(d, strip, path, false), "“西台”一侧");
    assert.equal(designProblemText({ location: { kind: "geo", id: strip.id, path }, message }, d), "“条带.西台一侧” 无效");
});

test("A committed prompt, undo and redo preserve all terrain references", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(testTerrainClient()), design = syntheticDesign(), project = new Project(design);
    Object.assign(editor, { project: testProjectModel(project), map: { draw() {} } });
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
    assert.equal(editor.project.design.geoNodes[0].prompt, "第一行\n第二行");
    editor.navigate(false);
    assert(!Object.hasOwn(editor.project.design.geoNodes[0], "prompt"));
    editor.navigate(true);
    assert.equal(editor.project.design.geoNodes[0].prompt, "第一行\n第二行");
    editor.describe(target, "");
    assert(!Object.hasOwn(editor.project.design.geoNodes[0], "prompt"));
    editor.navigate(false);
    editor.describe(target, "覆盖分支");
    assert.equal(editor.canRedo, false);
    assert.deepEqual(generation.map(spy => spy.mock.callCount()), [0, 0]);
    assert(!Object.hasOwn(design.geoNodes[0], "prompt"));
    assert.equal(editor.project.terrain, project.terrain);
    assert.equal(project.terrain.fields.height.values, heights);
    assert.equal(project.terrain.fields, fields);
    assert.equal(project.terrain.regions, regions);
});

test("Terrain edits and history commit when the worker replies", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const design = syntheticDesign(), queued: (() => void)[] = [], labels: (string | null)[] = [];
    const client = testTerrainClient(cb => {
        queued.push(cb);
    }, reply => {
        if (reply.kind === "started") labels.push(editor.busyText);
    });
    const editor = new Editor(client);
    Object.assign(editor, { map: { scale: 4 } });
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    const opening = editor.replace(design, true);
    assert(editor.busy);
    queued.shift()!();
    await opening;
    editor.history = new History(design);
    assert.deepEqual(labels, ["正在生成地形…"]);

    async function finish(work: Promise<void> | void, label: string | null, index: number) {
        assert(editor.busy);
        assert.equal(editor.history.index, index);
        assert.equal(editor.edit(() => {
            throw Error("busy edit accepted");
        }), undefined);
        assert.equal(queued.length, 1);
        queued.shift()!();
        await work;
        assert.equal(labels.at(-1), label);
        assert.equal(editor.busy, false);
        assert.equal(editor.busyText, null);
    }
    const region = editor.project.terrain.regions.get("G");
    const rename = editor.edit(d => {
        d.geoNodes[0].label = "A";
    });
    editor.select({ kind: "geoNode", id: "T" });
    await finish(rename, null, 0);
    assert.equal(editor.history.index, 1);
    assert.equal(editor.project.terrain.regions.get("G"), region);
    assert.equal(editor.selection?.id, "T");
    await finish(editor.navigate(false), null, 1);
    assert.equal(editor.history.index, 0);
    await finish(editor.navigate(true), null, 0);
    assert.equal(editor.history.index, 1);
    await finish(editor.edit(d => {
        d.inputs.A.value = Number(d.inputs.A.value) + 1;
    }), "正在更新地件…", 1);
    await finish(editor.navigate(false), "正在更新地件…", 2);
    assert.equal(editor.history.index, 1);
    await finish(editor.edit(d => {
        d.inputs.seed.value = Number(d.inputs.seed.value) + 1;
    }), "正在更新地件…", 1);
    assert.equal(editor.history.index, 2);
    assert.equal(editor.canRedo, false);
});

test("Opening, creating and recovering a design each starts with empty terrain caches", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(testTerrainClient()), design = syntheticDesign(), text = JSON.stringify(design);
    Object.assign(editor, { map: { scale: 4 } });
    Object.assign(editor.files, { supported: true });
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor, "message", () => {});
    t.mock.method(editor.files, "remember", () => {});
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
    await editor.replace(design, true);
    const surfaces = [editor.project.terrain];
    await editor.files.open(file);
    surfaces.push(editor.project.terrain);
    await editor.files.choose("new");
    surfaces.push(editor.project.terrain);
    const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    t.after(() => {
        if (storage) Object.defineProperty(globalThis, "localStorage", storage);
        else Reflect.deleteProperty(globalThis, "localStorage");
    });
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: () => JSON.stringify({ filename: file.name, text, date: "" }) }
    });
    await editor.files.start();
    surfaces.push(editor.project.terrain);
    for (const field of ["fields", "regions"] as const)
        assert.equal(new Set(surfaces.map(s => s[field])).size, 4, field);
    assert.equal(new Set(surfaces.map(s => s.fields.height.defined)).size, 4);
    assert.equal(editor.filename, file.name);
    assert.equal(editor.dirty, true);
});

test("Attached menus open within the inspector and keep the control's edges", async () => {
    const { popupBounds } = await import("../src/app/state/popup.ts");
    const box = { left: 37, width: 184, top: 390, bottom: 418 };
    assert.deepEqual(popupBounds(box, 180, 430, 160), { left: 37, top: 228, width: 184, height: 160, upwards: true });
    assert.deepEqual(popupBounds(box, 375, 780, 160), { left: 37, top: 420, width: 184, height: 160, upwards: false });
    assert.equal(popupBounds(box, 360, 429, 200).height, 12);
    assert.equal(popupBounds(box, 360, 429, 200).top - 360, 16);
    const down = popupBounds(box, 375, 470, 200);
    assert.equal(470 - down.top - down.height, 16);
    assert.equal(popupBounds(box, 360, 429, 200, 0).top - 360, 16);
});

test("Drawing or canceling a parameter keeps its owner and activates only the completed line", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const { draftPointer } = await import("../src/app/state/geoTools.ts");
    const { geoControls } = await import("../src/core/edit/geoControls.ts");
    const editor = new Editor(testTerrainClient()), design = syntheticDesign(), n = design.geoNodes[1];
    n.function = { type: "mountain", valleys: [], ridges: [], peaks: [] };
    Object.assign(editor, { map: Object.assign(Object.create(ProjectMap.prototype), { width: 800, height: 450, center: [0, 0], scale: 4 }) });
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(design); editor.history = new History(design);
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
    const owner = editor.project.resolved.geoNodes[1], target = holderTarget(owner, editor.selectedHolder!);
    assert.deepEqual(target, { kind: "curve", index: -1 });
    const handles = geoControls(owner, target);
    assert.equal(handles.filter(c => c.role === "vertex").length, 3);
    assert(handles.some(c => c.role === "in" || c.role === "out"));
    assert(handles.every(c => c.path === -1));
    editor.setTool("peak", n.id);
    draftPointer(editor, "down", [4, 4], { ctrlKey: true } as PointerEvent);
    assert.deepEqual(editor.selection, selected); assert.equal(editor.history.index, 1);
    draftPointer(editor, "up", [4, 4], { ctrlKey: true } as PointerEvent);
    await editor.finishWork();
    assert.equal(editor.geoDraft, undefined);
    assert.equal(editor.history.index, 2);
    assert.deepEqual(editor.selection, selected);
    assert.deepEqual(editor.selectedHolder, holderLayer("peaks"));
});

test("Isolating a section exposes only its own map handles", () => {
    const d = syntheticDesign();
    d.sections = [fixtureSection(d, { id: "S", label: "S", points: [[0, 0], [0, 5]] }),
        fixtureSection(d, { id: "T", label: "T", points: [[1, 0], [1, 5]] })];
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
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { center: [0, 0], width: 800, height: 450, scale: 3, referenceScale: 3,
        cameraChanged() {} });
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
    const make = (outlines: ReturnType<typeof polygon>[]) => makeShape({ field: "height", id: "A", label: "A", construction: { type: "outline", outlines }, function: { type: "ground", value: 0 } }, new Map(), .125);
    const outer = resolvedRect(-8, -6, 8, 6).outlines[0], hole = resolvedRect(-2, -2, 2, 2).outlines[0];
    const holed = make([outer, hole]), point = geoLabelPoint(rasterRegion(grid, holed), grid)!;
    assert(holed.contains(point));
    assert.equal(Math.hypot(...point), Math.hypot(2.5, .5));
    const crossing = make([resolvedRect(-9, -3, 0, 3).outlines[0], resolvedRect(-3, -1, 4, 1).outlines[0]]);
    const centroid = geoLabelPoint(rasterRegion(grid, crossing), grid)!;
    assert(distance(centroid, [-109 / 28, 0]) < 1e-9);
    const shape = makeShape({ field: "height", id: "B", label: "B", function: { type: "blend" },
        construction: { type: "strip", of: ["A"], widths: [1, 2], range: { from: "0", to: "2" } } }, new Map([["A", make([outer])]]), .125);
    assert.deepEqual(geoLabelPoint(rasterRegion(grid, shape), grid), [6, -6]);
});

test("Dragged map names follow the continuous boundary with eight pixels of clearance", () => {
    const project = new Project(syntheticDesign()), region = project.terrain.regions.get("T")!;
    assert.deepEqual(constrainGeoLabel(region, [-18, -5], 10), [-18, -5]);
    assert.deepEqual(constrainGeoLabel(region, [-18, -1.6], 10), [-18, -1.6]);
    assert.deepEqual(constrainGeoLabel(region, [-18, 2], 10), [-18, -1.2]);
    assert.deepEqual(constrainGeoLabel(region, [-18, 2], 20), [-18, -1.6]);
    const corner = constrainGeoLabel(region, [100, 100], 10)!;
    assert(Math.abs(distance(corner, [-7, -2]) - .8) < 1e-12);
    assert(distance(corner, [100, 100]) < distance([-7, -2], [100, 100]));
    let previous = constrainGeoLabel(region, [-20, 2], 10)!;
    for (let i = 1; i <= 260; i++) {
        const point = constrainGeoLabel(region, [-20 + i * .05, 2], 10)!;
        assert(distance(previous, point) <= .1);
        previous = point;
    }
    assert.deepEqual(constrainSectionLabel([[0, 0], [10, 0]], [3, 4]), [3, 0]);
    assert.deepEqual(constrainSectionLabel([[0, 0], [10, 0]], [12, -3]), [10, 0]);
    assert.deepEqual(constrainSectionLabel([[0, 0], [10, 0]], [3, 4], 8), [3, 1]);
});

test("The inspector keeps compatible tabs and chooses the first available tab", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(testTerrainClient()), d = overlappingLandforms();
    d.sections.push(fixtureSection(d, { id: "D", label: "D", points: [[0, 0], [0, 5]] }));
    editor.project = testProjectModel(new Project(d));
    editor.setSelection({ kind: "geoNode", id: "A" });
    assert.equal(editor.propertyTab, "label");
    editor.changePropertyTab("function");
    editor.setSelection({ kind: "geoNode", id: "B" });
    assert.equal(editor.propertyTab, "function");
    editor.changePropertyTab("issues");
    editor.setSelection({ kind: "geoNode", id: "G" });
    assert.equal(editor.propertyTab, "issues");
    editor.setSelection({ kind: "section", id: "D" });
    assert.equal(editor.propertyTab, "label");
    for (const selection of [{ kind: "input", id: "A" }, { kind: "field", id: "height" }, null] as const) {
        editor.setSelection(selection);
        assert.equal(editor.propertyTab, "general");
        assert.equal(propertyTabs(selection).length, 1);
    }
});

test("Expanding and collapsing inspector subitems leaves the authored design and undo history intact", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(testTerrainClient()), design = syntheticDesign();
    editor.project = testProjectModel(new Project(design));
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
    const d = syntheticDesign(), editor = new Editor(testTerrainClient());
    Object.assign(editor, { map: { draw() {}, clearIssue() {}, world: (x: number, y: number) => [x, y] } });
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(d, true);
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

test("Selected segments follow their starting node through edits, undo and redo", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(testTerrainClient()), d = syntheticDesign();
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(d, true);
    editor.history = new History(d);
    editor.select({ kind: "geoNode", id: "T" });
    editor.selectControl({ role: "segment", path: 0, index: 2, point: [-14, -2] });
    const selected = () => {
        const part = editor.vertex!;
        const owner = editor.project.resolved.geoNodes[1];
        return [part.role, part.index, geometryPath(owner, part.path)!.nodes[part.index].id];
    };
    assert.deepEqual(selected(), ["segment", 2, "2"]);
    await editor.edit(doc => {
        insertCurveNode(doc, doc.geoNodes[1], { role: "segment", path: 0, index: 0, point: [-14, -14] });
    });
    assert.deepEqual(selected(), ["segment", 3, "2"]);
    await editor.removeCurvePart(editor.selection!, { role: "vertex", path: 0, index: 0, point: [-21, -14] });
    assert.deepEqual(selected(), ["segment", 2, "2"]);
    await editor.navigate(false);
    assert.deepEqual(selected(), ["segment", 3, "2"]);
    await editor.navigate(false);
    assert.deepEqual(selected(), ["segment", 2, "2"]);
    await editor.navigate(true);
    assert.deepEqual(selected(), ["segment", 3, "2"]);
    await editor.navigate(true);
    assert.deepEqual(selected(), ["segment", 2, "2"]);
    await editor.removeSelected();
    assert.deepEqual(selected(), ["vertex", 2, "2"]);
    await editor.navigate(false);
    assert.deepEqual(selected(), ["segment", 2, "2"]);
    await editor.navigate(true);
    assert.deepEqual(selected(), ["vertex", 2, "2"]);
});

function islandDesign() {
    const d = syntheticDesign(), n = d.geoNodes[1], c = rect(-30, -30, 10, 10);
    for (const [prefix, shape] of [["hole", rect(-22, -22, 4, 4)], ["island", rect(-15, -15, -2, -2)]] as const) {
        const outline = shape.outlines[0];
        for (const node of outline.curve.nodes) node.id = prefix + node.id;
        c.outlines.push(outline);
    }
    n.construction = fixtureConstruction(d, c);
    n.function = fixtureFunction(d, { type: "slope", kind: "path", lines: [{ curve: openCurve([{ p: [-15, -27], h: 2 }, { p: [5, -27], h: 7 }]) }], center: [0, 0], radius: 5, value: 2, rate: -.2 });
    return d;
}

test("Nested outline hits choose the smallest face and cycle to the next object root", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d = islandDesign(), editor = new Editor(testTerrainClient()), map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), {
        width: 1000, height: 700, markBoxes: []
    });
    editor.project = testProjectModel(new Project(d));
    map.fit(editor.project.terrain, false);
    const p: Point = [-10, -10], screen = map.screen(p), shape = editor.project.terrain.regions.get("T")!.shape;
    assert(shape.contains(p));
    assert.deepEqual(shape.containingOutlines!(p), [2, 1, 0]);
    assert(!shape.contains([-20, -20]));
    assert.deepEqual(shape.containingOutlines!([-20, -20]), [1, 0]);
    const hits = () => map.objectHits(editor.mapView!, screen);
    assert.deepEqual(hits().next().value?.path[1], holderLayer("outlines", 2));
    editor.select({ kind: "geoNode", id: "T" });
    assert.deepEqual(nextMapHit(hits(), editor.selectionPath)?.path[1], holderLayer("outlines", 2));
    editor.focusGeometry({ kind: "outline", index: 1 });
    assert.deepEqual(nextMapHit(hits(), editor.selectionPath)?.path[1], holderLayer("outlines", 1));
    assert.deepEqual(nextMapHit(hits(), editor.selectionPath, true)?.path, [{ kind: "geoNode", id: "G" }]);

    const crossed = resolvedRect(-10, -10, 10, 10), bow = polygon([[-14, -14], [14, 14], [-14, 14], [14, -14]]);
    const small = resolvedRect(-4, -6, 4, 6).outlines[0];
    crossed.outlines.push(bow, small);
    const overlapping = makeShape({ id: "X", label: "X", field: "height", construction: crossed,
        function: { type: "ground", value: 1 } }, new Map(), .1);
    assert.deepEqual(overlapping.containingOutlines!([0, 5]), [2, 1, 0]);
});

test("Dragging nested outlines moves only their own geometry and preserves selection through history", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const design = islandDesign(), editor = new Editor(testTerrainClient());
    const ridges = [
        [[-14, -12], [-5, -8]], [[-26, -12], [-5, -12]], [[-28, -27], [8, -27]], [[-28, -25], [14, -25]]
    ] as [number, number][][];
    design.geoNodes[1].function = fixtureFunction(design, {
        type: "mountain", valleys: [],
        ridges: ridges.map((points, i) => ({ curve: withNodeSlope(openCurve(points.map((p, j) => ({ p, h: 5 + j })), "corner", i + "-ridge-"), 1) })),
        peaks: [{ at: [-8, -7], height: 12, radius: 8, noise: 0, scale: 1 },
            { at: [0, -28], height: 9, radius: 6, noise: 0, scale: 1 }]
    });
    const d = parseDesign(design, true);
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(d, true);
    editor.history = new History(d);
    const original = structuredClone(d.geoNodes[1]);
    const placed = editor.project.resolved.geoNodes[1];
    editor.select({ kind: "geoNode", id: "T" });
    const outer = { role: "outline" as const, path: 0, index: 0, point: [-10, -28] as [number, number] };
    editor.focusGeometry({ kind: "outline", index: outer.path });
    await editor.edit(d => {
        commitControl(d, { kind: "geoNode", id: "T" }, outer, [-7, -28], false);
    });
    const movedOuter = editor.project.resolved.geoNodes[1];
    assert.deepEqual(movedOuter.function, placed.function);
    for (const i of [1, 2]) assert.deepEqual(geometryPath(movedOuter, i), geometryPath(placed, i));
    assert.deepEqual(geometryPath(movedOuter, 0)?.nodes.map(node => node.p), geometryPath(placed, 0)?.nodes.map(({ p: [x, y] }) => [x + 3, y]));
    await editor.navigate(false);
    assert.deepEqual(editor.project.design.geoNodes[1], original);

    const control = { role: "outline" as const, path: 2, index: 0, point: [-10, -10] as [number, number] };
    editor.focusGeometry({ kind: "outline", index: control.path });
    assert.equal(editor.selectedHolder?.index, 2);
    assert.equal(editor.vertex, undefined);
    await editor.edit(d => {
        commitControl(d, { kind: "geoNode", id: "T" }, control, [-8, -13], false);
    });
    const moved = editor.project.resolved.geoNodes[1];
    assert.deepEqual(moved.function, placed.function);
    for (const i of [0, 1]) assert.deepEqual(geometryPath(moved, i), geometryPath(placed, i));
    assert.deepEqual(geometryPath(moved, 2)?.nodes.map(node => node.p),
        geometryPath(placed, 2)?.nodes.map(({ p: [x, y] }) => [x + 2, y - 3]));
    editor.removeOutline("T", 1);
    editor.removal?.perform?.();
    await editor.finishWork();
    editor.removal = null;
    assert.equal(editor.selectedHolder?.index, 1);
    assert.equal(geometryPath(editor.project.resolved.geoNodes[1], 1)?.nodes[0].id, "island0");
    await editor.navigate(false);
    assert.equal(editor.selectedHolder?.index, 2);
    await editor.navigate(false);
    assert.equal(editor.selectedHolder?.index, 2);
    assert.deepEqual(editor.project.design.geoNodes[1], original);
    await editor.navigate(true);
    assert.equal(editor.selectedHolder?.index, 2);
    await editor.navigate(true);
    assert.equal(editor.selectedHolder?.index, 1);
    const removal = () => editor.removal;
    editor.removeSelected();
    assert.equal(removal()?.action, "删除轮廓");
    removal()?.perform?.();
    await editor.finishWork();
    editor.removal = null;
    assert.equal(editor.selectedHolder?.index, undefined);
    await editor.navigate(false);
    assert.equal(editor.selectedHolder?.index, 1);
    await editor.navigate(true);
    assert.equal(editor.selectedHolder?.index, undefined);
    editor.focusGeometry({ kind: "outline", index: 0 });
    editor.removeSelected();
    assert.equal(editor.removal, null);
    assert.equal(editor.selectedHolder?.index, 0);
});


test("Map drags follow the current layer, preserving offsets and shared coordinates", async () => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d = islandDesign(), owner = d.geoNodes[1];
    assert(owner.construction.type === "outline");
    owner.function = fixtureFunction(d, { type: "mountain", ridges: [], valleys: [],
        peaks: [{ at: [5, -7], height: 4, radius: 8, noise: 0, scale: 1 }] });
    const offset: Point = [2, 3], outline = owner.construction.outlines[2];
    assert("curve" in outline);
    outline.offset = offset;
    const shared = d.geometry[outline.curve];
    assert("curve" in shared);
    const other = addLayer(d, "A", rect(-14, 15, -1, 28), { type: "flat", amount: 1 });
    assert(other.construction.type === "outline");
    other.construction.outlines[0] = { curve: outline.curve, offset: [0, 30] };
    d.geoNodes.push(other);
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width: 1000, height: 700, markBoxes: [] });
    const editor = new Editor(testTerrainClient());
    Object.assign(editor, { project: testProjectModel(new Project(d)), map });
    map.fit(editor.project.terrain, false);
    const root = { kind: "geoNode", id: "T" } as const;
    const holder = holderLayer("outlines", 2);
    const branch: SelectionPath = [root, holder, { kind: "geometry", id: outline.curve }];
    const p: Point = [-8, -7], delta: Point = [3, 2];
    const drag = (point: Point, selection: SelectionPath | null) => {
        editor.selectPath(selection);
        const view = editor.mapView!, screen = map.screen(point);
        const hit = dragMapHit(map.objectHits(view, screen), editor.selectionPath)!;
        const { selection: moving, control } = mapControlDrag(hit, view, point)!;
        const target: Point = [control.point[0] + delta[0], control.point[1] + delta[1]];
        const preview = controlPreview(d, editor.project.resolved, editor.curves, moving, control, false)!(target);
        const next = structuredClone(d);
        commitControl(next, moving, control, target, false);
        assert.equal(hit.path.length, selection?.length ?? 1);
        return { next, preview };
    };
    assert.deepEqual(dragMapHit(map.objectHits(editor.mapView!, map.screen(p)), null)?.path, [root]);
    const whole = drag(p, [root]);
    const wholeLand = whole.next.geoNodes[1];
    assert(wholeLand.construction.type === "outline" && wholeLand.function.type === "mountain");
    assert.deepEqual(wholeLand.construction.outlines.map(holder => "offset" in holder && holder.offset), [delta, delta, [5, 5]]);
    assert.deepEqual(wholeLand.function.peaks[0].at.offset, delta);
    assert.deepEqual(whole.next.geometry, d.geometry);
    assert.deepEqual(whole.next.geoNodes[2], d.geoNodes[2]);

    const placed = drag(p, [root, holder]).next;
    assert.deepEqual(placed.geometry, d.geometry);
    const placement = placed.geoNodes[1].construction;
    assert(placement.type === "outline");
    assert.deepEqual(placement.outlines[2], { curve: outline.curve, offset: [5, 5] });
    assert.deepEqual(placement.outlines.slice(0, 2), owner.construction.outlines.slice(0, 2));
    assert.deepEqual(placed.geoNodes[1].function, owner.function);
    assert.deepEqual(placed.geoNodes[2], d.geoNodes[2]);

    const shape = drag(p, branch);
    assert.deepEqual(shape.next.geoNodes, d.geoNodes);
    const movedShape = shape.next.geometry[outline.curve];
    assert("curve" in movedShape);
    assert.deepEqual(shape.preview.geometry, movedShape);
    assert.deepEqual(movedShape.curve.nodes.map(node => node.p),
        shared.curve.nodes.map(node => [node.p[0] + delta[0], node.p[1] + delta[1]]));
    assert(shape.preview.nodes.has("A"));

    const first = shared.curve.nodes[0];
    const nodePoint: Point = [first.p[0] + offset[0], first.p[1] + offset[1]];
    const vertex = drag(nodePoint, [...branch, { kind: "vertex", nodeId: first.id }]).next;
    assert.deepEqual(vertex.geoNodes, d.geoNodes);
    const movedVertex = vertex.geometry[outline.curve];
    assert("curve" in movedVertex);
    assert.deepEqual(movedVertex.curve.nodes.map(node => node.p),
        [[first.p[0] + delta[0], first.p[1] + delta[1]], ...shared.curve.nodes.slice(1).map(node => node.p)]);
});

test("Escape and history preserve hierarchy, truncating a missing holder and blocking deletion of a shared geometry", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d = overlappingLandforms(), editor = new Editor(testTerrainClient());
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(d, true);
    editor.history = new History(d);
    const root = { kind: "geoNode", id: "A" } as const;
    const n = d.geoNodes.find(n => n.id === root.id)!;
    assert(n.function.type === "mountain" && "curve" in n.function.ridges[1]);
    const id = n.function.ridges[1].curve, holder = holderLayer("ridges", 1);
    const curve = d.geometry[id];
    assert("curve" in curve);
    const path: SelectionPath = [root, holder, { kind: "geometry", id }, { kind: "vertex", nodeId: curve.curve.nodes[0].id }];
    const open = () => editor.selectionPath;
    editor.selectPath(path);
    for (let depth = 3; depth >= 1; depth--) {
        editor.stepSelectionOut();
        assert.deepEqual(open(), path.slice(0, depth));
    }
    editor.stepSelectionOut();
    assert.equal(open(), null);
    editor.selectPath(path);
    editor.stepSelectionOut();
    editor.removeSelected();
    assert.match(editor.removal?.detail ?? "", /仍在使用/);
    assert.deepEqual(open(), path.slice(0, 3));
    assert.equal(editor.history.index, 0);
    editor.removal = null;

    editor.selectPath(path);
    await editor.edit(doc => {
        doc.geoNodes.find(n => n.id === root.id)!.label = "山岭";
    });
    editor.select(null);
    await editor.navigate(false);
    assert.deepEqual(open(), path);
    await editor.navigate(true);
    assert.deepEqual(open(), path);
    editor.stepSelectionOut();
    editor.stepSelectionOut();
    await editor.removeSelected();
    assert.deepEqual(open(), [root]);
    await editor.navigate(false);
    assert.deepEqual(open(), [root, holder]);
    await editor.navigate(true);
    assert.deepEqual(open(), [root]);
    await editor.replace(editor.project.design, false, path);
    assert.deepEqual(open(), [root]);
    editor.dispose();
});

test("Delete removes the current root while required references stay with their owner", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d = syntheticDesign(), editor = new Editor(testTerrainClient());
    d.sections.push(fixtureSection(d, { id: "A", label: "A", points: [[0, 4], [1, 10]] }));
    d.marks.push(fixtureMark(d, { id: "B", label: "B", kind: "text", follow: "map", point: [5, 5] }));
    d.geometry.C = { label: "C", independent: true, point: [12, 12] };
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(d, true);
    editor.history = new History(d);
    const section = { kind: "section", id: "A" } as const;
    editor.selectPath([section, holderLayer("endpoints")]);
    await editor.removeSelected();
    assert.equal(editor.project.design.sections.length, 1);
    assert.match(editor.removal?.detail ?? "", /保留/);
    editor.removal = null;

    for (const [selection, exists] of [
        [{ kind: "geoNode", id: "T" }, (design: Design) => design.geoNodes.some(n => n.id === "T")],
        [section, (design: Design) => design.sections.some(s => s.id === "A")],
        [{ kind: "mark", id: "B" }, (design: Design) => design.marks.some(m => m.id === "B")],
        [{ kind: "geometry", id: "C" }, (design: Design) => Object.hasOwn(design.geometry, "C")]
    ] as const) {
        editor.select(selection);
        await editor.removeSelected();
        assert(!exists(editor.project.design));
        assert.equal(editor.selectionPath, null);
        await editor.navigate(false);
        assert(exists(editor.project.design));
        assert.deepEqual(editor.selectionPath, [selection]);
    }
    editor.dispose();
});

test("Curve picking covers faces from smallest to largest and accepts open lines within eight pixels", () => {
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { scale: 4 });
    const small = resolvedRect(-3, -3, 3, 3).outlines[0], large = resolvedRect(-12, -12, 12, 12).outlines[0];
    const line = openCurve([{ p: [-9, 20] }, { p: [9, 20] }]);
    const choices = [{ key: "large", placements: [large] }, { key: "small", placements: [small] }, { key: "line", placements: [line] }];
    assert.equal(map.pickCurve(choices, [0, 0], .1), "small");
    assert.equal(map.pickCurve(choices, [3, 0], .1), "small");
    assert.equal(map.pickCurve(choices, [8, 8], .1), "large");
    assert.equal(map.pickCurve(choices, [0, 21.99], .1), "line");
    assert.equal(map.pickCurve(choices, [0, 22.01], .1), undefined);
});

test("Coordinate slots use design grid and sample bounds while longer readings stay intact", () => {
    const range = readingRange({ values: Float32Array.of(-2345, 123, 800000), defined: Uint8Array.of(1, 1, 0) });
    assert.deepEqual(range, [-2345, 123]);
    const field = { label: "高度", unit: "m", precision: .1 };
    const grid = createGrid({ xMin: -500, yMin: -15, xMax: 305, yMax: 130, step: 1 });
    const readings = positionReadings({ point: [9, 29], sample: 3 }, field, grid, range);
    assert.deepEqual(readings, [
        { label: "X", min: "-500.0 m", max: "305.0 m", value: "9.0 m" },
        { label: "Y", min: "-15.0 m", max: "130.0 m", value: "29.0 m" },
        { label: "高度", min: "-2345.0 m", max: "123.0 m", value: "3.0 m" }
    ]);
    const outside = positionReadings({ point: [12345.6, -54321.5] }, field, grid, range);
    const slots = (values: typeof readings) => values.map(({ min, max }) => [min, max]);
    assert.deepEqual(slots(outside), slots(readings));
    assert.deepEqual(outside.map(({ value }) => value), ["12345.6 m", "-54321.5 m", "–"]);
    for (const reading of outside.slice(0, 2))
        assert(reading.value.length > Math.max(reading.min.length, reading.max.length));
    const expanded = positionReadings(undefined, field, { ...grid, xMax: 1500, yMax: 300 }, range);
    assert.deepEqual(slots(expanded), [["-500.0 m", "1500.0 m"], ["-15.0 m", "300.0 m"], slots(readings)[2]]);
});

test("Removing a segment asks before leaving a strip reference to its removed endpoint", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(testTerrainClient()), d = syntheticDesign();
    d.geoNodes.push(addLayer(d, "S", { type: "strip", of: ["T"], widths: [1, 1], range: { from: "0", to: "1" } }, { type: "flat", amount: 1 }));
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(d, true);
    editor.history = new History(d);
    editor.select({ kind: "geoNode", id: "T" });
    editor.selectControl({ role: "segment", path: 0, index: 0, point: [-14, -14] });
    editor.removeSelected();
    assert.equal(editor.removal?.title, "删除线段？");
    assert.equal(editor.removal?.items?.length, 1);
    assert.equal(editor.canUndo, false);
    editor.removal?.perform?.();
    await editor.finishWork();
    const path = geometryPath(editor.project.resolved.geoNodes[1], 0)!;
    assert.deepEqual(path.nodes.map(n => n.id), ["0", "2", "3"]);
    assert.equal(editor.vertex?.role, "vertex");
    assert.equal(editor.project.issues.find(issue => issue.geoNode === "S")?.kind, "geo-reference");
});

test("Screen marks retain their anchors and clamp their full drawing to each viewport", () => {
    const bounds = [-5, -12, 127, 7] as [number, number, number, number];
    assert.deepEqual(clampMarkPoint([94, 399], bounds, 550, 420), [94, 399]);
    assert.deepEqual(clampMarkPoint([94, 399], bounds, 180, 140), [53, 133]);
    assert.deepEqual(clampMarkPoint([-5, -30], bounds, 180, 140), [5, 12]);
    assert.deepEqual(clampMarkPoint([94, 399], [-35, -10, 35, 10], 550, 220), [94, 210]);
});

test("Mark follow changes preserve the displayed anchor and screen coordinates ignore camera changes", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const d = syntheticDesign(), editor = new Editor(testTerrainClient());
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { center: [0, 0], width: 800, height: 450, scale: 3, referenceScale: 3,
        cameraChanged() {}, clearIssue() {}, ctx: { save() {}, restore() {}, measureText: () => ({ width: 38 }) } });
    Object.assign(editor, { map });
    t.mock.method(editor, "reconcileProject", () => {});
    t.mock.method(editor.files, "remember", () => {});
    await editor.replace(d, true);
    editor.history = new History(d);
    await editor.addMark("scale", [64, 80]);
    const id = editor.selection!.id, anchor = editor.project.design.marks[0].screen;
    assert.deepEqual(map.markScreen(editor.project.resolved.marks[0]), anchor);
    map.zoomAt(2);
    map.center = [16, 18]; map.width = 1900;
    assert.deepEqual(map.markScreen(editor.project.resolved.marks[0]), anchor);
    await editor.setMarkFollow(id, "map");
    const mark = editor.project.resolved.marks[0];
    assert.notDeepEqual(mark.point, anchor);
    assert(distance(map.markScreen(mark), anchor) < 1e-9);
    await editor.setMarkFollow(id, "screen");
    assert(distance(editor.project.design.marks[0].screen, anchor) < 1e-9);

    await editor.addMark("text", [1, 45]);
    const text = editor.project.resolved.marks.at(-1)!;
    const itsAnchor = map.visibleMarkPoint(text);
    await editor.setMarkFollow(text.id, "screen");
    assert.deepEqual(map.visibleMarkPoint(editor.project.resolved.marks.at(-1)!), itsAnchor);
});