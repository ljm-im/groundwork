import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFixture, writeGolden, readRegressions } from "../configs/read-fixture.ts";
import { evaluateStack } from "../src/core/terrain/terrain.ts";
import { Project } from "../src/core/project.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { exportProject, serializeExport } from "../src/core/export.ts";

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
        const project = new Project(design), terrain = project.terrain, fields = evaluateStack(design).fields;
        assert.equal(terrain.heights, terrain.fields.height);
        for (const [field, values] of Object.entries(fields)) assert.equal(bytes(terrain.fields[field]), bytes(values), field);
        return [name, {
            fields: Object.fromEntries(Object.entries(fields).map(([key, array]) => [key, bytes(array)])),
            defined: bytes(terrain.defined),
            issues: values(project.issues),
            serialized,
            exported: digest(serializeExport(exportProject(project, { sha256: digest(raw), commit: exportCommit })))
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