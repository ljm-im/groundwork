import { type Design, type Expression } from "../src/core/design/v5.ts";
import { expressionGraph } from "../src/core/design/parameters.ts";
import { evaluate, sampleValue } from "../src/core/design/expression.ts";

export const bindHeight = (id: string, offset = 0) => "{input:" + id + "}" + (offset ? (offset < 0 ? " - " : " + ") + Math.abs(offset) : "");
export const bindField = (id: string, scale = 1, offset = 0) => "{field:" + id + "}" + (scale === 1 ? "" : " * " + scale) + (offset ? (offset < 0 ? " - " : " + ") + Math.abs(offset) : "");
export function resolved(v: Expression, d: Design, readField: (field: string) => number | undefined) {
    return sampleValue(evaluate(v, expressionGraph(d).get), readField) ?? 0;
}