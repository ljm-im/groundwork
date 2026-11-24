import { test } from "node:test";
import assert from "node:assert/strict";
import { History } from "../src/core/edit/history.ts";
import { syntheticDesign } from "./scenarios.ts";

test("History capacity, undo and redo branches", () => {
    const moved = syntheticDesign();
    const hist = new History(moved, 50);
    for (let i = 0; i < 55; i++) {
        moved.inputs.seed.value = i;
        hist.record(moved);
    }
    for (let i = 0; i < 50; i++) assert(hist.step(false));
    assert(!hist.canUndo);
    assert.equal(hist.step(true)!.inputs.seed.value, 5);
    moved.inputs.seed.value = 900;
    hist.record(moved);
    assert(!hist.canRedo);
});