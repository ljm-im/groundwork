import { test } from "node:test";
import assert from "node:assert/strict";
import { readFixture } from "../configs/read-fixture.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { createHash } from "node:crypto";

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