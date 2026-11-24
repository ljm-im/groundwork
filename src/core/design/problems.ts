
import { jsonPath, type Address } from "./address.ts";

const collections = { geo: "geoNodes", input: "inputs", field: "fields", mark: "marks", section: "sections" } as const;
export type Location = { kind: keyof typeof collections; id: string; index?: number; path: Address } | { kind: "project"; path: Address };
export type DesignProblem = { message: string; location?: Location };

export function problemText({ message, location }: DesignProblem) {
    if (!location) return message;
    const root = location.kind === "project" ? [] : [collections[location.kind], location.index ?? location.id];
    const path = jsonPath([...root, ...location.path]);
    return path ? path + " " + message : message;
}

export class DesignError extends Error {
    readonly problems: DesignProblem[];

    constructor(problems: DesignProblem[]) {
        super(problems.map(problemText).join("\n"));
        this.problems = problems;
    }
}

export function check(ok: unknown, message: string, location?: Location): asserts ok {
    if (!ok) throw new DesignError([{ message, location }]);
}