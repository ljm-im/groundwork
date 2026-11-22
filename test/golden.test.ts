import { test } from "node:test";
import { fixtureOptions } from "../configs/read-fixture.ts";
import { checkSnapshots } from "./golden.ts";

test("Three reference designs retain all generation and serialization hashes", fixtureOptions("round4.json", "round5.json", "round6.json", "golden.json", "regressions.json"), checkSnapshots);