export const palette = {
    bgApp: "#f9faf6",
    bgPanel: "#fffefa",
    bgSelected: "#e2ece4",
    text: "#233d37",
    textSecondary: "#657570",
    border: "#d9dfd7",
    borderRegion: "#c4ccc1",
    accent: "#226659",
    accentHover: "rgb(34 102 89 / 50%)",
    dragOrigin: "rgb(34 102 89 / 30%)",
    stripArea: "rgb(34 102 89 / 10%)",
    warning: "#ad771c",
    danger: "#a34839",
    parameterGeometry: "#8b4f9a"
} as const;

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
    labelHalo: 3,
    dash: [6, 4]
} as const;

// These are the existing terrain and surface colors.
export const baseMap = {
    elevation: [
        [0, 226, 231, 200],
        [4, 204, 221, 168],
        [8, 182, 209, 146],
        [13, 160, 192, 124],
        [18, 190, 183, 138],
        [24, 176, 158, 122],
        [32, 154, 134, 104]
    ],
    waterShallow: [186, 221, 230],
    waterDepthDelta: [36, 26, 18],
    rock: [163, 157, 143],
    sand: [232, 222, 190],
    fieldRamp: { light: [238, 242, 230], dark: [104, 140, 128] },
    boundary: "#806d50",
    sectionLine: "rgba(40,75,74,.6)",
    fineGrid: "rgba(54,99,104,.10)",
    mainGrid: "rgba(54,99,104,.23)"
} as const;

export const contourStyle = {
    minSpacing: 5,
    labelSpacing: 18,
    labelLength: 80,
    labelInset: 40,
    labelRank: 2,
    lines: [
        { color: "rgb(16 28 28 / 16%)", width: .9 },
        { color: "rgb(16 28 28 / 26%)", width: 1.1 },
        { color: "rgb(16 28 28 / 42%)", width: 1.5 },
        { color: "rgb(16 28 28 / 48%)", width: 1.8 },
        { color: "rgb(16 28 28 / 54%)", width: 2.2 }
    ],
    zero: { color: "#64909a", width: 1.4 }
} as const;

export const sectionColors = {
    ground: "#cec5a8",
    groundOutline: "#978e71"
} as const;