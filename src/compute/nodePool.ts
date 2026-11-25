import { Worker } from "node:worker_threads";
import { ThreadPool, type TaskPort } from "./pool.ts";

export async function nodePool(size: number) {
    if (!Number.isSafeInteger(size) || size < 0) throw Error("Invalid number of terrain helpers");
    const workers: Worker[] = [];
    try {
        const ports = await Promise.all(Array.from({ length: size }, () => new Promise<TaskPort>((resolve, reject) => {
            const helper = new Worker(new URL("./nodeTask.ts", import.meta.url), { execArgv: [] });
            workers.push(helper);
            helper.once("error", reject);
            helper.once("message", () => resolve({
                send: message => helper.postMessage(message),
                close: () => {
                    void helper.terminate();
                }
            }));
        })));
        return new ThreadPool(ports);
    }
    catch (error) {
        await Promise.all(workers.map(worker => worker.terminate()));
        throw error;
    }
}