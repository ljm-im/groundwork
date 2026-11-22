import { readdir, readFile, writeFile } from "node:fs/promises";

const fixtures = new URL("../.local/fixtures/", import.meta.url);

export function readFixture(name: string): Promise<string> {
    if (!/^[\w-]+\.json$/.test(name)) throw new Error(`Invalid fixture name: ${name}`);
    return readFile(new URL(name, fixtures), "utf8");
}

export function writeGolden(snapshot: unknown) {
    return writeFile(new URL("golden.json", fixtures), JSON.stringify(snapshot, null, 4), "utf8");
}

export async function designFixtures() {
    const names = (await readdir(fixtures)).filter(name => name.endsWith(".json") && name !== "golden.json");
    return Promise.all(names.map(async name => ({ name, text: await readFixture(name) })));
}