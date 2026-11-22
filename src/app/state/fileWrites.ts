export interface WriteHandle {
    createWritable(): Promise<{
        write(text: string): Promise<void>;
        close(): Promise<void>;
        abort?(): Promise<void>;
    }>;
}

type Result = { ok: true } | { ok: false; error: unknown };
type Write = { handle: WriteHandle; text: string; finish: (result: Result) => void };

async function writeText({ handle, text }: Write) {
    const stream = await handle.createWritable();
    try {
        await stream.write(text);
        await stream.close();
    }
    catch (error) {
        await stream.abort?.().catch(() => {});
        throw error;
    }
}

// One stream at a time. While it is open, retain only the newest requested snapshot.
export class FileWrites {
    private latest: Write | null = null;
    private running: Promise<void> | null = null;

    request(handle: WriteHandle, text: string, finish: Write["finish"]) {
        this.latest = { handle, text, finish };
        this.running ??= this.drain();
        return this.running;
    }
    reset() {
        this.latest = null;
    }
    private async drain() {
        try {
            while (this.latest) {
                const job = this.latest;
                let result: Result;
                try {
                    await writeText(job);
                    result = { ok: true };
                }
                catch (error) {
                    result = { ok: false, error };
                }
                if (this.latest === job) {
                    this.latest = null;
                    job.finish(result);
                }
            }
        }
        finally {
            this.running = null;
        }
    }
}