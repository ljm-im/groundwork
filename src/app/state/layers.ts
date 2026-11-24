import { gridDefaults, layerDefaults, type GridDisplay } from "../../core/edit/display.ts";

export const layerNames = {
    geoNodes: "地件轮廓",
    sections: "剖面线",
    labels: "地件名称",
    marks: "标记",
    issues: "问题位置"
};

const storageKey = "groundwork/map-display-v1";

export function readDisplaySettings() {
    const layers = { ...layerDefaults }, grid = { ...gridDefaults };
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
        for (const key of Object.keys(layers) as (keyof typeof layers)[])
            if (typeof stored?.layers?.[key] === "boolean") layers[key] = stored.layers[key];
        if (stored?.grid?.mode === "meters") grid.mode = "meters";
        for (const key of ["meters", "pixels"] as const) {
            const value = stored?.grid?.[key];
            if (Number.isFinite(value) && value > 0) grid[key] = value;
        }
    }
    catch { /* Display settings remain available in memory. */ }
    return { layers, grid };
}

export function saveDisplaySettings(layers: typeof layerDefaults, grid: GridDisplay) {
    try {
        localStorage.setItem(storageKey, JSON.stringify({ layers, grid }));
    }
    catch { /* Display settings remain available in memory. */ }
}