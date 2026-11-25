import { reliefColors, reliefThemes } from "../core/terrain/relief.ts";

export const interfaceColors = {
    light: { bgApp: "#f9faf6", textSecondary: "#657570", border: "#d9dfd7", accent: "#226659" },
    dark: { bgApp: "#171d1b", textSecondary: "#8f9e98", border: "#323d39", accent: "#62b3a0" }
} as const;

export type Theme = keyof typeof interfaceColors;

export const mapColors = {
    light: {
        bgPanel: "#fffefa",
        bgSelected: "#e2ece4",
        text: "#233d37",
        borderRegion: "#c4ccc1",
        accent: interfaceColors.light.accent,
        accentHover: "rgb(34 102 89 / 50%)",
        dragOrigin: "rgb(34 102 89 / 30%)",
        stripArea: "rgb(34 102 89 / 10%)",
        warning: "#ad771c",
        danger: "#a34839",
        parameterGeometry: "#8b4f9a"
    },
    dark: {
        bgPanel: "#1d2422",
        bgSelected: "#2d3c37",
        text: "#dde6e1",
        borderRegion: "#404c48",
        accent: interfaceColors.dark.accent,
        accentHover: "rgb(98 179 160 / 50%)",
        dragOrigin: "rgb(98 179 160 / 30%)",
        stripArea: "rgb(98 179 160 / 10%)",
        warning: "#cf9c45",
        danger: "#e5816f",
        parameterGeometry: "#c08fd0"
    }
} as const;

export type MapColors = typeof mapColors[Theme];

export const canvasText = {
    xs: 12,
    sm: 13,
    font: "\"Inter\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", system-ui, sans-serif",
    regular: 400,
    semibold: 600
} as const;

export const overlay = {
    selectedWidth: 2,
    hoverWidth: 1,
    handleRadius: 4,
    controlRadius: 3,
    handleOutline: 1.5,
    controlLine: 1,
    parameterWidth: 2,
    segmentWidth: 4,
    segmentHoverOpacity: .3,
    labelHalo: 3,
    dash: [6, 4]
} as const;

const fieldRamp = { light: [238, 242, 230], dark: [104, 140, 128] } as const;

export const baseMap = {
    ...reliefColors,
    light: {
        ...reliefThemes.light,
        fieldRamp: { low: fieldRamp.light, high: fieldRamp.dark },
        boundary: "#806d50",
        sectionLine: "rgb(38 71 70 / 60%)",
        fineGrid: "rgba(54,99,104,.10)",
        mainGrid: "rgba(54,99,104,.23)"
    },
    dark: {
        ...reliefThemes.dark,
        fieldRamp: { low: fieldRamp.dark, high: fieldRamp.light },
        boundary: "#d4c29f",
        sectionLine: "rgb(214 230 224 / 60%)",
        fineGrid: "rgb(200 225 220 / 8%)",
        mainGrid: "rgb(200 225 220 / 18%)"
    }
} as const;

const contourLines = [
    { opacity: 16, width: .9 },
    { opacity: 26, width: 1.1 },
    { opacity: 42, width: 1.5 },
    { opacity: 48, width: 1.8 },
    { opacity: 54, width: 2.2 }
] as const;
const contourLineColors = (rgb: string) => contourLines.map(({ opacity }) => `rgb(${rgb} / ${opacity}%)`);

export const contourStyle = {
    minSpacing: 5,
    labelSpacing: 18,
    labelLength: 80,
    labelInset: 40,
    labelRank: 2,
    lines: contourLines,
    zeroWidth: 1.4,
    light: { lines: contourLineColors("16 28 28"), zero: "#64909a" },
    dark: { lines: contourLineColors("226 236 231"), zero: "#7fb3be" }
} as const;

export const sectionColors = {
    ground: "#cec5a8",
    groundOutline: "#978e71"
} as const;