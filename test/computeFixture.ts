import { TerrainClient, ProjectModel } from "../src/app/state/terrainClient.ts";
import { type Reply } from "../src/compute/messages.ts";
import { TerrainQueue } from "../src/compute/terrainQueue.ts";
import { ThreadPool } from "../src/compute/pool.ts";
import { type Project } from "../src/core/project.ts";

export function testTerrainClient(schedule = queueMicrotask, replyObserved?: (reply: Reply) => void) {
    return new TerrainClient(receive => {
        const queue = new TerrainQueue(Promise.resolve(new ThreadPool([])), (reply, transfer = []) => {
            receive(structuredClone(reply, { transfer }));
            replyObserved?.(reply);
        }, schedule);
        return { send: request => queue.receive(structuredClone(request)), close() {} };
    });
}

export function testProjectModel(project: Project) {
    return new ProjectModel(project.design, project.view(), testTerrainClient(), 0);
}