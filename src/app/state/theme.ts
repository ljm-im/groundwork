import { type Theme } from "../../render/palette.ts";

export type Appearance = "system" | Theme;
export const systemThemeQuery = "(prefers-color-scheme: dark)";
const key = "groundwork/appearance-v1";

export function resolveTheme(appearance: Appearance, systemDark: boolean): Theme {
    return appearance === "system" ? systemDark ? "dark" : "light" : appearance;
}

export function readAppearance(): Appearance {
    try {
        const value = localStorage.getItem(key);
        if (value === "light" || value === "dark") return value;
    }
    catch { /* Use the system appearance when storage is unavailable. */ }
    return "system";
}

export function saveAppearance(appearance: Appearance) {
    try {
        localStorage.setItem(key, appearance);
    }
    catch { /* The current session retains its appearance. */ }
}

export function applyTheme(theme: Theme) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const meta = document.querySelector<HTMLMetaElement>("meta[name=theme-color]");
    if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg-sunken").trim();
}