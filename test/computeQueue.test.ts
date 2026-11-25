import assert from "node:assert/strict";
import { test } from "node:test";
import { type Reply } from "../src/compute/messages.ts";
import { ThreadPool } from "../src/compute/pool.ts";
import { TerrainQueue } from "../src/compute/terrainQueue.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { resolveDesign } from "../src/core/design/parameters.ts";
import { testTerrainClient } from "./computeFixture.ts";
import { syntheticDesign } from "./scenarios.ts";

test("Pending previews coalesce by kind and a generation drops the entire preview queue", async () => {
    const design = parseDesign(syntheticDesign()), resolved = resolveDesign(design), known = [] as [];
    const replies: Reply[] = [], tasks: (() => void)[] = [];
    const queue = new TerrainQueue(Promise.resolve(new ThreadPool([])), (reply, transfer = []) => {
        replies.push(structuredClone(reply, { transfer }));
    }, task => {
        tasks.push(task);
    });
    const generate = (id: number) => queue.receive({ kind: "generate", id, design, known, reset: false });
    async function run() {
        assert.equal(tasks.length, 1);
        tasks.shift()!();
        await Promise.resolve();
    }
    generate(1);
    await run();
    queue.receive({ kind: "number", id: 2, source: 1, design, resolved, known });
    queue.receive({ kind: "number", id: 3, source: 1, design, resolved, known });
    queue.receive({ kind: "coarse", id: 4, source: 1, design, resolved, known });
    generate(5);
    queue.receive({ kind: "reading", id: 6, source: 1, owner: "T", field: "height" });
    await run();
    await run();
    assert.deepEqual(replies.map(reply => [reply.id, reply.kind]), [
        [1, "started"], [1, "project"], [2, "dropped"], [4, "dropped"], [3, "dropped"], [5, "started"], [5, "project"], [6, "dropped"]
    ]);
});

test("Transferred fields leave the worker's viewport and readings available and the next project reuses its regions", async () => {
    const client = testTerrainClient(), design = parseDesign(syntheticDesign());
    const first = await client.generate(design, true, () => {});
    assert.equal(first.terrain.fields.height.values.length, first.terrain.grid.size);
    assert.equal(await first.inputAt("T", "height"), 4);
    const view = await first.viewBelow("T");
    assert.equal(view?.terrain.regions.get("G"), first.terrain.regions.get("G"));
    const next = await client.generate(design, false, () => {});
    assert.equal(next.terrain.regions.get("T"), first.terrain.regions.get("T"));
    assert.equal(await first.inputAt("T", "height"), undefined);
    assert.equal(await next.inputAt("T", "height"), 4);
    client.close();
});