import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionAxis } from "../src/render/sections.ts";

for (const [label, precision, values] of [
    ["constant 0.2", .1, [.2, .2]],
    ["constant -3.75", .25, [-3.75, -3.75]],
    ["range 0 to 0.05", .1, [0, .05]],
    ["range 0 to 48.3", .1, [0, 48.3]],
    ["one defined point", .1, [undefined, .3, undefined]]
] as const) test("Section ticks enclose " + label, () => {
    const data = values.filter(value => value !== undefined);
    const decimals = String(precision).split(".")[1].length;
    for (const height of [72, 125, 240]) {
        const { first, last, step, ticks } = sectionAxis([...values], precision, height);
        assert(first * step < Math.min(...data));
        assert(last * step > Math.max(...data));
        assert((last - first) * step >= precision * 10);
        assert(ticks.length >= 3 && ticks.length <= Math.max(2, Math.min(6, Math.floor((height - 22) / 26))) + 1);
        assert(Math.abs(step / precision - Math.round(step / precision)) < 1e-10);
        for (const [i, text] of ticks.entries()) {
            assert.match(text, new RegExp("^-?\\d+\\.\\d{" + decimals + "}$"));
            assert(Math.abs(Number(text) / step - (first + i)) < 1e-10);
        }
    }
});