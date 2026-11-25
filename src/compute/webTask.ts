import { taskHandler } from "./tasks.ts";

const handle = taskHandler();
self.onmessage = (event: MessageEvent<MessagePort>) => {
    const port = event.data;
    port.onmessage = event => handle(event.data);
    port.postMessage("ready");
};