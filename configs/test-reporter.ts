import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { spec, type TestEvent } from "node:test/reporters";

export default async function* report(events: AsyncIterable<TestEvent>) {
    yield* Readable.from(events).map((event: TestEvent) => {
        if (event.type === "test:summary" && !event.data.file && event.data.counts.skipped &&
            existsSync(new URL("../.local/fixtures/", import.meta.url))) {
            process.exitCode = 1;
            console.error("Tests were skipped with .local/fixtures/ present. Check the reported filenames.");
        }
        return event;
    }).pipe(spec());
}