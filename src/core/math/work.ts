export interface WorkTask { kind: string }
export interface WorkReference { revision: number }
export type RunBlock = (block: number) => void;
export type WorkPart = "rasterRegion" | "sampleBindings" | "prepareCells" | "evaluateCells" | "shoreDistance" | "trace";

export interface WorkPool {
    readonly size: number;
    begin(): void;
    run(task: WorkTask, blocks: number, execute: RunBlock, references?: readonly WorkReference[]): void;
    measure<T>(part: WorkPart, execute: () => T): T;
}

export const parallelThreshold = 65536;
export const cellBlock = 8192;

export function workBuffer(bytes: number, shared?: boolean): ArrayBufferLike {
    return shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
}

export function runBlocks(pool: WorkPool | undefined, work: number, blocks: number,
    execute: RunBlock, task: () => WorkTask, references?: () => readonly WorkReference[], minimum = parallelThreshold) {
    if (pool?.size && work >= minimum && blocks > 1) pool.run(task(), blocks, execute, references?.());
    else for (let block = 0; block < blocks; block++) execute(block);
}

export function measureWork<T>(pool: WorkPool | undefined, part: WorkPart, execute: () => T) {
    return pool ? pool.measure(part, execute) : execute();
}