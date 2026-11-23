export const palette = {
    bgApp: "#f9faf6",
    bgPanel: "#fffefa",
    bgSelected: "#e2ece4",
    text: "#233d37",
    textSecondary: "#657570",
    border: "#d9dfd7",
    accent: "#226659",
    accentHover: "rgb(34 102 89 / 50%)",
    stripArea: "rgb(34 102 89 / 10%)",
    warning: "#ad771c",
    danger: "#a34839",
    parameterGeometry: "#8b4f9a"
} as const;

export const canvasText = {
    xs: 11,
    sm: 12,
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
    fieldContours: "#38597d",
    heightContours: ["#64909a", "rgba(70,58,40,.13)", "rgba(70,58,40,.25)", "rgba(70,58,40,.53)"],
    woodsOutline: "rgba(40,60,30,.48)",
    boundary: "#806d50",
    deckEdge: "#806546",
    roadEdge: "#9b896c",
    roadSurface: "#f0e4cc",
    stairTread: "#89775a",
    vegetationRoom: "#b5d49a",
    vegetationOutline: "#4f7a3a",
    vegetationBloom: "#d9a3b8",
    yardTree: "#9cc584",
    rectBuilding: "#4b453a",
    ringBuilding: "#485453",
    circleBuilding: "#7a3a28",
    sectionLine: "rgba(40,75,74,.6)",
    fineGrid: "rgba(54,99,104,.10)",
    mainGrid: "rgba(54,99,104,.23)"
} as const;

export const sectionColors = {
    ground: "#cec5a8",
    groundOutline: "#978e71",
    trunk: "#806d4e"
} as const;

export { treeStyles } from "../core/vegetation/vegetation.ts";