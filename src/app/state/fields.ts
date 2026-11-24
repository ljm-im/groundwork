import { type GridDisplay } from "./layers.ts";
import * as session from "./session.svelte.ts";
import { type Layer } from "../types.ts";

export function changeField(editor: session.Editor, input: HTMLInputElement) {
    if (editor.busy) return;
    const key = input.dataset;
    if (key.layer) editor.layer(key.layer as Layer, input.checked);
    if (key.gridSetting) {
        const setting = key.gridSetting as keyof GridDisplay;
        if (!editor.setGrid(setting, input.value)) input.value = String(editor.displayGrid[setting]);
    }
}