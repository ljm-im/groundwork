import { test } from "node:test";
import { checkSnapshots } from "./golden.ts";

test("Three reference designs retain all generation and serialization hashes", checkSnapshots);