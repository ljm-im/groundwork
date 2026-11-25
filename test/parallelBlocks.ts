import { parentPort } from "node:worker_threads";
import { receiveTask, type TaskMessage } from "../src/compute/pool.ts";

export interface CountBlocks { kind: "count"; counts: Int32Array; failAt?: number }

export function countBlocks({ counts, failAt }: CountBlocks) {
    return (block: number) => {
        if (block === failAt) throw RangeError("block " + block);
        Atomics.add(counts, block, 1);
    };
}

if (parentPort) {
    parentPort.on("message", (task: TaskMessage) => receiveTask(task, message => countBlocks(message.task as CountBlocks)));
    parentPort.postMessage("ready");
}