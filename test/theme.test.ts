import assert from "node:assert/strict";
import { test } from "node:test";
import { readAppearance, resolveTheme, saveAppearance } from "../src/app/state/theme.ts";
import { baseMap, interfaceColors, mapColors } from "../src/render/palette.ts";
import { maxReliefLight, reliefLight } from "../src/render/relief.ts";

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

function hexRgb(color: string) {
    assert.match(color, /^#[\da-f]{6}$/i);
    return color.slice(1).match(/../g)!.map(channel => Number.parseInt(channel, 16));
}

function luminance(rgb: readonly number[]) {
    const [r, g, b] = rgb.map(channel => {
        const s = channel / 255;
        return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    });
    return .2126 * r + .7152 * g + .0722 * b;
}

function contrast(color: string, background: readonly number[]) {
    const rgba = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(color);
    const foreground = rgba ? rgba.slice(1, 4).map(Number) : hexRgb(color);
    const alpha = rgba ? Number(rgba[4]) / 100 : 1;
    const fg = luminance(foreground.map((channel, i) => channel * alpha + background[i] * (1 - alpha)));
    const bg = luminance(background);
    return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
}

test("Relief amplifies only the light deficit of backlit slopes", () => {
    const lightGain = baseMap.light.shadowGain, darkGain = baseMap.dark.shadowGain;
    const flat = .45 + .6 * .7 / Math.sqrt(.99);
    const sunlit = .45 + .6 * 1.2 / Math.sqrt(1.5 * .99);
    const backlit = .45 + .6 * (.7 - .25) / Math.sqrt(1.125 * .99);
    assert.equal(reliefLight(0, 0, lightGain), flat);
    assert.equal(reliefLight(-.5, .5, lightGain), sunlit);
    assert.equal(reliefLight(.25, -.25, lightGain), backlit);
    assert.equal(reliefLight(0, 0, darkGain), flat);
    assert.equal(reliefLight(-.5, .5, darkGain), sunlit);
    assert.equal(reliefLight(.25, -.25, darkGain), flat - (flat - backlit) * darkGain);
    assert.equal(reliefLight(1, -1, 4), 0);
});

test("Map palettes meet contrast thresholds on the background and sunlit low terrain", () => {
    for (const theme of ["light", "dark"] as const) {
        const { accent, danger, warning, parameterGeometry, text, bgPanel } = mapColors[theme];
        const { boundary, sectionLine, rasterDim } = baseMap[theme];
        const backgrounds = {
            bgApp: hexRgb(interfaceColors[theme].bgApp),
            lowland: baseMap.elevation[0].slice(1).map(channel => Math.min(255, channel * maxReliefLight) * rasterDim)
        };
        for (const [surface, background] of Object.entries(backgrounds)) {
            for (const [part, color] of Object.entries({ boundary, accent, sectionLine, danger, warning, parameterGeometry })) {
                const ratio = contrast(color, background);
                assert(ratio >= 3, `${theme} ${part} on ${surface} has ${ratio.toFixed(3)}:1 contrast`);
            }
        }
        const textRatio = contrast(text, hexRgb(bgPanel));
        assert(textRatio >= 4.5, `${theme} map text has ${textRatio.toFixed(3)}:1 contrast against its halo`);
    }
});