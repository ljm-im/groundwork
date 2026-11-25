import { flushSync } from "svelte";
import { History } from "../../core/edit/history.ts";
import { parseDesign, serializeDesign } from "../../core/design/model.ts";
import { type Design, errorText } from "../types.ts";
import { FileWrites, type WriteHandle } from "./fileWrites.ts";
import { commitFocusedInput } from "./pendingInput.ts";
import * as session from "./session.svelte.ts";

const draftKey = "terrain-editor/unsaved-v1";
import { newDesign } from "../../core/design/newDesign.ts";
const types = [{ description: "项目设计 JSON", accept: { "application/json": [".json"] } }];
const permissionWarning = "未获得写入权限，修改不会写入文件";

interface DesignHandle extends WriteHandle {
    name: string;
    getFile(): Promise<File>;
    requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}
declare global {
    interface Window {
        showOpenFilePicker?: (options: { types: typeof types; multiple: boolean }) => Promise<DesignHandle[]>;
        showSaveFilePicker?: (options: { types: typeof types; suggestedName: string }) => Promise<DesignHandle>;
    }
}

export type FileAction = "new" | "open";
export type SaveState = "已保存" | "未保存" | "正在保存" | "保存失败";

function cancelled(error: unknown) {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export class DesignFiles {
    private editor: session.Editor;
    readonly supported = typeof window !== "undefined" && typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";
    private handle: DesignHandle | null = null;
    private writable = false;
    private original: string | null = null;
    private suggestedName = "project.json";
    private choosingSaveFor: History | null = null;
    private writes = new FileWrites();

    constructor(editor: session.Editor) {
        this.editor = editor;
    }
    async start() {
        if (!this.supported) return;
        let stored: string | null;
        try {
            stored = localStorage.getItem(draftKey);
        }
        catch { return; }
        if (stored === null) return;
        try {
            const draft: unknown = JSON.parse(stored);
            if (!draft || typeof draft !== "object" || !("text" in draft) || typeof draft.text !== "string")
                throw Error("缺少项目设计");
            const filename = "filename" in draft && typeof draft.filename === "string" && draft.filename || "project.json";
            await this.restore(draft.text, filename);
        }
        catch (error) {
            this.editor.message("草稿无法恢复：" + errorText(error));
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
    private status(state: SaveState) {
        const e = this.editor;
        e.saveState = state;
        e.dirty = e.history.dirty || state === "正在保存" || state === "保存失败";
        this.remember();
    }
    syncHistory(changed: boolean) {
        const e = this.editor;
        if (changed) {
            this.original = null;
            if (this.handle && this.writable) {
                void this.writeTo(this.handle);
                return;
            }
        }
        if (e.saveState === "正在保存" || !changed && e.saveState === "保存失败") this.status(e.saveState);
        else this.status(e.history.dirty || this.handle && !this.writable ? "未保存" : "已保存");
    }
    private restore(text: string, filename: string) {
        const e = this.editor, design = parseDesign(text, true);
        return e.working("正在恢复草稿…", () => {
            try {
                this.install(design, filename, { recovered: true });
            }
            catch (error) {
                e.message("草稿无法恢复：" + errorText(error));
                return;
            }
            e.message("已恢复未保存的草稿");
        });
    }
    private install(design: Design, filename: string, source: { handle?: DesignHandle; writable?: boolean; original?: string | null; recovered?: boolean } = {}) {
        const e = this.editor, history = new History(design);
        if (source.recovered) history.saved = "";
        session.timed("terrain-editor:first", () => {
            e.replace(design, true);
            this.writes.reset();
            this.handle = source.handle ?? null;
            this.writable = source.writable ?? false;
            this.original = source.original ?? null;
            this.suggestedName = source.recovered ? filename : "project.json";
            this.choosingSaveFor = null;
            e.history = history;
            e.filename = filename;
            e.saveState = "已保存";
            e.syncHistory();
            flushSync();
        });
    }
    async choose(action: FileAction, confirmed = false) {
        const e = this.editor;
        if (!this.supported || e.busy || e.gesture) return;
        commitFocusedInput();
        if (e.dirty && !confirmed) {
            e.fileRequest = action;
            return;
        }
        e.busy = action === "new" ? "正在新建设计…" : "正在打开项目设计…";
        try {
            if (action === "new") {
                const box = e.map?.canvas?.getBoundingClientRect();
                this.install(newDesign(box && [box.width * .1, box.height * .9]), "未命名");
                e.message("已新建设计");
            }
            else {
                const [handle] = await window.showOpenFilePicker!({ types, multiple: false });
                await this.open(handle);
            }
        }
        catch (error) {
            if (!cancelled(error)) e.message((action === "new" ? "新建失败：" : "打开失败：") + errorText(error));
        }
        finally {
            e.busy = null;
        }
    }
    private async permission(handle: DesignHandle) {
        try {
            return await handle.requestPermission({ mode: "readwrite" }) === "granted";
        }
        catch {
            return false;
        }
    }
    async open(handle: DesignHandle) {
        const writable = await this.permission(handle);
        const file = await handle.getFile();
        // Keep a UTF-8 BOM, original whitespace and line endings for an untouched design.
        const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await file.arrayBuffer());
        const json = text.replace(/^\uFEFF/, ""), design = parseDesign(json, true);
        const original = serializeDesign(design) === JSON.stringify(JSON.parse(json), null, 2) ? text : null;
        this.install(design, file.name, { handle, writable, original });
        this.editor.message(writable ? "已打开“" + file.name + "”" : permissionWarning);
    }
    private writeTo(target: DesignHandle, manual = false) {
        const e = this.editor, handle = this.handle, history = e.history, project = e.project;
        const canonical = history.states[history.index];
        this.status("正在保存");
        return this.writes.request(target, this.original ?? canonical, result => {
            if (project !== e.project || handle !== this.handle) {
                // Undo and terrain edits can rebuild the Project within the same file and history.
                if (history !== e.history || handle !== this.handle) return;
            }
            if (!result.ok) {
                this.status("保存失败");
                e.message("保存失败：" + errorText(result.error));
                return;
            }
            if (!handle) {
                this.handle = target;
                this.writable = true;
                e.filename = target.name;
            }
            history.saved = canonical;
            // Edits during the first save only joined a draft until this close bound the file.
            if (!this.writable) this.status("未保存");
            else if (history.dirty) void this.writeTo(target, manual);
            else {
                this.status("已保存");
                if (manual || e.toast?.text === permissionWarning || e.toast?.text.startsWith("保存失败：")) e.message("已保存“" + e.filename + "”");
            }
        });
    }
    async save() {
        const e = this.editor;
        if (!e.project || e.busy || e.gesture || e.fileRequest) return;
        commitFocusedInput();
        const history = e.history, handle = this.handle;
        if (!handle && this.choosingSaveFor === history) return;
        if (!handle) this.choosingSaveFor = history;
        try {
            if (handle) {
                const writable = await this.permission(handle);
                if (history !== e.history || handle !== this.handle) return;
                this.writable = writable;
                if (!writable) {
                    if (e.saveState !== "正在保存") this.status("未保存");
                    e.message(permissionWarning);
                    return;
                }
                await this.writeTo(handle, true);
            }
            else {
                if (!this.supported) return;
                const target = await window.showSaveFilePicker!({ types, suggestedName: this.suggestedName });
                if (history === e.history) await this.writeTo(target, true);
            }
        }
        catch (error) {
            if (history === e.history && !cancelled(error)) {
                this.status("保存失败");
                e.message("保存失败：" + errorText(error));
            }
        }
        finally {
            if (!handle && this.choosingSaveFor === history) this.choosingSaveFor = null;
        }
    }
}