import { type Command, type Reply } from "./messages.ts";
import { TerrainQueue } from "./terrainQueue.ts";
import { ThreadPool } from "./pool.ts";
import { webPool } from "./webPool.ts";

declare const __GROUNDWORK_COMMIT__: string;

const channel = self as unknown as {
    onmessage: (event: MessageEvent<Command>) => void;
    postMessage(reply: Reply, transfer: ArrayBuffer[]): void;
};
const pool = webPool().catch(error => {
    console.error(error);
    return new ThreadPool([]);
});
const queue = new TerrainQueue(pool, (reply, transfer = []) => channel.postMessage(reply, transfer), undefined, __GROUNDWORK_COMMIT__);
channel.onmessage = event => queue.receive(event.data);