import { test } from "node:test";
import { checkBoundaries, checkDesignTokens, checkEditorSource, checkParameterSource } from "../configs/boundaries.ts";

test("Core dependencies are acyclic and tests only read fixtures", checkBoundaries);

test("Tracked editor source uses consistent quotes, disabled labels and numeric controls", checkEditorSource);

test("Editor and renderer source reference the design tokens", checkDesignTokens);

test("Function parameter units, steps, and labels come from the registry", checkParameterSource);