import { type CustomInput, type FieldDeclaration } from "./v5.ts";

export const defaultFieldPrecision = .1;

export function fieldPrecision(field?: FieldDeclaration) {
    return field?.precision ?? defaultFieldPrecision;
}

export const seedId = "seed", heightId = "height";
export const reserved = {
    input: { [seedId]: { label: "种子", value: 1, range: [-10000, 10000, 1] as CustomInput["range"] } },
    field: { [heightId]: { label: "高度", unit: "m" } }
} as const;

export function isBuiltin(kind: keyof typeof reserved, id: string) {
    return Object.hasOwn(reserved[kind], id);
}

export function declarationEntries<T>(kind: keyof typeof reserved, entries: Record<string, T>) {
    return Object.entries(entries).sort(([a], [b]) => Number(isBuiltin(kind, b)) - Number(isBuiltin(kind, a)));
}

export function defaultInputRange(id: string): CustomInput["range"] {
    return isBuiltin("input", id) ? [...reserved.input[seedId].range] : [-10000, 10000, .1];
}