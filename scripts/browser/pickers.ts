export interface Probe {
    openName: string;
    saveName: string;
    permission: PermissionState;
    cancel: boolean;
    fail: boolean;
    hold: boolean;
    release: (() => void) | null;
    exampleReads: number;
    opens: number;
    writes: number;
    closes: number;
    suggestions: string[];
    events: string[];
}
declare global {
    interface Window {
        probe: Probe;
        disk(name: string): Promise<string>;
    }
}

// Installed before the editor loads on every navigation. Only the pickers, permission decision,
// example response and injected failures are simulated. Successful writes close real OPFS streams.
export function installPickers() {
    const state: Probe = {
        openName: "海岛 A.json", saveName: "新岛 B.json", permission: "granted", cancel: false,
        fail: false, hold: false, release: null, exampleReads: 0, opens: 0, writes: 0, closes: 0, suggestions: [], events: []
    };
    window.probe = state;
    window.disk = async name => {
        const root = await navigator.storage.getDirectory(), file = await root.getFileHandle(name);
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await (await file.getFile()).arrayBuffer());
    };
    async function handle(name: string, create: boolean) {
        const root = await navigator.storage.getDirectory(), file = await root.getFileHandle(name, { create });
        const read = file.getFile.bind(file), write = file.createWritable.bind(file);
        return Object.assign(file, {
            requestPermission: async ({ mode }: { mode: "readwrite" }) => {
                state.events.push("permission:" + mode);
                return state.permission;
            },
            getFile: async () => {
                state.events.push("read");
                return read();
            },
            createWritable: async () => {
                state.events.push("write");
                state.writes++;
                if (state.hold) {
                    state.hold = false;
                    await new Promise<void>(resolve => state.release = resolve);
                }
                if (state.fail) throw new DOMException("文件暂时被占用", "NoModificationAllowedError");
                const stream = await write(), close = stream.close.bind(stream);
                return Object.assign(stream, { async close() {
                    await close();
                    state.closes++;
                } });
            }
        });
    }
    window.showOpenFilePicker = async options => {
        if (options.multiple || !options.types[0].accept["application/json"].includes(".json")) throw Error("Invalid open picker options");
        state.opens++;
        state.events.push("open");
        return [await handle(state.openName, false)];
    };
    window.showSaveFilePicker = async options => {
        state.suggestions.push(options.suggestedName);
        if (state.cancel) throw new DOMException("Cancelled", "AbortError");
        return handle(state.saveName, true);
    };
    // The author's private examples/island.json stays outside regression fixtures.
    const fetchFile = window.fetch.bind(window);
    window.fetch = (resource, options) => {
        if (new URL(resource instanceof Request ? resource.url : resource, location.href).pathname === "/examples/island.json") {
            state.exampleReads++;
            return fetchFile("/.local/fixtures/round14-coast.json", options);
        }
        return fetchFile(resource, options);
    };
}