import assert from "node:assert/strict";
import { test } from "node:test";
import { readAppearance, resolveTheme, saveAppearance } from "../src/app/state/theme.ts";

test("Appearance resolves against the system only in system mode", () => {
    assert.equal(resolveTheme("system", false), "light");
    assert.equal(resolveTheme("system", true), "dark");
    assert.equal(resolveTheme("light", true), "light");
    assert.equal(resolveTheme("dark", false), "dark");
});

test("Appearance storage accepts the three choices and falls back to the system", t => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
    });
    const key = "groundwork/appearance-v1", values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => values.set(name, value) }
    });

    assert.equal(readAppearance(), "system");
    for (const choice of ["dark", "light", "system"] as const) {
        saveAppearance(choice);
        assert.equal(values.get(key), choice);
        assert.equal(readAppearance(), choice);
    }
    values.set(key, "invalid");
    assert.equal(readAppearance(), "system");
    assert.equal(resolveTheme(readAppearance(), true), "dark");

    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => {
            throw Error("Storage unavailable");
        }
    });
    assert.equal(readAppearance(), "system");
    assert.equal(resolveTheme(readAppearance(), false), "light");
    assert.doesNotThrow(() => saveAppearance("dark"));
});