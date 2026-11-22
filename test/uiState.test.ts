import { test } from "node:test";
import "../configs/register-svelte.ts";
import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { distance } from "../src/core/math/geometry.ts";
import { History } from "../src/core/edit/history.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { IslandMap } from "../src/render/map.ts";
import { render } from "svelte/server";
import { previewLevels } from "../src/app/state/levelPreview.ts";

test("Map focus, hit radius and the selected inspector issue", async () => {
    const original = await readFixture("round5.json");
    const author = parseDesign(original), baseline = new Island(author);
    const session = await import("../src/app/state/session.svelte.ts");
    const { default: Network } = await import("../src/app/components/Network.svelte");
    const selected = baseline.issues.find(i => i.kind === "ramp-grade" && i.road === "street-4")!;
    const view = Object.assign(Object.create(IslandMap.prototype) as IslandMap, {
        island: baseline, width: 1000, height: 700, zoom: 1, layers: { issues: true }, draw() { }, clearIssue() {
            view.activeIssue = null;
        }
    });
    const previousFrame: typeof requestAnimationFrame | undefined = Reflect.get(globalThis, "requestAnimationFrame");
    try {
        globalThis.requestAnimationFrame = () => 1;
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
    Object.assign(ui, { island: baseline, tab: "network", selection: { kind: "edge", id: selected.road }, issue: selected });
    const { body: markup } = render(Network, { props: { editor: ui } });
    assert(markup.indexOf("对象校验") >= 0 && markup.indexOf("对象校验") < markup.indexOf("路线长度"));
    assert(markup.match(/<button[^>]*>/g)!.some(tag => tag.includes("issue-row is-selected") && tag.includes("data-issue=\"" + baseline.issues.indexOf(selected) + "\"")));
});

test("Each extreme level preview matches a full regeneration", async () => {
    const input = await readFixture("round6.json");
    // The interactive shortcut must produce the full engine's values, including
    // stair landings, graded road beds, trees and issue locations at every level.
    const reference = new Island(parseDesign(input));
    const preview = new Island(parseDesign(input));
    for (const [key, [, min, max]] of Object.entries(reference.design.levelControls)) {
        for (const value of [max, min]) {
            reference.design.levels[key] = preview.design.levels[key] = value;
            reference.levels();
            previewLevels(preview, new Set([key]));
            assert.deepEqual(preview.routes, reference.routes);
            assert.deepEqual(preview.graded.heights, reference.graded.heights);
            assert.deepEqual(preview.trees, reference.trees);
            assert.deepEqual(preview.issues, reference.issues);
        }
    }
});

test("A committed prompt, undo and redo preserve the live island and all geometry", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const editor = new Editor(), design = parseDesign(await readFixture("round6.json")), island = new Island(design);
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