import { type ProjectModel } from "./terrainClient.ts";

declare global {
    interface Window {
        terrainFieldHashes?: () => ReturnType<typeof terrainFieldHashes>;
        editorWorkSettled?: () => Promise<boolean>;
    }
}

async function digest(array: Float32Array | Uint8Array) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}

export async function terrainFieldHashes(project: ProjectModel) {
    const fields = await Promise.all(Object.entries(project.terrain.fields).map(async ([key, field]) => [key, {
        values: await digest(field.values), defined: await digest(field.defined)
    }] as const));
    return { fields: Object.fromEntries(fields), helpers: project.helpers };
}