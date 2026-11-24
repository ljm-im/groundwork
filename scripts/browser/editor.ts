import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { layer, rect, syntheticDesign } from "../../test/scenarios.ts";
import { startChromium } from "./chromium.ts";
import { installPickers } from "./pickers.ts";

test("Editor interactions in Chromium", async () => {
    const server = await createServer({ configFile: "configs/vite.config.ts", server: { host: "127.0.0.1", port: 0 } });
    try {
        await server.listen();
        await checkEditor(server.resolvedUrls!.local[0]);
    }
    finally {
        await server.close();
    }
});

async function checkEditor(url: string) {
    const d = syntheticDesign();
    d.geoNodes[0].label = "基底"; d.geoNodes[1].label = "甲台"; d.inputs.A.label = "台地增量";
    d.fields.F = { label: "系数", unit: "%" };
    d.geoNodes.splice(1, 0, layer("F", rect(-36, -36, 36, 36), { type: "ground", value: .6 }, "F"));
    d.geoNodes.push(layer("X", { type: "strip", of: ["missing"], widths: [1, 2] }, { type: "blend" }));
    d.marks.push({ id: "M", label: "比例尺", kind: "scale", point: [94, 120], follow: "screen", length: 10 });
    const browser = await startChromium();
    const { cdp, click, evaluate, key, wait } = browser;
    const text = (sel: string) => evaluate(sel => document.querySelector<HTMLElement>(sel)?.innerText.trim() ?? "", sel);
    const panel = (name: string) => click("[data-tab=" + name + "]");
    const terrainTab = () => click("[data-property-tab=function]");
    const forbidden = /geoNodes\[|inputs\.|fields\.|marks\[/;
    async function choose(label: string, name: string) {
        const escaped = JSON.stringify(label);
        await click("button.choice-face[aria-label=" + escaped + "]");
        const menu = ".choices[aria-label=" + escaped + "]";
        const index = await evaluate(({ menu, name }) => [...document.querySelectorAll(menu + " [role=option]")]
            .findIndex(el => el.textContent?.trim() === name), { menu, name });
        assert(index >= 0, label + " must offer " + name);
        await click(menu + " button:nth-of-type(" + (index + 1) + ")");
        await wait(({ escaped, name }) => document.querySelector("button.choice-face[aria-label=" + escaped + "] span")?.textContent === name, { escaped, name });
        await idle();
    }
    const idle = () => wait(() => !!document.querySelector<HTMLElement>("#busy")?.hidden);
    const saved = () => wait(() => document.querySelector("#save-state")?.textContent === "已保存");
    const disk = () => evaluate(() => window.disk("regression.json"));
    async function compose(text: string, pinyin: string, during?: () => Promise<void>) {
        await cdp("Input.imeSetComposition", { text: pinyin, selectionStart: pinyin.length, selectionEnd: pinyin.length });
        await during?.();
        await cdp("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
        for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 229 });
        await cdp("Input.insertText", { text });
    }
    async function moveMap(x: number, y: number) {
        const [clientX, clientY] = await evaluate(([x, y]) => {
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return [box.left + box.width * x, box.top + box.height * y];
        }, [x, y]);
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: clientX, y: clientY });
    }
    try {
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await cdp("Page.navigate", { url });
        await wait(() => !!document.querySelector(".empty-state"));
        await evaluate(async bytes => {
            window.probe.openName = "regression.json";
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle(window.probe.openName, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
            document.addEventListener("compositionstart", () => document.body.dataset.imeStarted = "true");
            document.addEventListener("compositionend", () => document.body.dataset.imeEnded = "true");
        }, serializeDesign(d));
        await click("#open");
        await wait(() => document.querySelector("#filename")?.textContent === "regression.json");
        await idle();

        console.log("IME search and selecting candidates with Enter");
        await panel("terrain");
        await click("#terrain-search");
        await compose("甲台", "jiatai", async () => {
            assert.equal(await evaluate(() => document.querySelectorAll("[data-geo-node]").length), d.geoNodes.length);
        });
        await wait(() => document.querySelectorAll("[data-geo-node]").length === 1);
        assert.equal(await evaluate(() => document.body.dataset.imeStarted + "/" + document.body.dataset.imeEnded), "true/true");
        assert.match(await text("[data-geo-node=T]"), /甲台/);
        await click("[data-geo-node=T]");
        await click(".property-title input");
        await evaluate(() => (document.activeElement as HTMLInputElement).select());
        await compose("新台", "xintai");
        assert(await evaluate(() => document.activeElement?.matches(".property-title input")));
        await key("Tab"); await idle();
        await wait(() => (document.querySelector(".property-title input") as HTMLInputElement)?.value === "新台");
        const prompt = "textarea[data-prompt=geoNodes]";
        await click(prompt);
        await compose("场地描述", "changdimiaoshu");
        assert(await evaluate(s => document.activeElement?.matches(s), prompt));
        await key("Tab"); await saved();
        const renamed = parseDesign(await disk(), true).geoNodes.find(n => n.id === "T");
        assert.equal(renamed?.label, "新台"); assert.equal(renamed?.prompt, "场地描述");

        await terrainTab();
        await click("button[aria-label=为增量插入变量]");
        await wait(() => !!document.querySelector(".numeric-edit"));
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await key("Backspace");
        await wait(() => document.querySelector(".numeric-edit")?.textContent === "");
        await compose("台地", "taidi");
        await wait(() => document.querySelector(".reference-menu [data-option=\"input:A\"]")?.textContent?.includes("台地增量"));
        assert(await evaluate(() => document.activeElement?.matches(".numeric-edit")));
        await click(".reference-menu [data-option=\"input:A\"]");
        await wait(() => !!document.querySelector(".numeric-edit [data-ref=\"input:A\"]"));
        await key("Enter"); await idle(); await saved();
        const bound = parseDesign(await disk(), true).geoNodes.find(n => n.id === "T")?.function;
        assert(bound?.type === "flat" && bound.amount === "{input:A}", JSON.stringify(bound) + " " + await text(".number-error"));

        console.log("Localized errors and referenced input deletion");
        await click(".number-row[data-parameter$=\".function.feather\"] .numeric-face");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "-1" });
        assert.match(await text(".number-error"), /“新台”\.羽化宽度 无效/);
        assert.doesNotMatch(await text(".number-error"), forbidden);
        await key("Escape");
        await panel("issues");
        assert.match(await text("#panel .issue-row"), /“X”\.边 找不到下方地件/);
        assert.doesNotMatch(await text("#panel"), forbidden);
        await panel("inputs"); await click("[data-select-input=A]");
        await click("#properties [data-action=delete]");
        await wait(() => !!document.querySelector("#remove-dialog[open]"));
        assert.match(await text("#remove-dialog h2"), /无法删除“台地增量”/);
        assert.match(await text("#affected-items"), /“新台”\.增量/);
        assert.doesNotMatch(await text("#remove-dialog"), forbidden);
        await click("#affected-items button");
        await wait(() => !!document.querySelector("#properties button[aria-label=增量]"));

        console.log("Immediate function and slope form switches, with undo");
        await choose("函数", "coast");
        assert.equal(await evaluate(() => document.querySelector("[aria-label=海岸线]")?.getAttribute("aria-pressed")), "true");
        assert.match(await text("#mode-hint"), /单击选择/);
        await click("#undo"); await idle();
        await wait(() => document.querySelector("button.choice-face[aria-label=函数] span")?.textContent === "flat");
        await choose("函数", "slope");
        assert.equal(await evaluate(() => document.querySelector("[aria-label=坡线]")?.getAttribute("aria-pressed")), "true");
        assert.match(await text("#mode-hint"), /单击选择/);
        await choose("坡面形式", "径向");
        assert.equal(await text("[data-parameter$=\".function.rate\"] .unit"), "m/m");
        const maxWidth = await evaluate(() => {
            const unit = document.querySelector("[data-parameter$=\".function.rate\"] .unit")!;
            const probe = document.createElement("span");
            probe.style.display = "inline-block";
            unit.append(probe);
            const widths = ["m", "m/m", "/m", "%", "px"].map(text => {
                probe.textContent = text; return probe.getBoundingClientRect().width;
            });
            probe.remove();
            return { minimum: Math.ceil(Math.max(...widths)), actual: unit.getBoundingClientRect().width };
        });
        assert(maxWidth.actual >= maxWidth.minimum, JSON.stringify(maxWidth));
        console.log("Unit width", JSON.stringify(maxWidth));
        await choose("坡面形式", "沿路径");
        await saved();
        const slope = parseDesign(await disk(), true).geoNodes.find(n => n.id === "T")?.function;
        assert(slope?.type === "slope" && slope.kind === "path");
        assert.deepEqual(slope.line.points.map(v => v.h), [0, 2]);

        console.log("Displayed field, undefined readings, and mark follow");
        await moveMap(.5, .5);
        assert.match(await text("#position"), /^X -?\d+\.\d m\s+Y -?\d+\.\d m\s+高度 4\.0 m$/);
        await panel("layers"); await choose("显示的场", "系数");
        await moveMap(.5, .5);
        assert.match(await text("#position"), /系数 0\.6%$/);
        await moveMap(.01, .01);
        assert.match(await text("#position"), /系数 –$/);
        await panel("marks"); await click("[data-mark=M]");
        assert.equal(await text("button[aria-label=跟随] span"), "屏幕");
        await choose("跟随", "地图");
        assert(await evaluate(() => !!document.querySelector("#properties button[aria-label=长度]")));
        await choose("跟随", "屏幕");
        assert(await evaluate(() => !document.querySelector("#properties button[aria-label=长度]")));

        console.log("Read-only built-ins, positive input steps, and byte-stable reopening");
        await panel("inputs"); await click("[data-select-field=height]");
        assert.deepEqual(await evaluate(() => ["标签", "单位"].map(label => {
            const input = document.querySelector<HTMLInputElement>("#properties input[aria-label=" + label + "]")!;
            return [input.value, input.readOnly];
        })), [["高度", true], ["m", true]]);
        await click("[data-select-input=A]");
        for (const step of [.5, .2, .1, .05]) {
            await click("#properties button[aria-label=减小步长]");
            assert.equal(Number(await text("#properties button[aria-label=步长]")), step);
        }
        await click("#properties button[aria-label=增大步长]");
        assert.equal(Number(await text("#properties button[aria-label=步长]")), .1);
        await saved();
        const before = await disk();
        await click("#open");
        await wait(() => window.probe.opens === 2);
        await idle();
        const writes = await evaluate(() => window.probe.writes);
        await click("#save");
        await wait(writes => window.probe.writes === writes + 1, writes);
        await saved();
        assert.equal(await disk(), before);
    }
    finally {
        await browser.close();
    }
}