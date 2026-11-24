import { test } from "node:test";
import { fixtureOptions } from "../configs/read-fixture.ts";
import { checkSnapshots } from "./golden.ts";

test("Both v5 designs retain field, mask, issue and file hashes", fixtureOptions("round14-coast.json", "round14-land.json", "golden.json", "regressions.json"), checkSnapshots);