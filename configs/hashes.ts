import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { functionTable } from "../src/core/design/functionTable.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { Project } from "../src/core/project.ts";

const [file, spacing, mode] = process.argv.slice(2), step = Number(spacing);
if (!file || !Number.isFinite(step) || step <= 0 || mode !== undefined && mode !== "--native-erosion")
    throw Error("Usage: node configs/hashes.ts <design.json> <step> [--native-erosion]");

const design = parseDesign(await readFile(file, "utf8"));
design.grid.step = step;
if (mode === "--native-erosion" && functionTable.erosion.parameters.some(p => p.key[0] === "spacing"))
    for (const node of design.geoNodes)
        if (node.function.type === "erosion") Object.assign(node.function, { spacing: step });

const project = new Project(design);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const bytes = (field: Float32Array | Uint8Array) => new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
console.log(JSON.stringify({
    fields: Object.fromEntries(Object.entries(project.terrain.fields).map(([key, field]) => [key, {
        values: digest(bytes(field.values)), defined: digest(bytes(field.defined))
    }])),
    issues: digest(JSON.stringify(project.issues))
}));