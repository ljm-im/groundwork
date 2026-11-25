import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { type Readable, type Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

interface ExceptionDetails { text: string; exception?: { description?: string } }
interface Replies {
    "Browser.getVersion": { product: string };
    "Target.createTarget": { targetId: string };
    "Target.attachToTarget": { sessionId: string };
    "Target.getTargets": { targetInfos: { targetId: string }[] };
    "Runtime.evaluate": { result: { value?: unknown }; exceptionDetails?: ExceptionDetails };
    "Page.captureScreenshot": { data: string };
}
type Reply<Method extends string> = Method extends keyof Replies ? Replies[Method] : unknown;
type Params = Record<string, unknown>;

export type Chromium = Awaited<ReturnType<typeof startChromium>>;

export async function startChromium() {
    const paths = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome", "/usr/bin/chromium"];
    const executable = paths.find(path => path && existsSync(path));
    if (!executable) throw Error("Set CHROME_PATH to a Chromium executable.");
    const profile = await mkdtemp(join(tmpdir(), "groundwork-files-"));
    const child = spawn(executable, ["--headless", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check",
        "--disable-background-timer-throttling", "--user-data-dir=" + profile, "about:blank"],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    let id = 0, sessionId: string | undefined, targetId: string | undefined, buffer = Buffer.alloc(0);
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const errors: string[] = [], dialogs: string[] = [];
    const input = child.stdio[3] as Writable, output = child.stdio[4] as Readable;
    const exited = new Promise(resolve => child.once("exit", resolve));
    function send<M extends string>(method: M, params: Params = {}, session?: string): Promise<Reply<M>> {
        const number = ++id;
        return new Promise((resolve, reject) => {
            pending.set(number, { resolve: value => resolve(value as Reply<M>), reject });
            input.write(JSON.stringify({ id: number, method, params, sessionId: session }) + "\0");
        });
    }
    output.on("data", (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        let split;
        while ((split = buffer.indexOf(0)) >= 0) {
            const packet = JSON.parse(buffer.subarray(0, split).toString());
            buffer = buffer.subarray(split + 1);
            const request = pending.get(packet.id);
            if (request) {
                pending.delete(packet.id);
                if (packet.error) request.reject(Error(packet.error.message));
                else request.resolve(packet.result);
            }
            if (packet.method === "Page.javascriptDialogOpening" && packet.params.type === "beforeunload") {
                dialogs.push(packet.params.type);
                void send("Page.handleJavaScriptDialog", { accept: true }, packet.sessionId);
            }
            if (packet.method === "Runtime.exceptionThrown") errors.push(packet.params.exceptionDetails.exception?.description ?? packet.params.exceptionDetails.text);
        }
    });
    child.on("exit", code => {
        for (const request of pending.values()) request.reject(Error("Chromium exited with " + code));
        pending.clear();
    });
    const cdp = <M extends string>(method: M, params?: Params) => send(method, params, sessionId);
    async function evaluate<A = void, T = unknown>(fn: (value: A) => T, value?: A): Promise<Awaited<T>> {
        const response = await cdp("Runtime.evaluate", {
            expression: "(" + fn.toString() + ")(" + (JSON.stringify(value) ?? "") + ")",
            awaitPromise: true, returnByValue: true
        });
        if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
        return response.result.value as Awaited<T>;
    }
    async function wait<A = void>(fn: (value: A) => unknown, value?: A) {
        for (let i = 0; i < 200; i++) {
            if (await evaluate(fn, value)) return;
            await delay(30);
        }
        throw Error("Timed out waiting for " + fn + " " + JSON.stringify(value) + "\n" + await evaluate(() => document.body.innerText.slice(0, 950)));
    }
    async function mouse(type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number) {
        await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    }
    async function click(selector: string) {
        const [x, y] = await evaluate(s => {
            const el = document.querySelector<HTMLButtonElement>(s);
            if (!el || el.disabled) throw Error("Unavailable control " + s);
            el.scrollIntoView({ block: "nearest" });
            const box = el.getBoundingClientRect();
            return [box.x + box.width / 2, box.y + box.height / 2];
        }, selector);
        await mouse("mousePressed", x, y);
        await mouse("mouseReleased", x, y);
    }
    async function key(key: string, modifiers = 0) {
        const code = key.length === 1 ? "Key" + key.toUpperCase() : key;
        const special: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, Delete: 46 };
        const windowsVirtualKeyCode = special[key] ?? key.toUpperCase().charCodeAt(0);
        for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", {
            type, key, code, modifiers, windowsVirtualKeyCode, ...(type === "keyDown" && key === "Enter" && { text: "\r" })
        });
    }
    async function screenshot(name: string, clip?: { x: number; y: number; width: number; height: number }) {
        const dir = process.env.GROUNDWORK_BROWSER_OUTPUT;
        if (!dir) return;
        await mkdir(dir, { recursive: true });
        const { data } = await cdp("Page.captureScreenshot", { format: "png", ...(clip && { clip: { ...clip, scale: 1 } }) });
        await writeFile(join(dir, name + ".png"), Buffer.from(data, "base64"));
    }
    async function openTab() {
        ({ targetId } = await send("Target.createTarget", { url: "about:blank" }));
        sessionId = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
        await cdp("Page.enable");
        await cdp("Runtime.enable");
        await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    }
    async function closeTab() {
        const closing = targetId;
        await cdp("Page.close");
        for (let i = 0; i < 200; i++) {
            const { targetInfos } = await send("Target.getTargets");
            if (targetInfos.every(target => target.targetId !== closing)) {
                targetId = sessionId = undefined;
                return;
            }
            await delay(30);
        }
        throw Error("Timed out waiting for Chromium to close the test tab");
    }
    async function close() {
        try {
            if (child.exitCode === null) await send("Browser.close");
        }
        finally {
            await exited;
            if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("groundwork-files-")) {
                await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
            }
        }
        assert.deepEqual(errors, [], "Uncaught browser errors");
    }
    try {
        const version = (await send("Browser.getVersion")).product;
        await openTab();
        return { version, dialogs, cdp, evaluate, wait, click, mouse, key, screenshot, openTab, closeTab, close };
    }
    catch (error) {
        await close();
        throw error;
    }
}