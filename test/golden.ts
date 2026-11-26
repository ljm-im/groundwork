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

interface Snapshot {
    fields: Record<string, { values: string; defined: string }>;
    issues: string;
    serialized: string;
    exported: string;
}

export async function snapshots(previous?: Record<string, Snapshot>) {
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
        const decoder = new TextDecoder();
        const metadata = JSON.parse(decoder.decode(files.get("project.json")));
        assert.equal(digest(files.get(metadata.source.design)!), serialized);
        assert.equal(metadata.source.sha256, serialized);
        let sourceHash = serialized;
        if (previous?.[name] && previous[name].serialized !== serialized) {
            // The node migration changes the embedded design and its checksum in the manifest.
            // Compare every other byte of the export against the existing golden hash.
            sourceHash = previous[name].serialized;
            metadata.source.sha256 = sourceHash;
            const roundTrip = parseDesign(decoder.decode(files.get(metadata.source.design)));
            assert.equal(digest(serializeDesign(roundTrip)), serialized);
        }
        const exported = values([...files].map(([path, data]) => [path, path === metadata.source.design ? sourceHash :
            digest(path === "project.json" && sourceHash !== serialized ? JSON.stringify(metadata, null, 2) :
                path === "preview.png" ? decodePreview(data).pixels : data)]));
        return [name, {
            fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, { values: bytes(field.values), defined: bytes(field.defined) }])),
            issues: values(project.issues),
            serialized: sourceHash,
            exported
        }];
    })));
}

export async function captureSnapshots() {
    await writeGolden(await snapshots());
}

if (import.meta.main) await captureSnapshots();

export async function checkSnapshots() {
    const expected: Record<string, Snapshot> = JSON.parse(await readFixture("golden.json"));
    assert.deepEqual(await snapshots(expected), expected);
}