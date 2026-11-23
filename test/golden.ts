import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFixture, writeGolden, readRegressions } from "../configs/read-fixture.ts";
import { evaluateStack } from "../src/core/terrain/terrain.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { exportIsland, serializeExport } from "../src/core/export.ts";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const values = (value: unknown) => digest(JSON.stringify(value));
const bytes = (field: Float32Array | Uint8Array) => digest(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));

export async function snapshots() {
    const { exportCommit } = await readRegressions();
    const inputs = {
        coast: await readFixture("round14-coast.json"),
        land: await readFixture("round14-land.json")
    };
    return Object.fromEntries(Object.entries(inputs).map(([name, raw]) => {
        const design = parseDesign(raw);
        const serialized = digest(serializeDesign(design));
        const island = new Island(design);
        return [name, {
            fields: Object.fromEntries(Object.entries(evaluateStack(design).fields).map(([key, array]) => [key, bytes(array)])),
            defined: bytes(island.terrain.defined),
            padHeights: bytes(island.terrain.heights),
            routes: island.routes.map(r => ({ id: r.id, points: values(r.points), profile: values(r.h), route: values(r) })),
            gradedHeights: bytes(island.graded.heights),
            trees: values(island.trees),
            issues: values(island.issues),
            serialized,
            exported: digest(serializeExport(exportIsland(island, { sha256: digest(raw), commit: exportCommit })))
        }];
    }));
}

export async function captureSnapshots() {
    await writeGolden(await snapshots());
}

if (import.meta.main) await captureSnapshots();

export async function checkSnapshots() {
    assert.deepEqual(await snapshots(), JSON.parse(await readFixture("golden.json")));
}