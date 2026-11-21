import { flushSync, tick } from "svelte";
import { History } from "../../core/edit/history.js";
import { parseDesign, serializeDesign } from "../../core/design/model.ts";
import * as session from "./session.svelte";
import { errorText } from "../types";

const draftKey = "terrain-editor/unsaved-v1";
const example = new URL("../../../examples/island.json", import.meta.url);
const types = [{ description: "海岛设计 JSON", accept: { "application/json": [".json"] } }];
interface DesignHandle {
    name: string;
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }>;
}
declare global {
    interface Window {
        showOpenFilePicker?: (options: { types: typeof types; multiple: boolean }) => Promise<DesignHandle[]>;
    }
}

export class DesignFiles {
    private editor: session.Editor;
    private handle: DesignHandle | null = null;
    private writes: Promise<void> = Promise.resolve();

    constructor(editor: session.Editor) {
        this.editor = editor;
    }

    async start() {
        const e = this.editor;
        try {
            const response = await fetch(example, { cache: "no-cache" });
            if (!response.ok) throw new Error("island.json 读取失败（" + response.status + "）");
            const design = parseDesign(await response.text());
            e.map.resize();
            session.timed("terrain-editor:first", () => {
                e.history = new History(design) as session.Editor["history"];
                e.replace(design, true);
                flushSync();
            });
            try {
                const stored = localStorage.getItem(draftKey);
                if (stored) {
                    const draft = JSON.parse(stored);
                    parseDesign(draft.text);
                    e.draft = draft;
                }
            }
            catch {
                e.draft = null;
            }
            e.busy = null;
            if (e.draft) {
                await tick();
                document.getElementById("restore")?.focus();
            }
            else e.syncHistory();
        }
        catch (error) {
            e.busy = "无法打开编辑器 · " + errorText(error);
            console.error(error);
        }
    }
    remember() {
        const e = this.editor;
        try {
            if (e.dirty) localStorage.setItem(draftKey, JSON.stringify({ text: e.history.states[e.history.index], date: new Date().toISOString(), filename: e.filename }));
            else localStorage.removeItem(draftKey);
        }
        catch {
            if (e.dirty) e.message("浏览器草稿空间不可用，请保存到文件");
        }
    }
    discard() {
        this.editor.draft = null;
        this.editor.syncHistory();
    }
    restore() {
        const e = this.editor, draft = e.draft;
        if (!draft) return;
        e.draft = null;
        return e.working("正在恢复草稿…", () => {
            e.replace(parseDesign(draft.text), true);
            e.filename = draft.filename ?? "island.json";
            this.handle = null;
            e.record();
            e.message("已恢复未保存的草稿");
        });
    }
    private download(text: string) {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = this.editor.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    exportCopy() {
        if (!this.editor.island) return;
        this.download(serializeDesign(this.editor.island.design));
        this.editor.message("已导出设计副本");
    }
    async save() {
        const e = this.editor;
        if (!e.history || e.busy) return;
        const text = serializeDesign(e.island.design), island = e.island, handle = this.handle;
        const write = async () => {
            try {
                if (handle) {
                    const writer = await handle.createWritable();
                    await writer.write(text);
                    await writer.close();
                }
                else this.download(text);
                if (island !== e.island || handle !== this.handle) return;
                e.history.saved = text;
                e.syncHistory();
                e.message("已保存 " + e.filename);
            }
            catch (error) {
                if (!(error instanceof DOMException && error.name === "AbortError")) e.message("保存失败 · " + errorText(error));
            }
        };
        this.writes = this.writes.then(write);
        await this.writes;
    }
    async open(file: File, handle: DesignHandle | null = null) {
        const e = this.editor;
        try {
            const design = parseDesign(await file.text());
            await e.working("正在导入海岛设计…", () => {
                e.replace(design, true);
                e.history.record(design);
                e.history.saved = e.history.states[e.history.index];
                this.handle = handle;
                e.filename = file.name;
                e.syncHistory();
                e.message("已导入 " + e.filename);
            });
        }
        catch (error) {
            e.message("导入失败 · " + errorText(error));
        }
    }
    async pick(input: HTMLInputElement) {
        if (this.editor.busy) return;
        if (!window.showOpenFilePicker) {
            input.click();
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({ types, multiple: false });
            await this.open(await handle.getFile(), handle);
        }
        catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) this.editor.message("导入失败 · " + errorText(error));
        }
    }
}