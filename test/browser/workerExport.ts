import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseDesign } from "../../src/core/design/model.ts";
import { exportProject } from "../../src/core/export.ts";
import { Project } from "../../src/core/project.ts";
import { decodePreview, readNpy, readProject, readZip } from "../exportFiles.ts";
import { syntheticDesign } from "../scenarios.ts";
import { createBrowserServer } from "./chromium.ts";
import { withCurveMap } from "./curveMapFixture.ts";

export async function checkWorkerExport(url: string, commit: string, shared: boolean) {
    const design = syntheticDesign(), authored = "导出时尚未保存的项目描述。", filename = "交付 A.zip";
    const scene = "export-terrain", output = "已导出“" + filename + "”";
    design.prompt = "打开文件时的项目描述。";
    design.geoNodes[0].function = { type: "ground", value: 4.12532 };
    design.marks.push({ id: "A", kind: "text", label: "A", point: [2.1234, 3.5678], follow: "map" });
    await withCurveMap(url, scene, async ({ cdp, click, evaluate, idle, saved, wait, text, disk }) => {
        const read = async (name = filename) => Uint8Array.from(await evaluate(async name => {
            const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle(name);
            return Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
        }, name));
        const snapshot = () => evaluate(() => {
            const e = window.curveMapProbe.editor!;
            return { index: e.history.index, saved: e.history.saved, states: e.history.states, filename: e.filename, saveState: e.saveState };
        });
        await evaluate(value => {
            window.probe.fail = true;
            window.curveMapProbe.editor!.describe({ group: "design" }, value);
        }, authored);
        await wait(() => document.querySelector("#save-state")?.textContent === "保存失败");
        const pending = await snapshot();
        assert.equal(JSON.parse(pending.states[pending.index]).prompt, authored);
        assert.equal(JSON.parse(await disk()).prompt, design.prompt);

        const state = await evaluate(async () => {
            const { project } = window.curveMapProbe.editor!, array = project.terrain.fields.height.values;
            return { isolated: crossOriginIsolated, shared: typeof SharedArrayBuffer !== "undefined" && array.buffer instanceof SharedArrayBuffer,
                issues: project.issues, ...await window.terrainFieldHashes!() };
        });
        assert.deepEqual([state.isolated, state.shared, state.helpers > 0], [shared, shared, shared]);
        await evaluate(filename => {
            window.probe.fail = false;
            window.probe.cancel = true;
            window.probe.saveName = filename;
            const pick = window.showSaveFilePicker!.bind(window);
            window.showSaveFilePicker = options => {
                const accept = options.types[0].accept;
                if (!("application/zip" in accept) || !accept["application/zip"].includes(".zip")) throw Error("Missing ZIP file filter");
                return pick(options);
            };
        }, filename);

        const writes = await evaluate(() => window.probe.writes);
        await click("#export");
        await idle();
        assert.deepEqual(await evaluate(() => window.probe.suggestions), [scene + "-export.zip"]);
        assert.equal(await evaluate(() => window.probe.writes), writes);
        assert.deepEqual(await snapshot(), pending);

        await evaluate(() => {
            window.probe.cancel = false;
            window.probe.hold = true;
        });
        await click("#export");
        await wait(() => window.probe.release !== null && document.querySelector("#toast")?.textContent === "正在导出…");
        assert(await evaluate(() => !!document.querySelector(".inspector[inert]") && ["export", "save", "new", "open", "undo", "redo"]
            .every(id => document.querySelector<HTMLButtonElement>("#" + id)?.disabled)));
        assert.deepEqual(await snapshot(), pending);
        await evaluate(() => window.probe.release!());
        await wait(message => document.querySelector("#toast")?.textContent === message &&
            !document.querySelector<HTMLButtonElement>("#export")?.disabled, output);
        assert.equal(await text("#toast"), output);
        assert.deepEqual(await snapshot(), pending);

        const project = new Project(parseDesign({ ...design, prompt: authored }));
        const { values, defined } = project.terrain.fields.height;
        const hash = (data: Float32Array | Uint8Array) =>
            createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
        assert.deepEqual(state.fields.height, { values: hash(values), defined: hash(defined) });
        assert.deepEqual(state.issues, JSON.parse(JSON.stringify(project.issues)));

        const bytes = await read(), actual = readZip(bytes), expected = readZip(await exportProject(project, commit));
        assert.deepEqual([...actual.keys()], [...expected.keys()]);
        assert.equal(readProject(actual).prompt, authored);
        for (const [path, data] of expected) {
            const file = actual.get(path)!;
            if (path === "preview.png") assert.deepEqual(decodePreview(file), decodePreview(data));
            else assert.deepEqual(file, data, path);
        }

        if (shared) {
            const editedName = "交付 B.zip", newValue = 11, numeric = "[data-input=A] .numeric-edit";
            await click("[data-tab=inputs]");
            await click("[data-input=A] .numeric-face");
            await wait(selector => document.activeElement?.matches(selector), numeric);
            await evaluate(() => document.getSelection()!.selectAllChildren(document.activeElement!));
            await cdp("Input.insertText", { text: String(newValue) });
            assert.equal(await text(numeric), String(newValue));
            assert.deepEqual(await snapshot(), pending);

            await evaluate(name => {
                window.probe.saveName = name;
                const pick = window.showSaveFilePicker!.bind(window);
                window.showSaveFilePicker = options => {
                    if (window.curveMapProbe.editor!.finishWork()) window.probe.events.push("export-picker-during-edit");
                    return pick(options);
                };
            }, editedName);
            await click("#export");
            await wait(name => document.querySelector("#toast")?.textContent === "已导出“" + name + "”", editedName);
            await saved();
            assert(await evaluate(() => window.probe.events.includes("export-picker-during-edit")));
            const committed = await snapshot();
            assert.equal(committed.index, pending.index + 1);

            const editedBytes = await read(editedName), edited = readZip(editedBytes), info = readProject(edited);
            const editedDesign = parseDesign(new TextDecoder().decode(edited.get(info.source.design)!));
            assert.equal(editedDesign.inputs.A.value, newValue);
            const index = project.terrain.grid.index(-14, -8);
            const before = readNpy(actual.get(info.terrain.heights.file)!).view.getFloat32(index * 4, true);
            const changed = readNpy(edited.get(info.terrain.heights.file)!).view.getFloat32(index * 4, true);
            assert.notEqual(changed, before);
            assert.equal(changed, new Project(editedDesign).terrain.fields.height.values[index]);

            await evaluate(() => {
                const pick = window.showSaveFilePicker!.bind(window);
                window.showSaveFilePicker = async options => {
                    const handle = await pick(options), create = handle.createWritable.bind(handle);
                    handle.createWritable = async () => {
                        const stream = await create(), write = stream.write.bind(stream);
                        stream.write = async contents => {
                            if (typeof contents !== "string") await write(contents.subarray(0, 32));
                            throw Error("文件写入中断");
                        };
                        return stream;
                    };
                    return handle;
                };
            });
            await click("#export");
            await wait(() => document.querySelector("#toast")?.textContent === "导出失败：文件写入中断");
            await idle();
            assert.deepEqual(await read(editedName), editedBytes);
            assert.deepEqual(await snapshot(), committed);

            await evaluate(async () => {
                await window.curveMapProbe.editor!.files.choose("new", true);
                window.probe.cancel = true;
            });
            await click("#export");
            await idle();
            assert.equal(await evaluate(() => window.probe.suggestions.at(-1)), "project-export.zip");
        }
    }, design);
}

export async function checkUnsharedExport() {
    const server = await createBrowserServer(false);
    try {
        await server.listen();
        const commit: string = JSON.parse(server.config.define!.__GROUNDWORK_COMMIT__);
        await checkWorkerExport(server.resolvedUrls!.local[0], commit, false);
    }
    finally {
        await server.close();
    }
}