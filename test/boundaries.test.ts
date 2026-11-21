import { test } from "node:test";
import { checkBoundaries } from "../configs/boundaries.ts";

test("Core dependencies are acyclic and tests only read fixtures", checkBoundaries);