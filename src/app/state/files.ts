import { flushSync } from "svelte";
import { History } from "../../core/edit/history.ts";
import { serializeDesign } from "../../core/design/model.ts";
import { newDesign } from "../../core/design/newDesign.ts";
import { type Design, errorText } from "../types.ts";
import { FileWrites, type WriteHandle } from "./fileWrites.ts";
import { commitFocusedInput } from "./pendingInput.ts";
import * as session from "./session.svelte.ts";

const draftKey = "terrain-editor/unsaved-v1";
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
    private unbound = false;
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
        catch {
            return;
        }
        if (stored === null) return;
        try {
            const draft: unknown = JSON.parse(stored);
            if (!draft || typeof draft !== "object" || !("text" in draft) || typeof draft.text !== "string")
                throw Error("缺少项目设计");
            const filename = "filename" in draft && typeof draft.filename === "string" && draft.filename || "project.json";
            const unbound = "unbound" in draft && draft.unbound === true;
            const dirty = !unbound || !("dirty" in draft) || draft.dirty !== false;
            const pending = "pending" in draft && typeof draft.pending === "string" ? draft.pending : undefined;
            await this.restore(draft.text, filename, unbound, dirty, pending);
        }
        catch (error) {
            this.editor.message("草稿无法恢复：" + errorText(error));
        }
    }
    remember(pending?: Design | string) {
        const e = this.editor, keep = this.unbound || e.dirty || pending !== undefined;
        try {
            if (keep) localStorage.setItem(draftKey, JSON.stringify({
                text: e.history.states[e.history.index], date: new Date().toISOString(), filename: e.filename,
                pending: typeof pending === "string" ? pending : pending && serializeDesign(pending),
                ...(this.unbound && { unbound: true, dirty: e.history.dirty })
            }));
            else localStorage.removeItem(draftKey);
        }
        catch {
            if (keep) e.message("浏览器草稿空间不可用，请保存到文件");
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
    private restore(text: string, filename: string, unbound: boolean, dirty: boolean, pending?: string) {
        const e = this.editor;
        return e.working("正在恢复草稿…", async () => {
            let recovered = false;
            if (pending !== undefined) {
                try {
                    await this.install(pending, filename, { unbound, recovered: "dirty" });
                    recovered = true;
                }
                catch {
                    // A staged edit can fail worker validation. The previous draft is still available.
                }
            }
            if (!recovered) await this.install(text, filename, { unbound, recovered: dirty ? "dirty" : "clean" });
            e.message("已恢复未保存的草稿");
        }, error => e.message("草稿无法恢复：" + errorText(error)));
    }
    private install(design: Design | string, filename: string, source: {
        handle?: DesignHandle; writable?: boolean; original?: string; unbound?: boolean; recovered?: "clean" | "dirty";
    } = {}) {
        const e = this.editor;
        return session.timed("terrain-editor:first", async () => {
            const project = await e.replace(design, true);
            const history = new History(project.design);
            if (source.recovered === "dirty") history.saved = "";
            const original = source.original !== undefined && typeof design === "string" &&
                serializeDesign(project.design) === JSON.stringify(JSON.parse(design), null, 2) ? source.original : null;
            this.writes.reset();
            this.handle = source.handle ?? null;
            this.writable = source.writable ?? false;
            this.original = original;
            this.unbound = source.unbound ?? false;
            this.suggestedName = source.recovered && !this.unbound ? filename : "project.json";
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
        if (e.busy) await e.finishWork();
        if (e.busy || e.gesture) return;
        if (e.history?.dirty && !confirmed) {
            e.fileRequest = action;
            return;
        }
        const label = action === "new" ? "正在新建设计…" : "正在打开项目设计…";
        return e.working(label, async () => {
            if (action === "new") {
                const box = e.map?.canvas?.getBoundingClientRect();
                await this.install(newDesign(box && [box.width * .1, box.height * .9]), "未命名", { unbound: true });
                e.message("已新建设计");
            }
            else {
                const [handle] = await window.showOpenFilePicker!({ types, multiple: false });
                await this.open(handle);
            }
        }, error => {
            if (!cancelled(error)) e.message((action === "new" ? "新建失败：" : "打开失败：") + errorText(error));
        });
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
        await this.install(text.replace(/^\uFEFF/, ""), file.name, { handle, writable, original: text });
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
                this.unbound = false;
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
        if (e.busy) await e.finishWork();
        if (e.busy) return;
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