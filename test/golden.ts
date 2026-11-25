import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFixture, writeGolden, readRegressions } from "../configs/read-fixture.ts";
import { evaluateStack } from "../src/core/terrain/terrain.ts";
import { Project } from "../src/core/project.ts";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { exportProject } from "../src/core/export.ts";
import { decodePreview, readZip } from "./exportFiles.ts";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const values = (value: unknown) => digest(JSON.stringify(value));
const bytes = (field: Float32Array | Uint8Array) => digest(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));

export async function snapshots() {
    const { exportCommit } = await readRegressions();
    const inputs = {
        coast: await readFixture("round14-coast.json"),
        land: await readFixture("round14-land.json")
    };
    return Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([name, raw]) => {
        const design = parseDesign(raw);
        const serialized = digest(serializeDesign(design));
        const project = new Project(design), terrain = project.terrain, fields = evaluateStack(design).fields;
        assert.deepEqual(terrain.fields, fields);
        const files = readZip(await exportProject(project, exportCommit));
        const exported = values([...files].map(([path, data]) => [path, digest(path === "preview.png" ? decodePreview(data).pixels : data)]));
        return [name, {
            fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, { values: bytes(field.values), defined: bytes(field.defined) }])),
            issues: values(project.issues),
            serialized,
            exported
        }];
    })));
}

export async function captureSnapshots() {
    await writeGolden(await snapshots());
}

if (import.meta.main) await captureSnapshots();

export async function checkSnapshots() {
    assert.deepEqual(await snapshots(), JSON.parse(await readFixture("golden.json")));
}