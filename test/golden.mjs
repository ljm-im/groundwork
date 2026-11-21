import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFixture } from "../configs/read-fixture.ts";
import { Island } from "../src/core/island.js";
import { parseDesign, serializeDesign } from "../src/core/model.js";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const values = value => digest(JSON.stringify(value));
const bytes = field => digest(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));

export async function snapshots() {
    const inputs = {
        round4: await readFixture("round4.json"),
        round5: await readFixture("round5.json"),
        round6: await readFixture("round6.json")
    };
    return Object.fromEntries(Object.entries(inputs).map(([name, raw]) => {
        const design = parseDesign(raw);
        const serialized = digest(serializeDesign(design));
        const island = new Island(design);
        return [name, {
            heights: bytes(island.terrain.heights),
            routes: island.routes.map(r => ({ id: r.id, points: values(r.points), profile: values(r.h) })),
            gradedHeights: bytes(island.graded.heights),
            trees: values(island.trees),
            issues: values(island.issues),
            serialized
        }];
    }));
}

export async function checkSnapshots() {
    assert.deepEqual(await snapshots(), JSON.parse(await readFixture("golden.json")));
}