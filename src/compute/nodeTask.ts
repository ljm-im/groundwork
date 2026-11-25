import { parentPort } from "node:worker_threads";
import { taskHandler } from "./tasks.ts";

parentPort!.on("message", taskHandler());
parentPort!.postMessage("ready");