import { test } from "node:test";
import { checkBoundaries, checkEditorSource } from "../configs/boundaries.ts";

test("Core dependencies are acyclic and tests only read fixtures", checkBoundaries);

test("Tracked editor source uses consistent quotes, disabled labels and numeric controls", checkEditorSource);