import { checkGeometryObjects } from "./round42.ts";
import { resolveDesign } from "../../src/core/design/parameters.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { Project } from "../../src/core/project.ts";
import { ProjectMap } from "../../src/render/map.ts";
import { mapColors } from "../../src/render/palette.ts";
import { geoLabelPoint } from "../../src/render/labelLayout.ts";
import { type Point } from "../../src/core/design/v5.ts";
import { fixtureMark, literalCurve, addLayer, rect, syntheticDesign } from "../scenarios.ts";
import { checkProfilesAndLabels } from "./round41.ts";
import { checkVisibleSearch } from "./visibleSearch.ts";
import { createBrowserServer, startChromium } from "./chromium.ts";
import { installPickers } from "./filePickers.ts";
import { checkAppearance } from "./appearance.ts";
import { checkStripSelection } from "./stripSelection.ts";
import { checkMapSelection } from "./mapSelection.ts";
import { checkMapIssues } from "./mapIssues.ts";
import { checkCurveEditing } from "./curveEditing.ts";
import { checkSegmentEditing } from "./segmentEditing.ts";
import { checkRound31Fix } from "./round31Fix.ts";
import { checkLayeredHits, checkSpacePan } from "./mapInput.ts";
import { checkSectionPlots } from "./sectionPlots.ts";
import { checkNumericEditing } from "./numericEditing.ts";
import { checkPenDrawing } from "./penDrawing.ts";
import { checkMapOverlays } from "./mapOverlays.ts";
import { checkCurvePlacements } from "./curvePlacements.ts";
import { checkInspectorActions, checkNarrowInspector, checkParameterSources } from "./round39Inspector.ts";
import { checkContourScales, checkDrawingConstraints, checkSegmentDragAndGuides } from "./round39Map.ts";
import { checkMapParameterOverlays, checkOutlineHoleHits, checkSingleOutlineAndButtons } from "./round40.ts";
import { checkCurveZoom, checkSharedCurves } from "./round37Curves.ts";
import { checkCoarsePreview } from "./coarsePreview.ts";
import { checkWorkerTerrain } from "./workerTerrain.ts";
import { checkUnsharedExport, checkWorkerExport } from "./workerExport.ts";

test("Editor interactions in Chromium", async t => {
    const server = await createBrowserServer();
    try {
        await server.listen();
        const url = server.resolvedUrls!.local[0];
        await t.test("Editor workflows in Chromium", () => checkEditor(url));
        await t.test("Appearance changes in Chromium", () => checkAppearance(url));
        await t.test("Strip selection in Chromium", () => checkStripSelection(url));
        await t.test("Map selection and dragging in Chromium", () => checkMapSelection(url));
        await t.test("Map and inspector issues in Chromium", () => checkMapIssues(url));
        await t.test("Curve editing in Chromium", () => checkCurveEditing(url));
        await t.test("Segment editing in Chromium", () => checkSegmentEditing(url));
        await t.test("Contour selection and sidebar feedback in Chromium", () => checkRound31Fix(url));
        await t.test("Map hits follow layer order in Chromium", () => checkLayeredHits(url));
        await t.test("Space pans the map without editing in Chromium", () => checkSpacePan(url));
        await t.test("Section plots in Chromium", () => checkSectionPlots(url));
        await t.test("Numeric editing in Chromium", () => checkNumericEditing(url));
        await t.test("Pen drawing in Chromium", () => checkPenDrawing(url));
        await t.test("Map overlays in Chromium", () => checkMapOverlays(url));
        await t.test("Coarse numeric drag previews in Chromium", () => checkCoarsePreview(url));
        await t.test("Terrain worker, viewport and sampled expressions in Chromium", () => checkWorkerTerrain(url));
        const commit: string = JSON.parse(server.config.define!.__GROUNDWORK_COMMIT__);
        await t.test("Terrain export with shared memory in Chromium", () => checkWorkerExport(url, commit, true));
        await t.test("Curve handles and camera zoom in Chromium", () => checkCurveZoom(url));
        await t.test("Shared curves and endpoint drawing in Chromium", () => checkSharedCurves(url));
        await t.test("Same-object and shape-only curve references in Chromium", () => checkCurvePlacements(url));
        await t.test("Narrow map interactions preserve the window scroll position in Chromium", () => checkNarrowInspector(url));
        await t.test("Inspector actions fit the minimum sidebar width in Chromium", () => checkInspectorActions(url));
        await t.test("Numeric menus use current field values and list marks in Chromium", () => checkParameterSources(url));
        await t.test("Selected segments move and show active alignment guides in Chromium", () => checkSegmentDragAndGuides(url));
        await t.test("Shift drawing constraints in Chromium", () => checkDrawingConstraints(url));
        await t.test("Contour labels at three camera scales in Chromium", () => checkContourScales(url));
        await t.test("Parameter overlays stay visible during drawing and use distinct strokes in Chromium", () => checkMapParameterOverlays(url));
        await t.test("A single outline highlights and segmented buttons keep their gap and keys in Chromium", () => checkSingleOutlineAndButtons(url));
        await t.test("Outline holes support hover, selection, cycling, menus and body dragging in Chromium", () => checkOutlineHoleHits(url));
        await t.test("Node profiles, slope lines, valleys and localized inspector labels in Chromium", () => checkProfilesAndLabels(url));
        await t.test("Geometry objects, holders and mark anchors in Chromium", () => checkGeometryObjects(url));
        await t.test("List and numeric reference searches match visible labels in Chromium", () => checkVisibleSearch(url));
    }
    finally {
        await server.close();
    }
});

test("Terrain export without shared memory in Chromium", checkUnsharedExport);

