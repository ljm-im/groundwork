import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import { seedId } from "../../src/core/design/defaults.ts";
import { Project } from "../../src/core/project.ts";
import { ProjectMap } from "../../src/render/map.ts";
import { type Point } from "../../src/core/design/v5.ts";
import { parseDesign, serializeDesign } from "../../src/core/design/model.ts";
import { startChromium } from "./chromium.ts";
import { test } from "node:test";
import { fixtureOptions, readFixture } from "../../configs/read-fixture.ts";

import { syntheticDesign } from "../scenarios.ts";
import { installPickers, type Probe } from "./filePickers.ts";

async function withFileServer(run: (url: string) => Promise<void>) {
    const server = await createServer({ configFile: "configs/vite.config.ts", server: { host: "127.0.0.1", port: 0 } });
    try {
        await server.listen();
        await run(server.resolvedUrls!.local[0]);
    }
    finally {
        await server.close();
    }
}

test("Editor file workflows in Chromium", fixtureOptions("round14-coast.json", "round14-land.json"), () =>
    withFileServer(async url => checkFileWorkflows(url, await readFixture("round14-coast.json"))));

test("Chromium leaves directly and reopens the latest browser draft", () => withFileServer(checkDraftLifecycle));

async function checkDraftLifecycle(baseUrl: string) {
    const browser = await startChromium(), { cdp, click, closeTab, dialogs, evaluate, key, openTab, wait } = browser;
    const file = (name: string) => wait(name => document.querySelector("#filename")?.textContent === name &&
        !document.querySelector(".map-wrap[data-busy=true]"), name);
    const state = (name: string) => wait(name => document.querySelector("#save-state")?.textContent === name, name);
    const draft = () => evaluate(() => JSON.parse(localStorage.getItem("terrain-editor/unsaved-v1") ?? "null") as
        { filename: string; text: string; unbound?: boolean; dirty?: boolean } | null);
    const unload = () => evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
    const install = () => cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
    let visit = 0;
    async function navigate() {
        const url = baseUrl + "?draft=" + ++visit;
        await cdp("Page.navigate", { url });
        await wait(url => location.href === url && !!document.querySelector(".map-wrap"), url);
    }
    const counts: { action: string; dialogs: number }[] = [];
    async function leave(action: "refresh" | "navigate" | "close", name: string) {
        assert(await evaluate(() => navigator.userActivation.hasBeenActive), action + " starts from an activated page");
        const before = dialogs.length;
        if (action === "refresh") {
            const origin = await evaluate(() => performance.timeOrigin);
            await cdp("Page.reload");
            await wait(origin => performance.timeOrigin !== origin, origin);
        }
        else {
            if (action === "close") {
                await closeTab();
                await openTab();
                await install();
            }
            await navigate();
        }
        await file(name);
        const observed = dialogs.length - before;
        counts.push({ action, dialogs: observed });
        assert.equal(observed, 0, action + " beforeunload dialogs");
    }
    async function editBase(value: number, commit = false) {
        await click("[data-tab=inputs]");
        await click("[data-input=base] .numeric-face");
        await wait(() => document.activeElement?.matches("[data-input=base] .numeric-edit"));
        await evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
        await cdp("Input.insertText", { text: String(value) });
        if (commit) await key("Enter");
        else assert(await evaluate(() => document.activeElement?.matches("[data-input=base] .numeric-edit")));
    }
    const cleanProject = async (text: string) => {
        await file("未命名");
        await state("已保存");
        const record = await draft();
        assert(record?.unbound && !record.dirty);
        assert.equal(record.filename, "未命名");
        assert.equal(record.text, text);
    };
    try {
        await install();
        await navigate();
        await file("未打开文件");
        await click(".empty-actions button:first-child");
        await file("未命名");
        const original = (await draft())!.text, first = parseDesign(original);
        assert.equal(first.geoNodes[0].id, "ground");
        assert.equal(first.marks[0].kind, "scale");
        await cleanProject(original);
        await leave("refresh", "未命名");
        await cleanProject(original);
        await click("#fit");
        await leave("close", "未命名");
        await cleanProject(original);

        await editBase(6, true);
        await state("未保存");
        await click("#undo");
        await cleanProject(original);
        await leave("refresh", "未命名");
        await cleanProject(original);
        await evaluate(() => window.probe.cancelOpen = true);
        await click("#open");
        await wait(() => window.probe.opens === 1 && !document.querySelector(".map-wrap[data-busy=true]"));
        assert(!await evaluate(() => document.querySelector<HTMLDialogElement>("#discard-changes")?.open));
        await cleanProject(original);
        await leave("navigate", "未命名");
        await cleanProject(original);

        await editBase(7);
        assert.equal(parseDesign((await draft())!.text).inputs.base.value, 2);
        await leave("close", "未命名");
        assert.equal(parseDesign((await draft())!.text).inputs.base.value, 7);
        await state("未保存");
        assert(await unload(), "Unbound edits allow leaving");
        await evaluate(() => Object.assign(window.probe, { saveName: "held-write.json", hold: true }));
        await click("#save");
        await state("正在保存");
        assert(await unload(), "An open write allows leaving");
        await leave("refresh", "未命名");
        assert.equal(parseDesign((await draft())!.text).inputs.base.value, 7);

        await evaluate(() => Object.assign(window.probe, { saveName: "failed-write.json", fail: true }));
        await click("#save");
        await state("保存失败");
        assert(await unload(), "A failed write allows leaving");
        await leave("navigate", "未命名");
        assert.equal(parseDesign((await draft())!.text).inputs.base.value, 7);
        await click("#new");
        await wait(() => document.querySelector<HTMLDialogElement>("#discard-changes")?.open);
        await click("#discard-changes [value=discard]");
        await file("未命名");
        await cleanProject(original);
        await leave("refresh", "未命名");
        await cleanProject(original);

        await evaluate(() => window.showOpenFilePicker = () => new Promise(() => {}));
        await click("#open");
        await wait(() => document.querySelector(".map-wrap[data-busy=true]"));
        assert(await unload(), "The busy editor allows leaving");
        await leave("navigate", "未命名");
        await cleanProject(original);

        await evaluate(() => window.probe.saveName = "first-save.json");
        await click("#save");
        await file("first-save.json");
        assert.deepEqual(await evaluate(() => window.probe.suggestions), ["project.json"]);
        assert.equal(await evaluate(() => window.disk("first-save.json")), original);
        assert.equal(await draft(), null);
        await leave("refresh", "未打开文件");
        console.log("Draft lifecycle dialog counts", counts);
    }
    finally {
        await browser.close();
    }
}

