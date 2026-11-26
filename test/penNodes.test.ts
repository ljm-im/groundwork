import assert from "node:assert/strict";
import { test } from "node:test";
import { penNodeGroup, readPenNodes, savePenNodes } from "../src/app/state/penNodes.ts";

test("Pen drawing tools share their own boundary or terrain preference", () => {
    for (const tool of ["pen", "addOutline"] as const) assert.equal(penNodeGroup(tool), "boundary");
    for (const tool of ["shore", "ridge", "slopeLine"] as const) assert.equal(penNodeGroup(tool), "terrain");
    assert.equal(penNodeGroup("rect"), undefined);
    assert.equal(penNodeGroup(undefined), undefined);
});

test("Pen modes persist separately and default when storage cannot be read", t => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
    });
    const defaults = { boundary: "corner", terrain: "auto" }, key = "groundwork/pen-node-v1";
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => values.set(name, value) }
    });
    assert.deepEqual(readPenNodes(), defaults);
    savePenNodes({ ...readPenNodes(), boundary: "auto" });
    assert.deepEqual(readPenNodes(), { boundary: "auto", terrain: "auto" });
    savePenNodes({ ...readPenNodes(), terrain: "corner" });
    assert.deepEqual(readPenNodes(), { boundary: "auto", terrain: "corner" });
    assert.deepEqual(JSON.parse(values.get(key)!), readPenNodes());
    values.set(key, JSON.stringify({ boundary: "auto", terrain: "manual" }));
    assert.deepEqual(readPenNodes(), { boundary: "auto", terrain: "auto" });
    values.set(key, "invalid");
    assert.deepEqual(readPenNodes(), defaults);
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => {
            throw Error("Storage unavailable");
        }
    });
    assert.deepEqual(readPenNodes(), defaults);
    assert.doesNotThrow(() => savePenNodes({ boundary: "auto", terrain: "corner" }));
});