async function checkEditor(url: string) {
    const d = syntheticDesign();
    d.geoNodes[0].label = "基底"; d.geoNodes[1].label = "甲台"; d.inputs.A.label = "台地增量";
    d.geoNodes[0].function = { type: "ground", value: 4.5364 };
    d.fields.F = { label: "系数", unit: "%" };
    d.geoNodes.splice(1, 0,
        addLayer(d, "F", rect(-36, -36, 36, 36), { type: "ground", value: .4564 }, "F"),
        addLayer(d, "R", rect(-32, -32, 32, 32), { type: "flat", amount: .04 }, "F"));
    d.geoNodes.push(addLayer(d, "X", { type: "strip", of: ["missing"], widths: [1, 2] }, { type: "blend" }));
    d.marks.push(fixtureMark(d, { id: "M", label: "比例尺", kind: "scale", point: [94, 120], follow: "screen", length: 10 }));
    const browser = await startChromium();
    const { cdp, click, evaluate, key, wait, idle, saved } = browser;
    const text = (sel: string) => evaluate(sel => document.querySelector<HTMLElement>(sel)?.innerText.trim() ?? "", sel);
    const hasBuiltinMark = (selector: string) => evaluate(s =>
        !!document.querySelector(s + " svg")!.querySelector("circle[fill=currentColor]"), selector);
    const panel = (name: string) => click("[data-tab=" + name + "]");
    const terrainTab = () => click("[data-property-tab=function]");
    const clearTerrainSearch = () => evaluate(() => {
        const search = document.querySelector<HTMLInputElement>("#terrain-search")!;
        search.value = ""; search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    const forbidden = /geoNodes\[|inputs\.|fields\.|marks\[/;
    async function choose(label: string, name: string) {
        const escaped = JSON.stringify(label);
        await click("button.choice-face[aria-label=" + escaped + "]");
        const menu = ".choices[aria-label=" + escaped + "]";
        const index = await evaluate(({ menu, name }) => [...document.querySelectorAll(menu + " [role=option]")]
            .findIndex(el => el.textContent?.trim() === name), { menu, name });
        assert(index >= 0, label + " must offer " + name);
        await click(menu + " button[data-option=" + JSON.stringify(await evaluate(({ menu, index }) =>
            (document.querySelectorAll<HTMLButtonElement>(menu + " [role=option]")[index]).dataset.option, { menu, index })) + "]");
        await wait(({ escaped, name }) => document.querySelector("button.choice-face[aria-label=" + escaped + "] span")?.textContent === name, { escaped, name });
        await idle();
    }
    const disk = () => evaluate(() => window.disk("editor-interactions.json"));
    async function keyboardStep(selector: string) {
        await evaluate(s => document.querySelector<HTMLButtonElement>(s)!.focus(), selector);
        await key("Enter"); await idle(); await saved();
        assert(await evaluate(s => document.activeElement === document.querySelector(s), selector), "The numeric step keeps focus after committing");
    }
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
            window.probe.openName = "editor-interactions.json";
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle(window.probe.openName, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
            document.addEventListener("compositionstart", () => document.body.dataset.imeStarted = "true");
            document.addEventListener("compositionend", () => document.body.dataset.imeEnded = "true");
        }, serializeDesign(d));
        await click("#open");
        await wait(() => document.querySelector("#filename")?.textContent === "editor-interactions.json");
        await idle();

        console.log("Seed is a selectable built-in input");
        assert.equal(await text("#properties .property-title h2"), "项目");
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll("#properties h3")].map(h => h.textContent)), ["描述", "地形计算"]);
        await panel("inputs");
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll("#panel h3")].map(h => h.textContent)), ["输入", "场", "几何"]);
        assert.deepEqual(await evaluate(() => [document.querySelector<HTMLElement>("[data-select-input]")?.dataset.selectInput,
            document.querySelector<HTMLElement>("[data-select-field]")?.dataset.selectField]), ["seed", "height"]);
        assert(await hasBuiltinMark("[data-select-input=seed]"));
        assert.equal(await text("[data-input=seed] .numeric-face"), "31");
        await click("[data-select-input=seed]");
        assert.equal(await text("#properties .property-title h2"), "种子");
        assert(await hasBuiltinMark("#properties .property-title"));
        assert(await evaluate(() => !document.querySelector("#properties .property-title :is(input, [data-action=delete])")));
        assert.equal(await text("#properties h3"), "取值范围");
        assert.equal(await text("#properties [data-parameter=\"inputs.seed.value\"] .numeric-face"), "31");
        await click("#properties button[aria-label=增大当前值]"); await saved();
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, 32);
        await click("#undo"); await idle(); await saved();
        assert.equal(await text("#properties .property-title h2"), "种子");
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, 31);
        await keyboardStep("#properties button[aria-label=增大当前值]");
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, 32);
        await keyboardStep("#properties button[aria-label=减小当前值]");
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, 31);

        await click("#properties button[aria-label=当前值]");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "{input:A}" });
        await key("Enter"); await saved();
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, "{input:A}");
        await click("[data-select-input=A]"); await click("#properties [data-action=delete]");
        const references = await evaluate(() => [...document.querySelectorAll("#affected-items button")].map(button => button.textContent?.trim()));
        const seed = references.indexOf("“种子”");
        assert(seed >= 0);
        await click("#affected-items button:nth-of-type(" + (seed + 1) + ")");
        assert.equal(await text("#properties .property-title h2"), "种子");
        await click("#undo"); await idle(); await saved();
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, 31);

        console.log("Issue groups show only present severities");
        const groupNames = () => evaluate(() => [...document.querySelectorAll("#panel h3")].map(h => h.textContent));
        async function issueGroups(expected: string[]) {
            await panel("issues");
            assert.equal(await text("#panel h2"), "问题");
            assert.deepEqual(await groupNames(), expected);
        }
        async function toggleNode(id: string) {
            await panel("terrain"); await click("[data-geo-node=" + id + "]");
            await click("#properties .property-title button[aria-pressed]"); await idle();
        }
        await issueGroups(["错误", "警告"]);
        await toggleNode("T"); await issueGroups(["错误"]);
        await toggleNode("X"); await issueGroups([]);
        assert.equal(await text("#panel .list-empty"), "没有问题");
        await toggleNode("T"); await issueGroups(["警告"]);
        await toggleNode("X"); await issueGroups(["错误", "警告"]);
        await panel("terrain");
        await click("[data-geo-node=G]"); await click("[data-property-tab=issues]");
        assert.equal(await text("#properties .list-empty"), "没有问题");
        await click("[data-property-tab=label]");

        console.log("IME search and selecting candidates with Enter");
        await panel("terrain");
        await click("#terrain-search");
        await compose("甲台", "jiatai", async () => {
            assert.equal(await evaluate(() => document.querySelectorAll("[data-geo-node]").length), d.geoNodes.length);
            await evaluate(() => document.querySelector<HTMLButtonElement>("[data-geo-node=T]")!.click());
            assert(await evaluate(() => document.activeElement?.id === "terrain-search"));
        });
        await wait(() => document.querySelectorAll("[data-geo-node]").length === 1);
        assert.equal(await evaluate(() => document.body.dataset.imeStarted + "/" + document.body.dataset.imeEnded), "true/true");
        assert.match(await text("[data-geo-node=T]"), /甲台/);
        assert(await hasBuiltinMark("[data-geo-node=T] .list-detail"));
        await click("[data-geo-node=T]");
        await click(".property-title input");
        await evaluate(() => (document.activeElement as HTMLInputElement).select());
        await compose("新台", "xintai");
        assert(await evaluate(() => document.activeElement?.matches(".property-title input")));
        await key("Tab"); await idle();
        await wait(() => (document.querySelector(".property-title input") as HTMLInputElement)?.value === "新台");
        const prompt = "#properties textarea[aria-label=描述]";
        await click(prompt);
        await evaluate(s => {
            const textarea = document.querySelector<HTMLTextAreaElement>(s)!;
            textarea.addEventListener("compositionstart", () => textarea.dataset.composing = "true");
            textarea.addEventListener("compositionend", () => textarea.dataset.composing = "false");
        }, prompt);
        await compose("场地", "changdi", async () => {
            const prior = await text("#position");
            await moveMap(.33, .61);
            await wait(prior => document.querySelector("#position")!.textContent?.trim() !== prior, prior);
            const active = await evaluate(s => {
                const textarea = document.querySelector<HTMLTextAreaElement>(s)!;
                return [document.activeElement === textarea, textarea.dataset.composing, textarea.value];
            }, prompt);
            assert.deepEqual(active, [true, "true", "changdi"]);
        });
        await evaluate(s => document.querySelector<HTMLTextAreaElement>(s)!.setSelectionRange(1, 1), prompt);
        await wait(async () => {
            if (document.querySelector("#save-state")?.textContent !== "已保存") return false;
            try {
                return JSON.parse(await window.disk("editor-interactions.json")).geoNodes.find((node: { id: string }) => node.id === "T").prompt === "场地";
            }
            catch (error) {
                if (error instanceof DOMException && error.name === "NotReadableError") return false;
                throw error;
            }
        });
        const caret = await evaluate(s => {
            const textarea = document.querySelector<HTMLTextAreaElement>(s)!;
            return [document.activeElement === textarea, textarea.selectionStart, textarea.selectionEnd];
        }, prompt);
        assert.deepEqual(caret, [true, 1, 1]);
        await evaluate(s => document.querySelector<HTMLTextAreaElement>(s)!.setSelectionRange(2, 2), prompt);
        await compose("描述", "miaoshu");
        assert(await evaluate(s => document.activeElement?.matches(s), prompt));
        await key("s", 2); await saved();
        assert(await evaluate(s => document.activeElement?.matches(s), prompt));
        assert.equal(parseDesign(await disk(), true).geoNodes.find(n => n.id === "T")?.prompt, "场地描述");
        await key("Tab"); await saved();
        const renamed = parseDesign(await disk(), true).geoNodes.find(n => n.id === "T");
        assert.equal(renamed?.label, "新台"); assert.equal(renamed?.prompt, "场地描述");
        await click("#undo"); await saved();
        assert.equal(parseDesign(await disk(), true).geoNodes.find(n => n.id === "T")?.prompt, undefined);
        await click("#redo"); await saved();
        assert.equal(parseDesign(await disk(), true).geoNodes.find(n => n.id === "T")?.prompt, "场地描述");

        console.log("A pending name survives another edit");
        await panel("inputs");
        const title = "#properties .property-title input";
        await click(title);
        await evaluate(s => document.querySelector<HTMLInputElement>(s)!.select(), title);
        await cdp("Input.insertText", { text: "未提交名称" });
        await evaluate(() => document.querySelector<HTMLButtonElement>("[data-input=seed] button[aria-label='增大“种子”']")?.click());
        await idle(); await saved();
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, 32);
        assert.equal(parseDesign(await disk(), true).geoNodes.find(n => n.id === "T")?.label, "新台");
        assert.deepEqual(await evaluate(s => {
            const input = document.querySelector<HTMLInputElement>(s)!;
            return [document.activeElement === input, input.value];
        }, title), [true, "未提交名称"]);
        await evaluate(s => document.querySelector<HTMLInputElement>(s)!.select(), title);
        await cdp("Input.insertText", { text: "新台" });
        await panel("terrain");
        await click("#undo"); await idle(); await saved();
        assert.equal(parseDesign(await disk(), true).inputs.seed.value, 31);

        await terrainTab();
        assert.equal(await hasBuiltinMark("[data-property-tab=function]"), false);
        await click("button.choice-face[aria-label=函数]");
        assert.equal(await text(".choices[aria-label=函数] .group-name"), "函数");
        assert(await hasBuiltinMark("button.choice-face[aria-label=函数]"));
        assert(await hasBuiltinMark(".choices[aria-label=函数] [aria-selected=true]"));
        await key("Escape");
        await click("button[aria-label=为增量插入变量]");
        await wait(() => !!document.querySelector(".numeric-edit") && !!document.querySelector(".reference-menu [data-option]"));
        for (const [id, builtin] of [["input:seed", true], ["input:A", false], ["field:height", true], ["field:F", false]] as const)
            assert.equal(await hasBuiltinMark(`.reference-menu [data-option="${id}"]`), builtin, id);
        await click("button[aria-label=为增量插入变量]");
        await wait(() => document.activeElement?.matches(".numeric-edit"));
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
        assert(bound?.type === "flat" && bound.amount === "{input:A}", JSON.stringify(bound) + " " + await text("#properties [role=alert]"));
        await click("#properties .numeric-face [data-ref=\"input:A\"]");
        await wait(() => {
            const chip = document.querySelector(".numeric-edit [data-ref=\"input:A\"]"), selection = document.getSelection();
            return chip && selection?.isCollapsed && !chip.contains(selection.anchorNode);
        });
        await key("Escape");

        console.log("Localized errors and referenced input deletion");
        await click(".number-row[data-parameter$=\".function.feather\"] .numeric-face");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "-1" });
        assert.equal(await text("#properties [role=alert]"), "无效");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "1/0" });
        assert.equal(await text("#properties [role=alert]"), "除数不能为 0");
        assert.doesNotMatch(await text("#properties [role=alert]"), forbidden);
        await key("Escape");
        await panel("issues");
        const brokenReference = "边 找不到下方地件“missing”";
        assert.equal(await text("#panel [data-issue] .row-text > span"), "X");
        assert.equal(await text("#panel [data-issue] small"), brokenReference);
        assert.doesNotMatch(await text("#panel"), forbidden);
        await panel("terrain"); await clearTerrainSearch(); await click("[data-geo-node=X]");
        await click("[data-property-tab=issues]");
        assert.equal(await text("#properties [data-issue] .row-text > span"), "X");
        assert.equal(await text("#properties [data-issue] small"), brokenReference);
        assert(await evaluate(() => !!document.querySelector("[data-property-tab=issues] [aria-label=有错误]")));
        await panel("inputs"); await click("[data-select-input=A]");
        await click("#properties [data-action=delete]");
        await wait(() => !!document.querySelector("#remove-dialog[open]"));
        assert.match(await text("#remove-dialog h2"), /无法删除“台地增量”/);
        assert.equal(await text("#affected-items"), "“新台.增量”");
        assert.doesNotMatch(await text("#remove-dialog"), forbidden);
        await click("#affected-items button");
        await wait(() => !!document.querySelector("#properties button[aria-label=增量]"));

        console.log("Immediate function and slope form switches, with undo");
        await choose("函数", "海岸");
        assert.equal(await evaluate(() => document.querySelector("[aria-label=海岸线]")?.getAttribute("aria-pressed")), "true");
        assert.match(await text("#mode-hint"), /单击选择/);
        await click("#undo"); await idle();
        await wait(() => document.querySelector("button.choice-face[aria-label=函数] span")?.textContent === "升降");
        await choose("函数", "坡面");
        assert(await evaluate(() => !!document.querySelector("[aria-label=添加坡线]") && !document.querySelector("[aria-label=坡线]")));
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
        await click("[data-parameter$=\".function.rate\"] button[aria-label=增大径向变化率]"); await idle();
        assert.equal(await text("[data-parameter$=\".function.rate\"] .numeric-face"), "-0.19");
        await choose("坡面形式", "沿路径");
        await saved();
        const slope = parseDesign(await disk(), true).geoNodes.find(n => n.id === "T")?.function;
        assert(slope?.type === "slope" && slope.kind === "path");
        assert.deepEqual(slope.lines, []);

        console.log("Displayed field, undefined readings, and mark follow");
        await moveMap(.5, .5);
        assert.match(await text("#position"), /^X -?\d+\.\d m\s+Y -?\d+\.\d m\s+高度 4\.5 m$/);
        await panel("layers");
        const planeLayers = await evaluate(() => {
            const plane = [...document.querySelectorAll("#panel h3")].find(h => h.textContent === "平面图")!.closest("section")!;
            return [...plane.querySelectorAll("label")].map(label => [(label.control as HTMLInputElement)?.dataset.layer, label.textContent?.trim()]);
        });
        assert.deepEqual(planeLayers, [["geoNodes", "地件轮廓"], ["labels", "地件名称"], ["sections", "剖面线"], ["marks", "标记"], ["issues", "问题位置"], ["geometry", "几何变量"]]);
        for (const [layer] of planeLayers) {
            const selector = "input[data-layer=" + layer + "]";
            const checked = () => evaluate(s => document.querySelector<HTMLInputElement>(s)!.checked, selector);
            const initial = await checked();
            await click(selector); assert.equal(await checked(), !initial);
            await click(selector); assert.equal(await checked(), initial);
        }
        const contourToggle = "input[data-layer=contours]", labelToggle = "input[data-layer=contourLabels]";
        const annotation = () => evaluate(s => {
            const input = document.querySelector<HTMLInputElement>(s)!;
            return [input.checked, input.disabled];
        }, labelToggle);
        assert.deepEqual(await annotation(), [true, false]);
        assert.equal(await text(".parameter-row:has(" + labelToggle + ") label"), "标注数值");
        await click(contourToggle); assert.deepEqual(await annotation(), [true, true]);
        await click(contourToggle); assert.deepEqual(await annotation(), [true, false]);
        await click(labelToggle); assert.deepEqual(await annotation(), [false, false]);
        assert.equal(await evaluate(() => JSON.parse(localStorage.getItem("groundwork/map-display-v1")!).layers.contourLabels), false);
        await click(labelToggle);
        const grid = "[data-grid-setting=pixels]";
        await click(grid + " .numeric-face");
        await evaluate(() => document.getSelection()!.selectAllChildren(document.querySelector(".numeric-edit")!));
        await cdp("Input.insertText", { text: "72" });
        await key("Enter");
        assert.equal(await text(grid + " .numeric-face"), "72");
        assert.equal(await evaluate(() => JSON.parse(localStorage.getItem("groundwork/map-display-v1")!).grid.pixels), 72);
        await choose("显示的场", "系数");
        await moveMap(.5, .5);
        assert.match(await text("#position"), /系数 0\.5%$/);
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
        for (const [label, value] of [["单位", "m"], ["精度", "0.1"]]) {
            const selector = "#properties [aria-readonly=true][aria-label=" + label + "]";
            await click(selector);
            assert.deepEqual(await evaluate(s => {
                const el = document.querySelector<HTMLElement>(s)!;
                return [el.innerText, el.matches(":focus"), el.tabIndex, getComputedStyle(el).cursor];
            }, selector), [value, false, -1, "default"]);

            const [left, right, y] = await evaluate(s => {
                const range = document.createRange();
                range.selectNodeContents(document.querySelector(s)!);
                const box = range.getBoundingClientRect();
                return [box.left - 1, box.right + 1, box.top + box.height / 2];
            }, selector);
            await browser.mouse("mousePressed", left, y);
            await browser.mouse("mouseMoved", right, y);
            await browser.mouse("mouseReleased", right, y);
            assert.equal(await evaluate(() => document.getSelection()?.toString()), value);
        }
        const fieldBackground = () => evaluate(() => getComputedStyle(document.querySelector("#properties [aria-label=单位]")!).backgroundColor);
        const readOnlyBackground = await fieldBackground();
        await click("[data-select-field=F]");
        assert.notEqual(await fieldBackground(), readOnlyBackground);
        await click(".property-title input[aria-label=场名称]");
        await evaluate(() => (document.activeElement as HTMLInputElement).select());
        await cdp("Input.insertText", { text: "岩性" });
        await key("Tab"); await idle();
        await click("#properties input[aria-label=单位]");
        assert(await evaluate(() => document.activeElement?.matches("input[aria-label=单位]")));
        await evaluate(() => (document.activeElement as HTMLInputElement).select());
        await cdp("Input.insertText", { text: "‰" });
        await key("Tab"); await idle();
        assert.equal(await text("#properties [data-parameter$=\".precision\"] .unit"), "‰");
        for (const step of [.05, .02, .01]) {
            await click("#properties button[aria-label=减小精度]"); await idle();
            assert.equal(Number(await text("#properties button[aria-label=精度]")), step);
        }
        await moveMap(.5, .5);
        assert.match(await text("#position"), /岩性 0\.50 ‰$/);
        await panel("terrain"); await click("[data-geo-node=R]"); await terrainTab();
        await click("#properties button[aria-label=增大增量]"); await idle();
        assert.equal(await text("#properties button[aria-label=增量]"), "0.05");
        await moveMap(.5, .5);
        assert.match(await text("#position"), /岩性 0\.51 ‰$/);
        await panel("inputs"); await click("[data-select-input=A]");
        for (const step of [.5, .2, .1, .05]) {
            await click("#properties button[aria-label=减小步长]"); await idle();
            assert.equal(Number(await text("#properties button[aria-label=步长]")), step);
        }
        await click("#properties button[aria-label=增大步长]"); await idle();
        assert.equal(Number(await text("#properties button[aria-label=步长]")), .1);
        await saved();
        const before = await disk();
        assert.deepEqual(parseDesign(before, true).fields.F, { label: "岩性", unit: "‰", precision: .01 });
        await click("#open");
        await wait(() => window.probe.opens === 2);
        await idle();
        const writes = await evaluate(() => window.probe.writes);
        await click("#save");
        await wait(writes => window.probe.writes === writes + 1, writes);
        await saved();
        assert.equal(await disk(), before);

        await panel("terrain");
        const [cx, cy] = await evaluate(() => {
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
        });
        const a = [cx - 76, cy - 40], b = [cx + 60, cy - 40], c = [cx + 15, cy + 58], end = [cx - 90, cy + 48];
        async function tap([x, y]: number[], clickCount = 1, button = "left", modifiers = 0) {
            for (const type of ["mousePressed", "mouseReleased"])
                await cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount, modifiers });
        }
        const status = ".drawing-status";
        const selected = () => wait(() => !document.querySelector(".drawing-status") && document.querySelector("#mode-hint")?.textContent?.startsWith("单击选择"));
        async function chooseTool(category: "地件" | "标记", id: string) {
            await click("button[aria-label=新建" + category + "]");
            await click(".creation-menu [data-option=" + id + "]");
        }
        async function buttonCenter(selector: string): Promise<Point> {
            return evaluate(selector => {
                const node = document.querySelector(selector)!;
                node.scrollIntoView({ block: "nearest" });
                const box = node.getBoundingClientRect();
                return [box.left + box.width / 2, box.top + box.height / 2];
            }, selector);
        }
        async function pen() {
            await chooseTool("地件", "pen");
        }
        async function vertices(closed: boolean) {
            await tap(a);
            await browser.mouse("mousePressed", b[0], b[1]);
            await browser.mouse("mouseMoved", b[0] + 12, b[1] + 7);
            await browser.mouse("mouseReleased", b[0] + 12, b[1] + 7);
            if (closed) await tap(c);
        }
        async function undo() {
            await click("#undo"); await idle(); await saved();
        }
        async function compareFinish(start: () => Promise<void>, closed: boolean) {
            await saved();
            const original = await disk();
            await start(); await vertices(closed); await key("Enter"); await idle(); await saved();
            const byEnter = await disk();
            assert(byEnter !== original, "Enter must commit the drawing");
            await undo();
            assert(await disk() === original, "One undo must restore the previous design");
            await start(); await vertices(closed);
            await tap(end); await tap([end[0] + 1, end[1]], 2); await idle(); await saved();
            assert.match(await text("#mode-hint"), /单击选择/);
            assert(await disk() === byEnter, "Double-click and Enter must save identical geometry");
        }
        console.log("Drawing status, Escape, undo, selection and placement cancellation");
        await pen();
        assert.equal(await text(status + " strong"), "新建地件（钢笔）");
        assert.equal(await text(status + " span"), "回车、双击或单击首点结束");
        assert.equal(await evaluate(() => document.querySelector("[aria-label=新建地件]")?.getAttribute("aria-pressed")), "true");
        await vertices(false);
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll<HTMLButtonElement>(".drawing-actions button")]
            .map(button => [button.textContent, button.disabled])), [["完成", true], ["取消", false]]);
        const beforeEscape = await disk();
        await key("Escape"); await selected();
        assert.equal(await disk(), beforeEscape);
        assert.equal(await evaluate(() => document.querySelector("[aria-label=新建地件]")?.getAttribute("aria-pressed")), "false");
        await pen(); await tap(a); await tap(b); await tap(c);
        assert.equal(await evaluate(() => document.querySelector<HTMLButtonElement>(".drawing-actions button")?.disabled), false);
        await click(status + " .drawing-actions button:last-child"); await selected();
        await click("[data-geo-node=G]");
        await pen(); await tap(a);
        await click("[data-geo-node=G]"); await selected();
        await click(".property-title input");
        await evaluate(() => (document.activeElement as HTMLInputElement).select());
        await cdp("Input.insertText", { text: "基底 A" });
        await key("Tab"); await idle(); await saved();
        const beforeCancel = await disk();
        await pen(); await tap(a);
        await key("z", 2); await selected(); await idle(); await saved();
        assert.equal(await disk(), beforeEscape);
        await pen(); await tap(a);
        await key("z", 10); await selected(); await idle(); await saved();
        assert.equal(await disk(), beforeCancel);
        await pen();
        await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
        await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a[0], y: a[1] }] });
        await cdp("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
        await selected();
        await panel("marks"); await chooseTool("标记", "textMark");
        assert.equal(await text(status + " strong"), "新建文字标记");
        assert.equal(await text(status + " button"), "取消");
        assert.equal(await evaluate(() => document.querySelectorAll(".drawing-status button").length), 1);
        await click("[data-mark=M]"); await selected();
        await tap(a); assert.equal(await disk(), beforeCancel);
        await panel("marks"); await chooseTool("标记", "textMark");
        await panel("terrain"); await selected(); await click("[data-geo-node=G]");
        await tap(a); assert.equal(await disk(), beforeCancel);
        await panel("marks"); await chooseTool("标记", "textMark");
        await panel("layers"); await selected(); await tap(a);
        assert.equal(await disk(), beforeCancel);
        await panel("terrain");
        await click("[data-geo-node=G]");
        await tap(await buttonCenter("[data-geo-node=T]"), 1, "left", 8);
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-geo-node][aria-pressed=true]")]
            .map(item => item.dataset.geoNode)), ["T"]);

        console.log("Double-click finishes drawing with only the previously placed vertices");
        await compareFinish(pen, true);
        const triangle = await disk();
        await undo();
        await pen(); await vertices(false);
        await tap(a); await tap(a, 2); await idle();
        assert.match(await text("#toast"), /至少需要三个节点/);
        assert.match(await text("#mode-hint"), /单击放置节点，按 S 切换尖角和自动平滑/);
        await tap(c); await key("Enter"); await idle(); await saved();
        assert(await disk() === triangle, "An incomplete double-click must leave the original vertices and IDs intact");

        for (const shift of [true, false]) {
            await undo();
            await pen(); await vertices(true);
            await tap(a, 1, "left", shift ? 8 : 0); await idle();
            const second = { x: a[0], y: a[1], button: "left", clickCount: 2, modifiers: shift ? 8 : 0 };
            await cdp("Input.dispatchMouseEvent", { ...second, type: "mousePressed" });
            await cdp("Input.dispatchMouseEvent", { ...second, type: "mouseMoved", x: a[0] + 4, buttons: 1 });
            await cdp("Input.dispatchMouseEvent", { ...second, type: "mouseReleased" });
            await idle(); await saved();
            assert(await disk() === triangle, "Double-clicking the first node must close exactly once");
            assert.match(await text("#mode-hint"), /单击选择/);
            assert.equal(await evaluate(() => !!document.querySelector("[aria-label=节点类型]")), false);
        }
        await undo();
        await pen(); await vertices(true);
        await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
        for (let i = 0; i < 2; i++) {
            await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: end[0], y: end[1] }] });
            await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        }
        await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
        await idle(); await saved();
        assert.match(await text("#mode-hint"), /单击选择/);
        assert(await disk() === triangle, "A native double-tap must finish the same drawing");
        await tap(a); await tap(a, 2); await idle(); await saved();
        assert(await disk() !== triangle, "A separate double-click in selection mode must still change the node type");
        await undo();
        assert(await disk() === triangle);

        await compareFinish(async () => {
            await tap(a, 1, "right");
            await click(".context-menu [data-option=add-outline]");
        }, true);
        await undo();
        await terrainTab();
        await choose("函数", "海岸");
        await compareFinish(() => click("button[aria-label=重画海岸线]"), true);
        await choose("函数", "坡面");
        await compareFinish(() => click("button[aria-label=添加坡线]"), false);
        await choose("函数", "山脉");
        await compareFinish(() => click("button[aria-label=添加山脊]"), false);
        const originalRidge = await disk();
        const ridgeOf = (bytes: string) => parseDesign(bytes, true).geoNodes.findLast(node => node.function.type === "mountain")!.function;
        async function actionTip(label: string, member?: number) {
            const subitem = member === undefined ? "" : ".subitem:nth-child(" + member + " of .subitem) > .subitem-heading ";
            const selector = subitem + "button[aria-label=" + JSON.stringify(label) + "]";
            await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 6, y: 6 });
            const hit = await evaluate(async selector => {
                const button = document.querySelector<HTMLButtonElement>(selector)!;
                button.scrollIntoView({ block: "center", behavior: "instant" });
                await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                const box = button.getBoundingClientRect();
                const x = box.x + box.width / 2, y = box.y + box.height / 2;
                return { x, y, tip: button.dataset.tip, target: document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") };
            }, selector);
            assert.equal(hit.tip, label);
            assert.equal(hit.target, label);
            await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.x, y: hit.y });
            await wait(label => document.querySelector(".tooltip:popover-open")?.textContent === label, label);
            return selector;
        }
        assert.equal(await evaluate(() => document.querySelector("[aria-label=添加山脊]")?.getAttribute("aria-pressed")), "false");
        await actionTip("删除山脊");
        await click(await actionTip("复制山脊")); await idle(); await saved();
        const savedDesign = parseDesign(await disk(), true), mountain = ridgeOf(serializeDesign(savedDesign));
        assert(mountain.type === "mountain" && mountain.ridges.length === 2);
        const [originalMember, copy] = mountain.ridges;
        assert("curve" in originalMember && "curve" in copy);
        const shape = literalCurve(savedDesign, originalMember);
        assert.equal(originalMember.slope?.[shape.nodes[0].id], .75);
        assert.notEqual(copy.curve, originalMember.curve);
        assert.deepEqual(literalCurve(savedDesign, copy), shape);
        assert.deepEqual({ ...copy, curve: originalMember.curve }, originalMember);
        assert.equal(await evaluate(() => [...document.querySelectorAll("#properties .subitem-toggle")]
            .find(button => button.textContent?.includes("山脊 2"))?.getAttribute("aria-expanded")), "true");
        await undo();
        assert.equal(await disk(), originalRidge);
        for (const p of [a, b]) {
            await click("button[aria-label=添加山峰]"); await tap(p); await idle(); await saved();
        }
        await actionTip("删除山峰", 2);
        await actionTip("复制山峰", 2);
        await undo(); await undo();
        assert.equal(await disk(), originalRidge);

        console.log("Only the original outline fades while dragging");
        const left = cx + 82, top = cy + 4, mid = top + 40, dx = 58, dy = -24;
        async function pixel(x: number, y: number) {
            return evaluate(async ([x, y]) => {
                await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                const canvas = document.querySelector<HTMLCanvasElement>("#map")!, box = canvas.getBoundingClientRect();
                const px = Math.floor((x - box.left) * canvas.width / box.width), py = Math.floor((y - box.top) * canvas.height / box.height);
                return [...canvas.getContext("2d")!.getImageData(px, py, 1, 1).data].slice(0, 3);
            }, [x, y]);
        }
        await click("button[aria-label=新建地件]");
        await click(".creation-menu [role=menuitem]:nth-child(2)");
        await tap([left, top]); await tap([left + 76, top + 80]); await idle(); await saved();
        await panel("inputs"); await click("[data-select-field=height]");
        await panel("layers"); await click("input[data-layer=contours]");
        const terrain = await pixel(left, mid);
        await click("input[data-layer=geoNodes]");
        await tap([left + 38, mid]);
        const solid = await pixel(left, mid), handle = await pixel(left, top);
        assert.notDeepEqual(solid, terrain);
        await browser.mouse("mousePressed", left + 38, mid);
        await browser.mouse("mouseMoved", left + 38 + dx, mid + dy);
        const origin = await pixel(left, mid);
        for (const [i, channel] of origin.entries())
            assert(Math.abs(channel - (.7 * terrain[i] + .3 * solid[i])) <= 2, "Original outline pixel " + origin);
        assert.deepEqual(await pixel(left + dx, mid + dy), solid);
        assert.deepEqual(await pixel(left + dx, top + dy), handle);
        await browser.mouse("mouseReleased", left + 38 + dx, mid + dy); await idle(); await saved();
        assert.deepEqual(await pixel(left + dx, mid + dy), solid);
        await undo();
        const restored = await disk();
        await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
        await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: left, y: top }] });
        await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: left + 26, y: top - 12 }] });
        assert.deepEqual(await pixel(left, mid), origin, "Dragging a vertex also fades the old edge");
        await cdp("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
        assert.deepEqual(await pixel(left, mid), solid);
        assert.equal(await disk(), restored);

        console.log("Strip construction, segment menu, section list and draggable names");
        const adjacent = syntheticDesign();
        const west = { ...addLayer(adjacent, "A", rect(-30, -12, 0, 12), { type: "flat", amount: 2 }), label: "西台" };
        west.showLabel = true;
        adjacent.geoNodes.push(west, { ...addLayer(adjacent, "B", rect(0, -12, 24, 12), { type: "flat", amount: 5 }), label: "东台" });
        adjacent.marks.push(fixtureMark(adjacent, { id: "M", kind: "scale", label: "比例尺", point: [94, 120], follow: "screen", length: 10 }));
        await evaluate(async bytes => {
            window.probe.openName = "editor-interactions.json";
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle(window.probe.openName, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
        }, serializeDesign(adjacent));
        const opens = await evaluate(() => window.probe.opens);
        await click("#open"); await wait(n => window.probe.opens === n + 1, opens); await idle();
        await panel("terrain"); await click("#fit");
        const mapBox = await evaluate(() => document.querySelector("#map")!.getBoundingClientRect().toJSON() as { left: number; top: number; width: number; height: number });
        const project = new Project(parseDesign(adjacent));
        const camera: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width: mapBox.width, height: mapBox.height });
        camera.fit(project.terrain, false);
        const at = (p: Point): Point => {
            const [x, y] = camera.screen(p);
            return [mapBox.left + x, mapBox.top + y];
        };
        console.log("Circle drawing places four editable boundary nodes");
        const beforeCircle = await disk(), [centerX, centerY] = at([2, 25]), [rimX, rimY] = at([9, 26]);
        await chooseTool("地件", "circle");
        await browser.mouse("mousePressed", centerX, centerY);
        await browser.mouse("mouseMoved", rimX, rimY);
        await browser.mouse("mouseReleased", rimX, rimY);
        await selected(); await idle(); await saved();
        const circleDesign = parseDesign(await disk());
        const circle = circleDesign.geoNodes.find(n => !project.design.geoNodes.some(original => original.id === n.id));
        assert(circle?.construction.type === "outline");
        const [circleBoundary] = circle.construction.outlines.map(holder => literalCurve(circleDesign, holder));
        assert.equal(circleBoundary.nodes.length, 4);
        await wait(id => document.querySelector<HTMLElement>("[data-geo-node][aria-pressed=true]")?.dataset.geoNode === id, circle.id);
        await click("[data-property-tab=region]");
        assert.match(await text("#property-content .geometry-box"), /^曲线 \d+$/);
        const theme = await evaluate(() => document.documentElement.dataset.theme);
        assert(theme === "light" || theme === "dark");
        const handleColor = mapColors[theme].bgPanel.slice(1).match(/../g)!.map(channel => Number.parseInt(channel, 16));
        for (const { p } of circleBoundary.nodes) assert.deepEqual(await pixel(...at(p)), handleColor);
        await undo();
        assert.equal(await disk(), beforeCircle);

        await chooseTool("地件", "strip");
        assert.equal(await text(status + " strong"), "新建地件（条带）");
        assert.equal(await evaluate(() => document.querySelector<HTMLButtonElement>(".drawing-status button")?.disabled), true);
        await tap(at([-19, 5]));
        assert.equal(await evaluate(() => document.querySelector<HTMLButtonElement>(".drawing-status button")?.disabled), false);
        await tap(at([12, 3]));
        await tap(at([0, -12]));
        assert.equal(await evaluate(() => document.querySelector<HTMLButtonElement>(".drawing-status button")?.disabled), true);
        await tap(at([0, 12]));
        assert.equal(await evaluate(() => document.querySelector<HTMLButtonElement>(".drawing-status button")?.disabled), false);
        await click(status + " button:first-child"); await idle(); await saved(); await selected();
        const strip = parseDesign(await disk()).geoNodes.find(n => n.construction.type === "strip")!.construction;
        assert(strip.type === "strip");
        assert.deepEqual(strip.of, ["B", "A"]);
        assert.deepEqual(strip.range, { from: "0", to: "3" });
        await click("[data-property-tab=region]");
        assert.equal(await text("#properties button[aria-label=边] span"), "“东台”和“西台”的公共边，从“0”到“3”");
        assert.equal(await text("#properties [data-parameter$='.construction.widths.0'] .param-name"), "“东台”一侧");
        assert.equal(await text("#properties [data-parameter$='.construction.widths.1'] .param-name"), "“西台”一侧");
        await undo();

        await tap(at([-21, 5])); await tap(at([13, 3]), 1, "left", 8);
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-geo-node][aria-pressed=true]")]
            .map(item => item.dataset.geoNode)), ["B"]);
        await click("[data-geo-node=A]");
        await tap(at([-17, -12]), 1, "right");
        await click(".context-menu [data-option=insert-node]"); await idle(); await saved();
        const nextDesign = parseDesign(await disk()), changed = nextDesign.geoNodes.find(n => n.id === "A")!.construction;
        assert(changed.type === "outline" && literalCurve(nextDesign, changed.outlines[0]).nodes.length === 5);
        assert(Math.abs(literalCurve(nextDesign, changed.outlines[0]).nodes[1].p[0] + 17) < .15);
        assert.equal(literalCurve(nextDesign, changed.outlines[0]).nodes[1].p[1], -12);
        await undo();

        await panel("marks"); await chooseTool("标记", "textMark"); await tap(at([-8, 25])); await idle(); await saved(); await selected();
        await chooseTool("标记", "section"); await tap(at([-34, -26])); await tap(at([25, -26])); await idle(); await saved(); await selected();
        const section = resolveDesign(parseDesign(await disk())).sections[0];
        assert.equal(section.label, "剖面线 1");
        assert.equal(await evaluate(() => document.querySelector("[data-section]")?.getAttribute("aria-pressed")), "true");
        assert.match(await text("#plots .plot-title"), /剖面线 1/);
        const beforeSectionLabel = await disk(), [sx, sy] = at(section.points[0]);
        await browser.mouse("mousePressed", sx + 15, sy - 8);
        await browser.mouse("mouseMoved", sx + 15 + 12 * camera.scale, sy - 8 - 7 * camera.scale);
        await browser.mouse("mouseReleased", sx + 15 + 12 * camera.scale, sy - 8 - 7 * camera.scale);
        await idle(); await saved();
        const sectionOffset = parseDesign(await disk()).sections[0].labelOffset;
        assert(sectionOffset && Math.hypot(sectionOffset[0] - 12, sectionOffset[1] - 7) < .2, JSON.stringify(sectionOffset));
        await undo();
        assert.equal(await disk(), beforeSectionLabel);
        await click("#mark-search"); await cdp("Input.insertText", { text: "剖面线" });
        assert.equal(await evaluate(() => document.querySelectorAll("#panel :is([data-mark],[data-section])").length), 1);
        await tap(await buttonCenter("[data-section]"), 1, "right");
        await click(".context-menu [data-option=delete]"); await idle(); await saved();
        assert.equal(parseDesign(await disk()).sections.length, 0);
        assert.equal(await text("#panel .list-empty"), "没有匹配的结果");

        await panel("terrain"); await click("[data-geo-node=B]");
        const defaultLabel = geoLabelPoint(project.terrain.regions.get("A")!, project.terrain.grid)!;
        const from = at(defaultLabel), to = at([defaultLabel[0] + 9, defaultLabel[1] + 4]);
        const beforeLabel = await disk();
        await browser.mouse("mousePressed", ...from); await browser.mouse("mouseMoved", ...to);
        assert.equal(await evaluate(() => document.querySelector("[data-geo-node=B]")?.getAttribute("aria-pressed")), "true");
        await browser.mouse("mouseReleased", ...to); await idle(); await saved();
        const afterLabel = await disk(), original = parseDesign(beforeLabel).geoNodes.find(n => n.id === "A")!, moved = parseDesign(afterLabel).geoNodes.find(n => n.id === "A")!;
        assert.deepEqual(moved.construction, original.construction);
        assert(moved.labelOffset && Math.hypot(moved.labelOffset[0] - 9, moved.labelOffset[1] - 4) < .2, JSON.stringify(moved.labelOffset));
        assert.equal(await evaluate(() => document.querySelector("[data-geo-node=A]")?.getAttribute("aria-pressed")), "true");
        await undo();
        assert.equal(await disk(), beforeLabel);
        await click("#redo"); await idle(); await saved();
        assert.equal(await disk(), afterLabel);
        await click("#open"); await wait(n => window.probe.opens === n + 2, opens); await idle();
        const labelWrites = await evaluate(() => window.probe.writes);
        await click("#save"); await wait(n => window.probe.writes === n + 1, labelWrites); await saved();
        assert.equal(await disk(), afterLabel);

        console.log("Parameter edits preserve terrain list scroll");
        const long = syntheticDesign();
        for (let i = 0; i < 35; i++)
            long.geoNodes.push(addLayer(long, "P" + i, rect(0, 0, 4, 4), { type: "flat", amount: 1 }));
        await evaluate(async bytes => {
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle("editor-interactions.json");
            const stream = await file.createWritable();
            await stream.write(bytes); await stream.close();
        }, serializeDesign(long));
        await click("#open"); await wait(n => window.probe.opens === n + 3, opens); await idle();
        await panel("terrain"); await click("[data-geo-node=G]"); await terrainTab();
        const scroll = () => evaluate(() => document.querySelector("#panel")!.scrollTop);
        const beforeScroll = await scroll();
        assert(beforeScroll > 0);
        await keyboardStep("#properties button[aria-label=增大数值]");
        assert.equal(await scroll(), beforeScroll);
        assert.equal(parseDesign(await disk(), true).geoNodes[0].function.type, "ground");
        assert.equal(await text("#properties button.numeric-face[aria-label=数值]"), "4.1");
    }
    finally {
        await browser.close();
    }
}