export const layerDefaults = {
    geoNodes: false,
    sections: true,
    contours: true,
    contourLabels: true,
    labels: true,
    marks: true,
    issues: true,
    grid: true,
    fineGrid: false
};
export const layerNames = {
    geoNodes: "地件轮廓",
    sections: "剖面线",
    labels: "标签",
    marks: "标记",
    issues: "校验标记"
};

const gridDefaults = { mode: "pixels" as "meters" | "pixels", meters: 10, pixels: 80 };
export type GridDisplay = typeof gridDefaults;
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

export function pixelGridSpacing(scale: number, pixels: number) {
    const target = pixels / scale, decade = 10 ** Math.floor(Math.log10(target));
    return [1, 2, 5, 10].map(n => n * decade).reduce((best, step) =>
        Math.abs(step - target) < Math.abs(best - target) ? step : best);
}