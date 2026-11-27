export const layerDefaults = {
    geoNodes: false,
    geometry: false,
    sections: true,
    contours: true,
    contourLabels: true,
    labels: true,
    marks: true,
    issues: true,
    grid: true,
    fineGrid: false
};

export const gridDefaults = { mode: "pixels" as "meters" | "pixels", meters: 10, pixels: 80 };
export type GridDisplay = typeof gridDefaults;

export function pixelGridSpacing(scale: number, pixels: number) {
    const target = pixels / scale, decade = 10 ** Math.floor(Math.log10(target));
    return [1, 2, 5, 10].map(n => n * decade).reduce((best, step) =>
        Math.abs(step - target) < Math.abs(best - target) ? step : best);
}