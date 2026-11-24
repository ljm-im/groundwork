import { type CustomInput } from "./v5.ts";

export const seedId = "seed", heightId = "height";
export const reserved = {
    input: { [seedId]: { label: "种子", value: 1, range: [-10000, 10000, 1] as CustomInput["range"] } },
    field: { [heightId]: { label: "高度", unit: "m" } }
} as const;

export function isBuiltin(kind: keyof typeof reserved, id: string) {
    return Object.hasOwn(reserved[kind], id);
}

export function fieldEntries<T>(fields: Record<string, T>) {
    return Object.entries(fields).sort(([a], [b]) => Number(isBuiltin("field", b)) - Number(isBuiltin("field", a)));
}

export function defaultInputRange(id: string): CustomInput["range"] {
    return isBuiltin("input", id) ? [...reserved.input[seedId].range] : [-10000, 10000, .1];
}