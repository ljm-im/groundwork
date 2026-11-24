import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesign } from "../src/core/design/model.ts";
import { Project } from "../src/core/project.ts";
import { exportProject, serializeExport } from "../src/core/export.ts";

async function main(args: string[]) {
    if (args.length !== 2) throw new Error("用法：pnpm run export <设计文件> <输出文件>");
    const [input, output] = args.map(p => resolve(p));
    const sourceFile = await stat(input, { bigint: true });
    const targetFile = await stat(output, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return null;
    });
    if (input === output || sourceFile.dev === targetFile?.dev && sourceFile.ino === targetFile.ino)
        throw new Error("输出路径指向输入的设计文件");
    const bytes = await readFile(input);
    const design = parseDesign(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const root = fileURLToPath(new URL("../", import.meta.url));
    const commit = execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).trim();
    const exported = exportProject(new Project(design), { sha256: createHash("sha256").update(bytes).digest("hex"), commit });
    const temp = join(dirname(output), ".groundwork-" + randomUUID() + ".tmp");
    const file = await open(temp, "wx");
    try {
        try {
            await file.writeFile(serializeExport(exported));
        }
        finally {
            await file.close();
        }
        await rename(temp, output);
    }
    finally {
        await rm(temp, { force: true });
    }
    console.log(output);
}

try {
    await main(process.argv.slice(2));
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}