import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";

// Keep private designs and their recorded expectations together in this ignored directory.
const fixtures = new URL("../.local/fixtures/", import.meta.url);

export function fixtureOptions(...names: string[]) {
    // An installed fixture set is mandatory in full. File errors then fail the consuming test.
    return { skip: existsSync(fixtures) ? false : "Missing " + names.map(name => ".local/fixtures/" + name).join(", ") };
}

export function readFixture(name: string): Promise<string> {
    if (!/^[\w-]+\.json$/.test(name)) throw new Error(`Invalid fixture name: ${name}`);
    return readFile(new URL(name, fixtures), "utf8");
}

export async function writeGolden(snapshot: unknown) {
    const temporary = new URL(`.golden-${randomUUID()}.tmp`, fixtures);
    try {
        await writeFile(temporary, JSON.stringify(snapshot, null, 4), { flag: "wx" });
        await rename(temporary, new URL("golden.json", fixtures));
    }
    finally {
        await rm(temporary, { force: true });
    }
}

export async function designFixtures() {
    const names = (await readdir(fixtures)).filter(name => name.endsWith(".json") && name !== "golden.json" && name !== "regressions.json");
    return Promise.all(names.map(async name => ({ name, text: await readFixture(name) })));
}

interface Regressions {
    exportCommit: string;
    round4: {
        convertedRoads: string[]; circuit: string[]; yardGates: number; outgoingFraction: number;
        shoreline: [number, number][]; shoreDistance: [number, number]; perfEdge: string; perfLevel: string;
    };
    round5: {
        issues: Record<string, number>; nodes: number; edges: number; removedLabel: string;
        plantingDensity: number; rowSpacing: number;
    };
    round6: {
        sourceDigest: string; innerSamples: number; outerSamples: number; farDigest: string;
        nearRadius: number; minOriginalRise: number; maxMigratedRise: number;
        woodlandNames: string[]; woodlandTrees: number[]; scatter: number;
    };
}

export async function readRegressions(): Promise<Regressions> {
    return JSON.parse(await readFixture("regressions.json"));
}