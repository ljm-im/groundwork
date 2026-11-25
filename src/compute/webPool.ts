import { ThreadPool, type TaskPort } from "./pool.ts";

export async function webPool() {
    const size = self.crossOriginIsolated ? Math.max(0, navigator.hardwareConcurrency - 2) : 0;
    const helpers: { worker: Worker; port: MessagePort }[] = [];
    try {
        const ports = await Promise.all(Array.from({ length: size }, () => new Promise<TaskPort>((resolve, reject) => {
            const worker = new Worker(new URL("./webTask.ts", import.meta.url), { type: "module" });
            const { port1, port2 } = new MessageChannel();
            helpers.push({ worker, port: port1 });
            worker.onerror = event => reject(Error(event.message));
            port1.onmessage = () => resolve({
                // Chromium can defer nested Worker.postMessage until the caller yields.
                send: message => port1.postMessage(message),
                close() {
                    port1.close();
                    worker.terminate();
                }
            });
            worker.postMessage(port2, [port2]);
        })));
        return new ThreadPool(ports);
    }
    catch (error) {
        for (const { worker, port } of helpers) {
            port.close();
            worker.terminate();
        }
        throw error;
    }
}