async function checkFileWorkflows(baseUrl: string, fixture: string) {
    const artifactDir = process.env.GROUNDWORK_BROWSER_OUTPUT ?? ".local/browser/files";
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    await mkdir(artifactDir, { recursive: true });
    const browser = await startChromium();
    const { cdp, evaluate, click, mouse, key, wait } = browser;
    async function mapPoint(design: ReturnType<typeof parseDesign>, point: Point, screen = false): Promise<Point> {
        const [x, y, width, height] = await evaluate(() => {
            const box = document.querySelector("#map")!.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height];
        });
        const project = new Project(design), map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { width, height });
        map.fit(project.terrain, false);
        const [px, py] = screen ? point : map.screen(point);
        return [x + px, y + py];
    }
    const report = { browser: browser.version, viewport: [1440, 960], checks: {} as Record<string, unknown> };
    let visit = 0, step = "";
    function check(name: string) {
        step = name;
        console.log(name);
    }
    async function navigate(recovered?: string) {
        const url = baseUrl + "?test=" + ++visit;
        await cdp("Page.navigate", { url });
        await wait(({ url, recovered }) => location.href === url && (recovered ?
            document.querySelector("#filename")?.textContent === recovered : !!document.querySelector(".empty-state")), { url, recovered });
        assert.equal(await evaluate(() => document.querySelectorAll("[title]").length), 0);
    }
    const set = (values: Partial<Probe>) => evaluate(values => Object.assign(window.probe, values) && true, values);
    const disk = (name: string) => evaluate(name => window.disk(name), name);
    const fileDigest = (name: string) => evaluate(async name => {
        const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle(name);
        const data = await (await handle.getFile()).arrayBuffer();
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
        return { bytes: data.byteLength, sha256: Array.from(digest, n => n.toString(16).padStart(2, "0")).join("") };
    }, name);
    const prop = <K extends keyof Probe>(name: K) => evaluate(name => window.probe[name], name);
    const state = () => evaluate(() => document.querySelector("#save-state")?.textContent);
    const draft = () => evaluate(() => JSON.parse(localStorage.getItem("terrain-editor/unsaved-v1") ?? "null") as { filename: string; text: string } | null);
    const unload = () => evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
    const filename = (name: string) => wait(name => document.querySelector("#filename")?.textContent === name && !document.querySelector(".map-wrap[data-busy=true]"), name);
    const status = (value: string) => wait(value => document.querySelector("#save-state")?.textContent === value, value);
    const saved = (count: number) => wait(count => window.probe.writes >= count && !document.querySelector(".map-wrap[data-busy=true]") && document.querySelector("#save-state")?.textContent === "已保存", count);
    async function storage() {
        return evaluate(async () => ({ keys: Object.keys(localStorage), databases: (await indexedDB.databases()).map(db => db.name) }));
    }
    async function prompt(text: string, blur = true) {
        await click("[data-tab=terrain]");
        if (!await evaluate(() => !!document.querySelector("#properties textarea[aria-label=描述]"))) {
            const [x, y] = await evaluate(() => {
                const box = document.querySelector("#map")!.getBoundingClientRect();
                return [box.left + 8, box.top + 8];
            });
            await mouse("mousePressed", x, y);
            await mouse("mouseReleased", x, y);
        }
        await click("#properties textarea[aria-label=描述]");
        await evaluate(() => (document.activeElement as HTMLTextAreaElement).select());
        await cdp("Input.insertText", { text });
        if (blur) await key("Tab");
    }
    async function seed(name: string, raw = fixture) {
        await evaluate(async ([name, text]) => {
            const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle(name, { create: true });
            const writer = await handle.createWritable();
            await writer.write(text);
            await writer.close();
        }, [name, raw]);
    }
    try {
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + installPickers.toString() + ")()" });
        await navigate();
        check("Empty editor");
        const empty = await evaluate(() => ({
            filename: document.querySelector("#filename")!.textContent,
            intro: document.querySelector<HTMLElement>(".empty-state")!.innerText,
            actions: [...document.querySelectorAll<HTMLButtonElement>(".empty-state button")].map(el => [el.innerText, el.disabled]),
            header: ["new", "open", "save", "undo", "redo"].map(id => (document.getElementById(id) as HTMLButtonElement).disabled),
            hasToolbar: !!document.querySelector(".map-tools"),
            emptyPlots: !document.querySelector("#plots")!.children.length,
            issueMarker: !!document.querySelector("#issue-dot"),
            fileInputs: document.querySelectorAll("input[type=file]").length,
            mapPixel: [...document.querySelector<HTMLCanvasElement>("#map")!.getContext("2d")!.getImageData(30, 30, 1, 1).data]
        }));
        assert.equal(empty.filename, "未打开文件");
        assert.equal(empty.intro.split(/\s+/).join(" "), "新建 打开");
        assert.deepEqual(empty.actions, [["新建", false], ["打开", false]]);
        assert.deepEqual(empty.header, [false, false, true, true, true]);
        assert.equal(empty.hasToolbar, false);
        assert(empty.emptyPlots);
        assert.equal(empty.issueMarker, false);
        assert.equal(empty.fileInputs, 0);
        assert.deepEqual(empty.mapPixel, [0, 0, 0, 0]);
        const cleanStorage = { keys: [], databases: [] };
        assert.deepEqual(await storage(), cleanStorage);
        assert.equal(await prop("exampleReads"), 0);
        const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
        await writeFile(join(artifactDir, "empty.png"), Buffer.from(screenshot.data, "base64"));
        for (const tab of ["marks", "terrain", "layers", "issues", "inputs"]) {
            await click("[data-tab=" + tab + "]");
            assert.equal(await evaluate(() => document.querySelector("#panel")!.children.length), 0);
        }
        await key("s", 2);
        await key("Delete");
        await key("z", 2);
        assert.deepEqual(await prop("suggestions"), []);
        assert.equal(await unload(), false);
        report.checks.empty = { ...empty, storage: cleanStorage };

        const a = "海岛 A.json", b = "新岛 B.json", c = "恢复 C.json";
        await seed(a);
        // Compare persisted edits with the exact v5 representation shown to the editor.
        const canonical = await evaluate(async text => {
            const module = "/src/core/design/model.ts";
            const { parseDesign, serializeDesign } = await import(module) as typeof import("../../src/core/design/model.ts");
            return serializeDesign(parseDesign(text));
        }, fixture);
        check("Open pristine v5");
        await click(".empty-actions button:last-child");
        await filename(a);
        assert.deepEqual(await prop("events"), ["open", "permission:readwrite", "read"]);
        assert.equal(await prop("writes"), 0);
        assert.equal(await disk(a), fixture);
        assert.deepEqual(await storage(), cleanStorage);
        assert.equal(await unload(), false);
        const pristine = await fileDigest(a);
        assert.deepEqual(pristine, { bytes: Buffer.byteLength(fixture), sha256: sha(fixture) });
        report.checks.open = { writes: 0, ...pristine, events: await prop("events") };

        check("Drag a mark, undo and redo");
        const authored = parseDesign(fixture), mark = authored.marks.find(m => m.kind === "scale")!;
        await click("[data-tab=marks]");
        await click("[data-mark=" + JSON.stringify(mark.id) + "]");
        const [x, y] = await mapPoint(authored, mark.point, mark.follow === "screen");
        await mouse("mousePressed", x, y);
        await mouse("mouseMoved", x + 21, y - 12);
        await mouse("mouseReleased", x + 21, y - 12);
        await saved(1);
        const moved = await disk(a), edited = JSON.parse(moved), expected = JSON.parse(canonical);
        const before = expected.marks.find((m: { id: string }) => m.id === mark.id).point, after = edited.marks.find((m: { id: string }) => m.id === mark.id).point;
        assert.notDeepEqual(before, after);
        expected.marks.find((m: { id: string }) => m.id === mark.id).point = after;
        assert.equal(moved, serializeDesign(expected));
        const movedDigest = await fileDigest(a);
        assert.equal(movedDigest.sha256, sha(serializeDesign(expected)));
        await click("#undo");
        await saved(2);
        assert.equal(await disk(a), canonical);
        const undoDigest = await fileDigest(a);
        assert.equal(undoDigest.sha256, sha(canonical));
        await click("#redo");
        await saved(3);
        assert.equal(await disk(a), moved);
        assert.equal(await draft(), null);
        const redoDigest = await fileDigest(a);
        assert.deepEqual(redoDigest, movedDigest);
        report.checks.move = { mark: mark.id, before, after, movedSha256: movedDigest.sha256, undoSha256: undoDigest.sha256, redoSha256: redoDigest.sha256 };

        check("Persist a description on blur");
        await prompt("描述 A 已更新。", false);
        assert.equal(await disk(a), moved);
        await key("Tab");
        await saved(4);
        assert.equal(JSON.parse(await disk(a)).prompt, "描述 A 已更新。");
        report.checks.description = { beforeBlurUnchanged: true, afterBlur: JSON.parse(await disk(a)).prompt };

        check("New, cancellation and discard confirmation");
        await click("#new");
        await filename("未命名");
        assert.equal(await prop("exampleReads"), 0);
        assert.equal((await draft())?.filename, "未命名");
        assert.equal(await unload(), false);
        assert(await evaluate(() => document.querySelector<HTMLButtonElement>("#undo")!.disabled && document.querySelector<HTMLButtonElement>("#redo")!.disabled));
        await prompt("尚未绑定的设计。");
        await status("未保存");
        const initialDraft = await draft();
        assert.equal(JSON.parse(initialDraft!.text).prompt, "尚未绑定的设计。");
        assert.equal(await unload(), false);
        const lastA = await disk(a), writes = await prop("writes");
        await set({ cancel: true });
        const toast = await evaluate(() => document.querySelector("#toast")!.textContent);
        await key("s", 2);
        await wait(() => window.probe.suggestions.length === 1);
        assert.deepEqual(await prop("suggestions"), ["project.json"]);
        assert.deepEqual(await draft(), initialDraft);
        assert.equal(await state(), "未保存");
        assert.equal(await evaluate(() => document.querySelector("#toast")!.textContent), toast);
        await click("#open");
        await wait(() => document.querySelector<HTMLDialogElement>("#discard-changes")!.open);
        assert.equal(await prop("opens"), 1);
        await click("#discard-changes [value=cancel]");
        await wait(() => !document.querySelector<HTMLDialogElement>("#discard-changes")!.open);
        assert.equal(await prop("opens"), 1);
        assert.equal(await disk(a), lastA);
        assert.equal(await prop("writes"), writes);
        assert.deepEqual(await draft(), initialDraft);
        report.checks.cancel = { suggested: "project.json", writesDuringUnboundEdits: 0, draftUnchanged: true, discardCancelledBeforePicker: true };

        check("Ctrl+S binds, preserves a focused description and enables later writes");
        await set({ cancel: false, hold: true });
        await prompt("Ctrl+S 提交本段。", false);
        await key("s", 2);
        await status("正在保存");
        assert.equal(await unload(), false);
        assert.equal(JSON.parse((await draft())!.text).prompt, "Ctrl+S 提交本段。");
        await evaluate(() => window.probe.release!());
        await filename(b);
        await saved(writes + 1);
        assert.equal(JSON.parse(await disk(b)).prompt, "Ctrl+S 提交本段。");
        assert.deepEqual(await storage(), cleanStorage);
        await prompt("绑定后自动写入。");
        await saved(writes + 2);
        assert.equal(JSON.parse(await disk(b)).prompt, "绑定后自动写入。");
        assert.equal(await disk(a), lastA);
        report.checks.bind = { savedAs: b, suggestions: await prop("suggestions"), pendingDraft: true, automatic: true, storageAfterSave: await storage() };

        check("Denied permission, explicit retry and transient write failure");
        await set({ permission: "denied" });
        await click("#open");
        await filename(a);
        await status("未保存");
        assert.equal(await unload(), false);
        assert.equal(await draft(), null);
        assert.equal(await evaluate(() => document.querySelector("#toast")!.textContent), "未获得写入权限，修改不会写入文件");
        const openedCount = await prop("writes");
        await prompt("只读时的修改。");
        assert.equal(await state(), "未保存");
        assert.equal(JSON.parse((await draft())!.text).prompt, "只读时的修改。");
        assert.equal(await disk(a), lastA);
        assert.equal(await prop("writes"), openedCount);
        await set({ permission: "granted" });
        await click("#save");
        await saved(openedCount + 1);
        assert.equal(JSON.parse(await disk(a)).prompt, "只读时的修改。");
        await set({ fail: true });
        const lastGood = await disk(a);
        await prompt("写入失败时保留。");
        await status("保存失败");
        const reason = await evaluate(() => document.querySelector("#toast")!.textContent);
        assert.match(reason, /文件暂时被占用/);
        assert.equal(await disk(a), lastGood);
        assert.equal(JSON.parse((await draft())!.text).prompt, "写入失败时保留。");
        assert.equal(await unload(), false);
        await set({ fail: false });
        await prompt("失败后的下一步。");
        await saved(openedCount + 3);
        assert.equal(JSON.parse(await disk(a)).prompt, "失败后的下一步。");
        assert.equal(await draft(), null);
        report.checks.permissions = { deniedWrites: 0, grantedOnSave: true, reason, nextChangeRetried: true };

        check("Ignore the previous file's late completion and isolate undo history");
        await set({ hold: true });
        await prompt("旧文件中的最后一次写入。");
        await status("正在保存");
        await prompt("旧文件的待写步骤。");
        await click("#new");
        await wait(() => document.querySelector<HTMLDialogElement>("#discard-changes")!.open);
        await click("#discard-changes [value=discard]");
        await filename("未命名");
        assert(await evaluate(() => document.querySelector<HTMLButtonElement>("#undo")!.disabled));
        await prompt("新文件的草稿。");
        const nextDraft = await draft(), closed = await prop("closes");
        await evaluate(() => window.probe.release!());
        await wait(count => window.probe.closes === count, closed + 1);
        assert.equal(JSON.parse(await disk(a)).prompt, "旧文件中的最后一次写入。");
        assert.equal(await state(), "未保存");
        assert.deepEqual(await draft(), nextDraft);
        report.checks.switchDuringWrite = { oldFile: a, pendingOldEditDiscarded: true, currentDraftUnaffected: true };

        check("Recover a named draft, bind it to a new path, then refresh");
        await set({ permission: "denied", openName: b });
        await click("#open");
        await wait(() => document.querySelector<HTMLDialogElement>("#discard-changes")!.open);
        await click("#discard-changes [value=discard]");
        await filename(b);
        assert(await evaluate(() => document.querySelector<HTMLButtonElement>("#undo")!.disabled));
        const lastB = await disk(b);
        await prompt("刷新后需要恢复。");
        const beforeReload = await draft();
        assert.equal(beforeReload?.filename, b);
        assert(await evaluate(() => navigator.userActivation.hasBeenActive));
        const dialogCount = browser.dialogs.length;
        await navigate(b);
        const beforeUnloadDialogs = browser.dialogs.length - dialogCount;
        const actualBeforeUnload = beforeUnloadDialogs > 0;
        assert.equal(beforeUnloadDialogs, 0);
        await filename(b);
        assert.equal(await state(), "未保存");
        assert.equal(await evaluate(() => document.querySelector("#toast")?.textContent), "已恢复未保存的草稿");
        assert(await evaluate(() => !document.querySelector("#draft-dialog")));
        assert(await evaluate(() => document.querySelector<HTMLButtonElement>("#undo")!.disabled));
        await prompt("恢复后依然未绑定。");
        assert.equal(await prop("writes"), 0);
        assert.equal(await disk(b), lastB);
        await set({ saveName: c });
        await key("s", 2);
        await filename(c);
        assert.deepEqual(await prop("suggestions"), [b]);
        assert.equal(JSON.parse(await disk(c)).prompt, "恢复后依然未绑定。");
        assert.deepEqual(await storage(), cleanStorage);
        await navigate();
        await filename("未打开文件");
        assert(await evaluate(() => !document.querySelector("#draft-dialog")));
        assert.equal(await prop("exampleReads"), 0);
        assert.deepEqual(await storage(), cleanStorage);
        report.checks.recover = { originalName: b, suggested: b, newName: c, actualBeforeUnload, beforeUnloadDialogs, refreshEmpty: true };

        check("Keep an invalid draft available after a failed recovery");
        const invalid = JSON.stringify({ text: "{\"version\":4}", filename: "invalid.json" });
        await evaluate(text => localStorage.setItem("terrain-editor/unsaved-v1", text), invalid);
        await navigate();
        await filename("未打开文件");
        assert.match(await evaluate(() => document.querySelector("#toast")?.textContent ?? ""), /^草稿无法恢复：.+/);
        assert.equal(await evaluate(() => localStorage.getItem("terrain-editor/unsaved-v1")), invalid);
        report.checks.invalidDraft = { empty: true, draftUnchanged: true };

        check("Retry a failed first save and retain edits made before its stream closes");
        await click(".empty-actions button:first-child");
        await filename("未命名");
        await prompt("第一次保存的原稿。");
        const target = "首次 D.json";
        await set({ fail: true, saveName: target });
        await click("#save");
        await status("保存失败");
        await filename("未命名");
        assert.equal(JSON.parse((await draft())!.text).prompt, "第一次保存的原稿。");
        await set({ fail: false, hold: true });
        await click("#save");
        await status("正在保存");
        await prompt("写入期间的中间步骤。");
        await prompt("写入期间的最后一步。");
        assert.equal(await prop("writes"), 2);
        assert.equal(JSON.parse((await draft())!.text).prompt, "写入期间的最后一步。");
        await evaluate(() => window.probe.release!());
        await filename(target);
        await saved(3);
        assert.equal(JSON.parse(await disk(target)).prompt, "写入期间的最后一步。");
        assert.deepEqual(await prop("suggestions"), ["project.json", "project.json"]);
        assert.deepEqual(await storage(), cleanStorage);
        report.checks.firstSave = { failedBeforeBinding: true, editsDuringFirstWrite: 2, successfulWrites: await prop("closes") };

        check("Inspect both v5 maps and sections, select a layer and save a variable change");
        for (const [key, raw] of [["coast", fixture], ["land", await readFixture("round14-land.json")]]) {
            const name = key + ".json", design = parseDesign(raw);
            await navigate();
            await seed(name, raw);
            await set({ openName: name });
            await click("#open");
            await filename(name);
            await click("[data-tab=terrain]");
            assert.deepEqual(await evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-geo-node]")].map(b => b.dataset.geoNode)),
                design.geoNodes.toReversed().map(n => n.id));
            const layer = design.geoNodes.at(-1)!;
            await click("[data-geo-node]");
            await wait(id => document.querySelector<HTMLElement>("[data-geo-node][aria-pressed=true]")?.dataset.geoNode === id, layer.id);
            assert.equal(await evaluate(() => document.querySelectorAll("#plots canvas").length), design.sections.length);
            const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
            await writeFile(join(artifactDir, key + ".png"), Buffer.from(screenshot.data, "base64"));
            const [variable, rule] = Object.entries(design.inputs).find(([id, v]) => id !== seedId && typeof v.value === "number")!;
            const [min, max, step] = rule.range!, current = Number(rule.value), direction = current + step <= max ? 1 : -1;
            const value = Number((current + direction * step).toPrecision(15));
            assert(value >= min);
            await click("[data-tab=inputs]");
            const selector = "[data-input=" + JSON.stringify(variable) + "]";
            const [x, y] = await evaluate(s => {
                const button = document.querySelector<HTMLElement>(s)!;
                button.scrollIntoView({ block: "nearest" });
                const box = button.getBoundingClientRect();
                return [box.x + box.width / 2, box.y + box.height / 2];
            }, selector + (direction > 0 ? " .step[aria-label^=增大]" : " .step"));
            await mouse("mousePressed", x, y);
            await wait(({ selector, value }) => Number(document.querySelector(selector + " .numeric-face")?.textContent) === value, { selector, value });
            assert.equal(await prop("writes"), 0);
            await mouse("mouseReleased", x, y);
            await saved(1);
            assert.equal(parseDesign(await disk(name)).inputs[variable].value, value);
            report.checks[key] = { layers: design.geoNodes.length, selected: layer.id, sections: design.sections.length, variable, value };
        }
        check("Reject an older file without replacing the active v5 design");
        const older = "earlier.json";
        await seed(older, JSON.stringify({ version: 4 }));
        await set({ openName: older });
        await click("#open");
        await wait(() => document.querySelector("#toast")?.textContent?.includes("不支持的版本"));
        await filename("land.json");
        assert.equal(await prop("writes"), 1);
        report.checks.older = { active: "land.json", message: await evaluate(() => document.querySelector("#toast")!.textContent) };

        check("Show omitted numbers and edit point geometry on the map");
        const sparse = syntheticDesign();
        Reflect.deleteProperty(sparse.geoNodes[1].function, "amount");
        sparse.fields.F = { label: "F" };
        sparse.sections = [{ id: "A", label: "A", points: [[6, 12], [24, 12]] }];
        await navigate();
        await seed("sparse.json", JSON.stringify(sparse));
        await set({ openName: "sparse.json" }); await click("#open"); await filename("sparse.json");
        await click("[data-tab=terrain]");
        assert.match(await evaluate(() => document.querySelector("[data-geo-node=\"T\"]")!.textContent!), /flat\s*\+\s*1\b/);
        await click("[data-geo-node=\"T\"]");
        await click("[data-property-tab=function]");
        assert.match(await evaluate(() => document.querySelector("[data-parameter$=\".function.amount\"] .numeric-face")!.textContent!.trim()), /^1(?:\.0+)?$/);
        await click("[data-tab=inputs]");
        assert.equal(await evaluate(() => document.querySelector("[data-select-field=\"F\"]")!.textContent!.trim()), "F");
        const [sx, sy] = await mapPoint(sparse, sparse.sections[0].points[0]);
        await mouse("mousePressed", sx, sy);
        await mouse("mouseReleased", sx, sy);
        await click("[data-property-tab=section]");
        const control = "#properties .geometry-box[aria-label=剖面线]";
        await click(control);
        assert.equal(await evaluate(s => document.querySelector(s)!.getAttribute("aria-pressed"), control), "true");
        assert.equal(await evaluate(() => [...document.querySelectorAll("#properties .number-label")].filter(n => /^(中心 )?[XY]$/.test(n.textContent!)).length), 0);
        assert.equal(await evaluate(() => document.querySelectorAll("[title]").length), 0);
        assert.equal(await prop("writes"), 0);
        report.checks.sparseGeometry = { flat: 1, field: "F", geometryRows: 1 };
        check("Unsupported browser");
        await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "window.showSaveFilePicker = undefined" });
        await navigate();
        assert.equal(await evaluate(() => document.querySelector(".empty-state > div")!.textContent), "需要 Chrome 或 Edge");
        assert(await evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("#new,#open,#save,.empty-actions button")].every(el => el.disabled)));
        await key("s", 2);
        assert.equal(await prop("opens"), 0);
        assert.deepEqual(await prop("suggestions"), []);
        report.checks.unsupported = { message: "需要 Chrome 或 Edge", disabled: true };
        await writeFile(join(artifactDir, "browser-results.json"), JSON.stringify(report, null, 2));
    }
    catch (error) {
        console.error("Failed browser step", step, await evaluate(() => ({ file: document.querySelector("#filename")?.textContent,
            status: document.querySelector("#save-state")?.textContent, toast: document.querySelector("#toast")?.textContent, events: window.probe?.events })));
        throw error;
    }
    finally {
        await browser.close();
    }
}