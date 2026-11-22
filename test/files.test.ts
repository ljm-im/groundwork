import { test } from "node:test";
import "../configs/register-svelte.ts";
import { History } from "../src/core/edit/history.ts";
import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { createHash } from "node:crypto";
import { FileWrites } from "../src/app/state/fileWrites.ts";

test("Authored and default designs survive a JSON round trip", async () => {
    const original = await readFixture("round5.json");
    const author = parseDesign(original);
    const current = await readFixture("round5-default.json");
    const design = parseDesign(current);
    assert.deepEqual(JSON.parse(serializeDesign(design)), JSON.parse(current));
    assert.deepEqual(parseDesign(serializeDesign(author)), author);
});

test("The archival woodland fixture retains its byte digest", async () => {
    const raw = await readFixture("round6.json");
    const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
    assert.equal(sha(raw), "b77a8a26cb0260287e3f720392390ed58261b6032936dbe5525084d59020eabe");
});

test("Migrated woodland bytes and tree order survive reopening", async () => {
    const raw = await readFixture("round6.json");
    const d = parseDesign(raw);
    const island = new Island(d);
    assert.equal(serializeDesign(parseDesign(serializeDesign(d))), serializeDesign(d));
    assert.deepEqual(new Island(parseDesign(serializeDesign(d))).trees, island.trees);
});

test("Export is byte-stable and drops the retired scatter pattern", async () => {
    const input = await readFixture("round6.json");
    const design = parseDesign(input), island = new Island(design);
    const exported = serializeDesign(design);
    assert.equal(serializeDesign(parseDesign(exported)), exported);
    assert.deepEqual(new Island(parseDesign(input)).trees, island.trees);
    const withLegacyField = parseDesign(exported);
    Object.assign(withLegacyField.vegetation, { scatterPattern: "obsolete" });
    assert.equal(serializeDesign(parseDesign(JSON.stringify(withLegacyField))), exported);
});

test("Object and text imports produce identical designs, routes and trees", async () => {
    const text = await readFixture("round6.json");
    const source: unknown = JSON.parse(text);
    const document = parseDesign(source), fromText = parseDesign(text);
    assert.equal(serializeDesign(document), serializeDesign(fromText));
    const island = new Island(document), reference = new Island(fromText);
    assert.deepEqual(island.routes, reference.routes);
    assert.deepEqual(island.trees, reference.trees);
    assert.equal(JSON.stringify(source), JSON.stringify(JSON.parse(text)));
});

test("Saving and reopening the unchanged v3 source preserves every byte", async t => {
    const { Editor } = await import("../src/app/state/session.svelte.ts");
    const raw = await readFixture("round6.json"), editor = new Editor();
    editor.busy = null;
    editor.history = new History(parseDesign(raw));
    t.mock.method(editor, "working", async (_label: string, work: () => void) => work());
    t.mock.method(editor, "replace", (design: ReturnType<typeof parseDesign>) => {
        editor.island = new Island(design);
    });
    t.mock.method(editor, "message", () => {});
    t.mock.method(editor.files, "remember", () => {});
    let bytes = raw;
    const handle = {
        name: "round6.json",
        async getFile() {
            return new File([bytes], this.name);
        },
        async createWritable() {
            return { async write(text: string) {
                bytes = text;
            }, async close() {} };
        }
    };
    for (let i = 0; i < 2; i++) {
        await editor.files.open(await handle.getFile(), handle);
        await editor.files.save();
        assert.equal(bytes, raw);
    }
    editor.describe({ group: "design" }, "新的全岛描述");
    await editor.files.save();
    assert.equal(JSON.parse(bytes).version, 4);
    assert.equal(parseDesign(bytes).prompt, "新的全岛描述");
});

function gatedFile() {
    const bytes: string[] = [], streams: (() => void)[] = [];
    let failure: Error | null = null;
    return {
        bytes, streams,
        failNext(error: Error) {
            failure = error;
        },
        async createWritable() {
            await new Promise<void>(resolve => streams.push(resolve));
            if (failure) {
                const error = failure;
                failure = null;
                throw error;
            }
            return { async write(text: string) {
                bytes.push(text);
            }, async close() {} };
        }
    };
}

test("An active file write coalesces intervening changes into the latest snapshot", async () => {
    const writes = new FileWrites(), file = gatedFile(), saved: string[] = [];
    const save = (text: string) => writes.request(file, text, result => {
        assert.equal(result.ok, true);
        saved.push(text);
    });
    const drained = save("A");
    assert.equal(file.streams.length, 1);
    save("B");
    save("C");
    save("D");
    assert.equal(file.streams.length, 1);
    file.streams[0]();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(file.bytes, ["A"]);
    assert.deepEqual(saved, []);
    assert.equal(file.streams.length, 2);
    file.streams[1]();
    await drained;
    assert.deepEqual(file.bytes, ["A", "D"]);
    assert.deepEqual(saved, ["D"]);
});

test("Switching files drops queued work and ignores the old stream's completion", async () => {
    for (const fail of [false, true]) {
        const writes = new FileWrites(), oldFile = gatedFile(), newFile = gatedFile();
        let status = "old";
        const stale = () => assert.fail("Old completion updated the current file");
        const drained = writes.request(oldFile, "A", stale);
        writes.request(oldFile, "B", stale);
        if (fail) oldFile.failNext(new Error("locked"));
        writes.reset();
        status = "saving";
        writes.request(newFile, "C", result => status = result.ok ? "saved" : "failed");
        oldFile.streams[0]();
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(status, "saving");
        assert.equal(oldFile.streams.length, 1);
        newFile.streams[0]();
        await drained;
        assert.equal(status, "saved");
        assert.deepEqual(newFile.bytes, ["C"]);
    }
});

test("A failed write reports its cause and the next change retries", async () => {
    const writes = new FileWrites(), file = gatedFile();
    const error = new Error("occupied"), results: unknown[] = [];
    file.failNext(error);
    const first = writes.request(file, "A", result => results.push(result));
    file.streams[0]();
    await first;
    assert.deepEqual([...results], [{ ok: false, error }]);
    assert.equal(file.streams.length, 1);
    const retry = writes.request(file, "B", result => results.push(result));
    file.streams[1]();
    await retry;
    assert.deepEqual(results, [{ ok: false, error }, { ok: true }]);
    assert.deepEqual(file.bytes, ["B"]);
});