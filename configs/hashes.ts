import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { functionTable } from "../src/core/design/functionTable.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { Project } from "../src/core/project.ts";
import { nodePool } from "../src/compute/nodePool.ts";

const [file, spacing, ...options] = process.argv.slice(2), step = Number(spacing);
const native = options.includes("--native-erosion"), counts = options.filter(option => option !== "--native-erosion");
const threads = Number(counts[0] ?? 0);
if (!file || !Number.isFinite(step) || step <= 0 || counts.length > 1 || options.length > counts.length + 1 ||
    !Number.isSafeInteger(threads) || threads < 0)
    throw Error("Usage: node configs/hashes.ts <design.json> <step> [threads] [--native-erosion]");

const design = parseDesign(await readFile(file, "utf8"));
design.grid.step = step;
if (native && functionTable.erosion.parameters.some(p => p.key[0] === "spacing"))
    for (const node of design.geoNodes)
        if (node.function.type === "erosion") Object.assign(node.function, { spacing: step });

const pool = await nodePool(threads);
try {
    const project = new Project(design, undefined, undefined, pool);
    const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
    const bytes = (field: Float32Array | Uint8Array) => new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
    console.log(JSON.stringify({
        fields: Object.fromEntries(Object.entries(project.terrain.fields).map(([key, field]) => [key, {
            values: digest(bytes(field.values)), defined: digest(bytes(field.defined))
        }])),
        shore: digest(bytes(project.terrain.shore)),
        issues: digest(JSON.stringify(project.issues)),
        batterResiduals: digest(JSON.stringify([...project.terrain.batterResiduals]))
    }));
}
finally {
    pool.close();
}