import { type RunBlock, type WorkPart, type WorkPool, type WorkReference, type WorkTask } from "../core/math/work.ts";

export interface TaskMessage {
    task: WorkTask;
    generation: number;
    references: readonly WorkReference[];
    blocks: number;
    control: Int32Array<SharedArrayBuffer>;
    error: Uint8Array<SharedArrayBuffer>;
}

export interface TaskPort {
    send(message: TaskMessage): void;
    close(): void;
}

const nextBlock = 0, remaining = 1, failure = 2, errorSize = 3;

function fail(message: TaskMessage, error: unknown) {
    if (Atomics.compareExchange(message.control, failure, 0, 1)) return;
    const record = error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: String(error) };
    const text = JSON.stringify(record), encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const result = encoded.length <= message.error.length ? encoded : encoder.encode(JSON.stringify({
        name: "Error", message: record.message.slice(0, 2000)
    }));
    message.error.set(result);
    const written = result.length;
    Atomics.store(message.control, errorSize, written);
}

function consume(message: TaskMessage, execute: RunBlock) {
    const { control, blocks } = message;
    for (;;) {
        if (Atomics.load(control, failure)) return;
        const block = Atomics.add(control, nextBlock, 1);
        if (block >= blocks) return;
        execute(block);
    }
}

function complete(control: TaskMessage["control"]) {
    Atomics.sub(control, remaining, 1);
    Atomics.notify(control, remaining, 1);
}

export function receiveTask(message: TaskMessage, prepare: (message: TaskMessage) => RunBlock) {
    try {
        if (!Atomics.load(message.control, failure)) consume(message, prepare(message));
    }
    catch (error) {
        fail(message, error);
    }
    finally {
        complete(message.control);
    }
}

export class ThreadPool implements WorkPool {
    readonly size: number;
    private ports: { port: TaskPort; known: Set<number> }[];
    private generation = 0;
    timings: Partial<Record<WorkPart, number>> = {};
    dispatchTime = 0;
    waitTime = 0;

    constructor(ports: TaskPort[]) {
        this.size = ports.length;
        this.ports = ports.map(port => ({ port, known: new Set() }));
    }

    begin() {
        this.generation++;
        for (const { known } of this.ports) known.clear();
        this.timings = {};
        this.dispatchTime = this.waitTime = 0;
    }

    measure<T>(part: WorkPart, execute: () => T) {
        const start = performance.now();
        try {
            return execute();
        }
        finally {
            this.timings[part] = (this.timings[part] ?? 0) + performance.now() - start;
        }
    }

    run(task: WorkTask, blocks: number, execute: RunBlock, references: readonly WorkReference[] = []) {
        // Leave enough blocks per participant to amortize dispatch and warm up the cell loop.
        const count = Math.min(this.size, blocks - 1, Math.ceil(blocks / 8));
        if (count <= 0) {
            for (let block = 0; block < blocks; block++) execute(block);
            return;
        }

        const dispatch = performance.now();
        const control = new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT));
        const error = new Uint8Array(new SharedArrayBuffer(16384));
        const message: TaskMessage = { task, generation: this.generation, references, blocks, control, error };
        Atomics.store(control, remaining, count);
        let sent = 0, dispatched = false;
        try {
            for (; sent < count; sent++) {
                const { port, known } = this.ports[sent];
                const unseen = references.filter(ref => !known.has(ref.revision));
                port.send({ ...message, references: unseen });
                for (const ref of unseen) known.add(ref.revision);
            }
            this.dispatchTime += performance.now() - dispatch;
            dispatched = true;
            consume(message, execute);
        }
        catch (cause) {
            if (!dispatched) this.dispatchTime += performance.now() - dispatch;
            fail(message, cause);
            Atomics.sub(control, remaining, count - sent);
        }

        const waiting = performance.now();
        for (let active = Atomics.load(control, remaining); active; active = Atomics.load(control, remaining))
            Atomics.wait(control, remaining, active);
        this.waitTime += performance.now() - waiting;
        if (Atomics.load(control, failure)) {
            // A participant can fail while installing references. Resend them next time.
            this.generation++;
            for (const { known } of this.ports) known.clear();
            const text = new TextDecoder().decode(error.subarray(0, Atomics.load(control, errorSize)));
            const record: { name: string; message: string } = JSON.parse(text);
            throw Object.assign(new Error(record.message), { name: record.name });
        }
    }

    close() {
        for (const { port } of this.ports) port.close();
    }
}