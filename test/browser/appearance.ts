import assert from "node:assert/strict";
import { serializeDesign } from "../../src/core/design/model.ts";
import { fixtureSection, addLayer, rect, syntheticDesign } from "../scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./filePickers.ts";

interface Draws {
    map: number;
    section: number;
    terrain: number;
    grid: string;
    raster: number;
}

declare global {
    interface Window {
        initialAppearance?: { theme: string; mounted: boolean };
        appearanceDraws: Draws;
    }
}

function recordInitialAppearance() {
    const observer = new MutationObserver(() => {
        const theme = document.documentElement.dataset.theme;
        if (!theme) return;
        window.initialAppearance = { theme, mounted: !!document.querySelector("#app .topbar") };
        observer.disconnect();
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme"] });
}

async function observeDraws() {
    const draws: Draws = { map: 0, section: 0, terrain: 0, grid: "", raster: 0 };
    window.appearanceDraws = draws;
    const computeModule = "/src/app/state/terrainClient.ts";
    const { TerrainClient } = await import(computeModule) as typeof import("../../src/app/state/terrainClient.ts");
    const generate = TerrainClient.prototype.generate;
    TerrainClient.prototype.generate = function (...args) {
        draws.terrain++;
        return generate.apply(this, args);
    };

    const map = document.querySelector<HTMLCanvasElement>("#map")!.getContext("2d")!;
    const fill = map.fillRect.bind(map), image = map.drawImage;
    const rasters = new Map<CanvasImageSource, number>();
    map.fillRect = (x, y, w, h) => {
        if (x === 0 && y === 0) draws.map++;
        fill(x, y, w, h);
    };
    map.drawImage = (raster, ...args: number[]) => {
        draws.raster = rasters.get(raster) ?? rasters.size + 1;
        rasters.set(raster, draws.raster);
        Reflect.apply(image, map, [raster, ...args]);
    };

    const prototype = CanvasRenderingContext2D.prototype;
    const clear = prototype.clearRect, stroke = prototype.stroke;
    prototype.clearRect = function (...rect) {
        if (this.canvas.closest("#plots")) draws.section++;
        clear.apply(this, rect);
    };
    prototype.stroke = function (...args: [] | [Path2D]) {
        if (this.canvas.closest("#plots") && Math.abs(this.lineWidth - .7) < 1e-6) draws.grid = String(this.strokeStyle);
        Reflect.apply(stroke, this, args);
    };
}

function mapPixels() {
    const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
    const context = canvas.getContext("2d")!;
    const pixel = (x: number, y: number) => "#" + [...context.getImageData(x, y, 1, 1).data].slice(0, 3)
        .map(value => value.toString(16).padStart(2, "0")).join("");
    const midX = Math.floor(canvas.width / 2), y = Math.floor(canvas.height / 2) - 11;
    return { outside: pixel(2, 2), center: pixel(midX + 9, y), left: pixel(midX - 80, y) };
}

function colorsOutsideTokens() {
    const root = getComputedStyle(document.documentElement);
    const swatch = document.body.appendChild(document.createElement("span"));
    const allowed = new Set(["rgba(0, 0, 0, 0)", "none"]);
    for (const name of root) {
        if (!name.startsWith("--")) continue;
        const color = root.getPropertyValue(name).trim();
        if (!CSS.supports("color", color)) continue;
        swatch.style.color = color;
        allowed.add(getComputedStyle(swatch).color);
    }
    swatch.remove();

    const violations = new Set<string>();
    for (const element of document.querySelectorAll("#app, #app *")) {
        const style = getComputedStyle(element);
        if (!element.getClientRects().length || style.visibility !== "visible") continue;
        const properties = ["color", "background-color"];
        for (const side of ["top", "right", "bottom", "left"])
            if (parseFloat(style.getPropertyValue("border-" + side + "-width"))) properties.push("border-" + side + "-color");
        if (element.matches("svg.icon path")) properties.push("stroke");
        for (const property of properties) {
            const value = style.getPropertyValue(property);
            if (!allowed.has(value)) violations.add(element.tagName + (element.id ? "#" + element.id : "") + " " + property + " " + value);
        }
    }
    return [...violations];
}

export async function checkAppearance(url: string) {
    const design = syntheticDesign();
    design.sections.push(fixtureSection(design, { id: "A", label: "剖面线 1", points: [[-36, 0], [36, 0]] }));
    design.fields.F = { label: "场 F", unit: "m" };
    design.geoNodes.push(addLayer(design, "F", rect(-36, -36, 36, 36), { type: "ground", value: 2 }, "F"));
    design.geoNodes.push(addLayer(design, "H", rect(-32, -30, -8, 30), { type: "flat", amount: 4 }, "F"));
    const browser = await startChromium();
    const { cdp, click, evaluate, key, wait, saved } = browser;
    const button = "#appearance", menu = ".appearance-menu";
    const emulate = (mode: "light" | "dark") => cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
    const paint = () => evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const ready = () => wait(() => !!document.querySelector("#appearance"));
    const openMenu = async () => {
        await click(button);
        await wait(sel => !!document.querySelector(sel + ":popover-open"), menu);
    };
    const closed = () => wait(() => !document.querySelector(".appearance-menu") &&
        document.querySelector("#appearance")?.getAttribute("aria-pressed") === "false");
    const choose = async (id: "light" | "dark") => {
        await openMenu();
        await click(menu + " [data-option=" + id + "]");
        await closed();
    };
    const focused = () => evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.option);
    const drawn = () => evaluate(() => window.appearanceDraws);
    async function expectTheme(theme: "light" | "dark") {
        await wait(theme => document.documentElement.dataset.theme === theme, theme);
        await paint();
        const style = await evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            return { scheme: root.colorScheme, panel: root.getPropertyValue("--bg-panel").trim(), sunken: root.getPropertyValue("--bg-sunken").trim(),
                meta: document.querySelector<HTMLMetaElement>("meta[name=theme-color]")?.content };
        });
        assert.equal(style.scheme, theme);
        assert.equal(style.panel, theme === "dark" ? "#1d2422" : "#fffefa");
        assert.equal(style.meta, style.sunken);
    }
    async function expectRedraw(before: Draws, grid: string) {
        const after = await drawn();
        assert.deepEqual(after, { map: before.map + 1, section: before.section + 1, terrain: before.terrain, grid, raster: after.raster });
        return after;
    }

    try {
        await emulate("light");
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + recordInitialAppearance.toString() + ")()" });
        await cdp("Page.navigate", { url });
        await ready();
        await expectTheme("light");
        await evaluate(observeDraws);
        const bytes = serializeDesign(design);
        await evaluate(async text => {
            window.probe.openName = "appearance.json";
            const root = await navigator.storage.getDirectory(), file = await root.getFileHandle(window.probe.openName, { create: true });
            const stream = await file.createWritable();
            await stream.write(text); await stream.close();
        }, bytes);
        await click("#open"); await saved();
        await wait(() => !!document.querySelector("#plots canvas"));
        await wait(() => window.appearanceDraws.terrain > 0 && window.appearanceDraws.map > 0 && window.appearanceDraws.section > 0);
        await paint();
        const light = await evaluate(mapPixels), lightDraws = await drawn();
        assert.equal(light.outside, "#f9faf6");
        assert.notEqual(light.center, light.outside);
        assert(lightDraws.terrain > 0 && lightDraws.map > 0 && lightDraws.section > 0);
        assert.equal(lightDraws.grid, "#d9dfd7");
        assert.deepEqual(await evaluate(colorsOutsideTokens), [], "Light UI colors come from tokens");

        await openMenu();
        assert.equal(await evaluate(() => document.querySelector("#appearance")?.getAttribute("aria-pressed")), "true");
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll(".appearance-menu [role=menuitemradio]")]
            .map(option => [option.textContent?.trim(), option.getAttribute("aria-checked"), !!option.querySelector("svg")])),
        [["跟随系统", "true", true], ["浅色", "false", true], ["深色", "false", true]]);
        await click(menu + " [data-option=dark]");
        await closed();
        await expectTheme("dark");
        const dark = await evaluate(mapPixels), darkDraws = await expectRedraw(lightDraws, "#323d39");
        assert.equal(dark.outside, "#171d1b");
        assert.notEqual(dark.center, dark.outside);
        assert.notEqual(dark.center, light.center);
        assert.notEqual(darkDraws.raster, lightDraws.raster);

        await choose("light");
        await expectTheme("light");
        assert.deepEqual(await evaluate(mapPixels), light);
        assert.equal((await expectRedraw(darkDraws, "#d9dfd7")).raster, lightDraws.raster);

        await click("[data-tab=layers]");
        await click("button.choice-face[aria-label=显示的场]");
        await click(".choices[aria-label=显示的场] [data-option=F]");
        await paint();
        const field = await evaluate(mapPixels), fieldDraws = await drawn();
        assert.equal(field.center, "#eef2e6", "Light field low value");
        assert.equal(field.left, "#688c80", "Light field high value");
        assert.notEqual(field.center, light.center);
        assert.notEqual(fieldDraws.raster, lightDraws.raster);
        await choose("dark");
        await expectTheme("dark");
        const darkField = await evaluate(mapPixels), darkFieldDraws = await expectRedraw(fieldDraws, "#323d39");
        assert.equal(darkField.outside, "#171d1b");
        assert.equal(darkField.center, "#202b28", "Dark field low value");
        assert.equal(darkField.left, "#4a4b47", "Dark field high value");
        assert.notEqual(darkField.center, darkField.outside);
        assert.notEqual(darkField.center, field.center);
        assert.notEqual(darkFieldDraws.raster, fieldDraws.raster);

        await choose("light");
        await expectTheme("light");
        assert.deepEqual(await evaluate(mapPixels), field);
        const restoredFieldDraws = await expectRedraw(darkFieldDraws, "#d9dfd7");
        assert.equal(restoredFieldDraws.raster, fieldDraws.raster);
        await choose("dark");
        await expectTheme("dark");
        assert.deepEqual(await evaluate(mapPixels), darkField);
        assert.equal((await expectRedraw(restoredFieldDraws, "#323d39")).raster, darkFieldDraws.raster);
        await click("[data-tab=layers]");
        await openMenu();
        assert.deepEqual(await evaluate(colorsOutsideTokens), [], "Dark UI colors come from tokens");
        await key("Escape");
        await closed();

        await click("[data-tab=terrain]");
        await click("button[aria-label=新建地件]");
        await click(".creation-menu [data-option=pen]");
        await wait(() => !!document.querySelector(".drawing-status"));
        await openMenu();
        await key("Escape");
        await closed();
        assert(await evaluate(() => !!document.querySelector(".drawing-status")), "Closing the appearance menu preserves the drawing");
        await key("Escape");
        await wait(() => !document.querySelector(".drawing-status"));

        assert.deepEqual(await evaluate(async () => ({
            state: document.querySelector("#save-state")?.textContent,
            undo: document.querySelector<HTMLButtonElement>("#undo")!.disabled,
            redo: document.querySelector<HTMLButtonElement>("#redo")!.disabled,
            writes: window.probe.writes, bytes: await window.disk("appearance.json")
        })), { state: "已保存", undo: true, redo: true, writes: 0, bytes });

        const beforeReload = await evaluate(() => performance.timeOrigin);
        await cdp("Page.reload");
        await wait(before => performance.timeOrigin !== before && !!document.querySelector("#appearance"), beforeReload);
        assert.deepEqual(await evaluate(() => window.initialAppearance), { theme: "dark", mounted: false });
        await expectTheme("dark");

        await openMenu();
        assert(await evaluate(() => document.activeElement?.matches(".appearance-menu")));
        await key("ArrowDown");
        assert.equal(await focused(), "dark");
        await key("ArrowDown");
        assert.equal(await focused(), "system");
        await key("Enter");
        await closed();
        await expectTheme("light");

        const documentStart = await evaluate(() => performance.timeOrigin);
        await emulate("dark");
        await expectTheme("dark");
        assert.equal(await evaluate(() => performance.timeOrigin), documentStart);

        await key("Enter");
        await wait(() => document.querySelector(".appearance-menu")?.matches(":popover-open"));
        assert.equal(await focused(), "system");
        await key("ArrowDown");
        assert.equal(await focused(), "light");
        await key("Enter");
        await closed();
        await expectTheme("light");
        await emulate("light");
        await emulate("dark");
        await expectTheme("light");

        await key("Enter");
        await wait(() => document.querySelector(".appearance-menu")?.matches(":popover-open"));
        assert.equal(await focused(), "light");
        await key("Escape");
        await closed();
        assert.equal(await evaluate(() => document.activeElement?.id), "appearance");
    }
    finally {
        await browser.close();
    }
}