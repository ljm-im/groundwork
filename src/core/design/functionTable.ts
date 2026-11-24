import { type Address, readAt, writeAt } from "./address.ts";
import { fieldPrecision, heightId, seedId } from "./defaults.ts";
import { type Expression, type FieldDeclaration, type GeoFunction } from "./v5.ts";
import { shiftDecimal } from "../math/interval.ts";

type Unit = "" | "m" | "m/m" | "%" | "px" | "field" | "field/m";
type Constraint = "positive" | "nonnegative" | "positive-integer" | "nonnegative-integer";
type ParameterStep = number | "field";
interface ParameterBase {
    key: Address;
    label: string;
    unit: Unit;
    step: ParameterStep;
    advanced: boolean;
    variant?: "path" | "radial";
}
export interface NumericParameter extends ParameterBase {
    type: "number" | "field" | "seed";
    default: Expression;
    constraint?: Constraint;
    create?: Expression;
    profile?: true;
}
type GeometryDefault = "boundary" | "center" | "axis" | "draw-line" | "draw-point" | "empty";
interface GeometryParameter extends ParameterBase { type: "geometry"; default: GeometryDefault }
type ParameterSpec = NumericParameter | GeometryParameter;
interface Toggle { key: Address; label: string; default: boolean }
interface FunctionSpec {
    initial: boolean;
    writes: "any" | "height";
    reading: "none" | "point" | "neighborhood";
    readArea?: "canvas";
    construction?: "strip";
    parameters: readonly ParameterSpec[];
    toggles?: readonly Toggle[];
}

const asKey = (key: string): Address => key.split(".").map(part => /^\d+$/.test(part) ? Number(part) : part);
function number<S extends ParameterStep>(key: string, label: string, unit: Unit, step: S, value: Expression,
    options: Partial<Pick<NumericParameter, "type" | "constraint" | "advanced" | "variant" | "create" | "profile">> = {}): NumericParameter & { step: S } {
    return { key: asKey(key), label, unit, step, default: value, type: "number", advanced: false, ...options };
}
function geometry(key: string, label: string, value: GeometryDefault, variant?: GeometryParameter["variant"]): GeometryParameter {
    return { key: asKey(key), label, unit: "", step: .1, default: value, type: "geometry", advanced: false, variant };
}
const seed = number("seed", "种子", "", 1, 0, { type: "seed", create: "{input:" + seedId + "}" });
const floor = number("floor", "作用下限", "m", 1, -1000);
const sea = number("seaLevel", "海平面", "m", .1, 0);
const feather = number("feather", "羽化宽度", "m", .1, 0, { constraint: "nonnegative" });
const advanced = { advanced: true, constraint: "nonnegative" } as const;
const ridgeNoise = (key: string, label: string) => [
    number("ridges.*." + key + ".amount", label + "幅度", "%", 1, 0),
    number("ridges.*." + key + ".wavelength", label + "波长", "m", 1, 20, { constraint: "positive" })
];

export const slopeEndpointValues = [0, 2] as const;
export const functionTable: Record<GeoFunction["type"], FunctionSpec> = {
    ground: { initial: true, writes: "any", reading: "none", parameters: [
        number("value", "数值", "field", "field", 0)
    ] },
    coast: { initial: false, writes: "height", reading: "point", readArea: "canvas", parameters: [
        geometry("shore", "海岸线", "boundary"),
        number("roughness", "海岸粗糙度", "m", .1, 6, { type: "field" }),
        geometry("harbor.center", "港湾圆心", "center"),
        number("harbor.radius", "港湾半径", "m", 1, 0, { constraint: "nonnegative" }),
        number("harbor.span", "过渡宽度", "m", 1, 3, { constraint: "positive" }), seed
    ] },
    mountain: { initial: false, writes: "height", reading: "point", parameters: [
        floor, seed, geometry("ridges", "山脊", "empty"), geometry("peaks", "山峰", "empty"),
        geometry("ridges.*.line", "山脊线", "draw-line"),
        number("ridges.*.line.points.*.h", "高度", "field", "field", 0, { profile: true }),
        number("ridges.*.widths.0", "左侧宽度", "m", .1, 5, { constraint: "positive" }),
        number("ridges.*.widths.1", "右侧宽度", "m", .1, 5, { constraint: "positive" }),
        ...ridgeNoise("widthNoise", "宽度起伏"), ...ridgeNoise("heightNoise", "高度起伏"),
        geometry("peaks.*.at.p", "位置", "draw-point"),
        number("peaks.*.at.h", "高度", "field", "field", 0),
        number("peaks.*.radius", "半径", "m", .1, 5, { constraint: "positive" }),
        number("peaks.*.noise", "半径起伏", "m", .1, 0),
        number("peaks.*.scale", "噪声尺度", "m", 1, 12, { constraint: "positive" })
    ], toggles: [{ key: ["ridges", "*", "line", "smooth"], label: "平滑折线", default: false }] },
    cliff: { initial: false, writes: "height", reading: "neighborhood", readArea: "canvas", parameters: [
        number("factor", "悬崖系数", "m/m", .05, .6, { type: "field" }), sea, seed
    ] },
    erosion: { initial: false, writes: "height", reading: "neighborhood", parameters: [
        number("strength", "侵蚀强度", "", .1, 1, { type: "field" }), floor,
        number("radius", "作用半径", "m", .5, 2, { constraint: "positive" }), seed,
        number("droplets", "水滴数", "", 1000, 40000, { ...advanced, constraint: "nonnegative-integer" }),
        number("inertia", "惯性", "", .01, .06, advanced),
        number("capacity", "携沙能力", "", .1, 5, advanced),
        number("minCapacity", "最小携沙量", "", .001, .002, advanced),
        number("deposition", "沉积率", "", .01, .25, advanced),
        number("erosion", "侵蚀率", "", .01, .35, advanced),
        number("evaporation", "蒸发率", "", .01, .02, advanced),
        number("gravity", "重力", "", .1, 6, advanced),
        number("lifetime", "流动距离", "m", 1, 50, { ...advanced, constraint: "positive" })
    ] },
    islets: { initial: false, writes: "height", reading: "neighborhood", readArea: "canvas", parameters: [
        number("density", "礁石密度", "", .05, .5, { type: "field" }),
        number("reach", "离岸距离", "m", 1, 12, { constraint: "nonnegative" }),
        number("threshold", "密度阈值", "", .01, .45), sea, seed
    ] },
    flat: { initial: false, writes: "any", reading: "point", parameters: [
        number("amount", "增量", "field", "field", 1, { type: "field" }), feather
    ] },
    slope: { initial: false, writes: "any", reading: "point", parameters: [
        geometry("line", "坡线", "axis", "path"),
        number("line.points.*.h", "增量", "field", "field", slopeEndpointValues[0], { variant: "path", profile: true }),
        geometry("center", "圆心", "center", "radial"),
        number("radius", "半径", "m", .1, 5, { variant: "radial" }),
        number("value", "增量", "field", "field", 2, { variant: "radial" }),
        number("rate", "径向变化率", "field/m", "field", -.2, { variant: "radial" })
    ], toggles: [{ key: ["line", "smooth"], label: "平滑折线", default: false }, { key: ["ease"], label: "平滑增量过渡", default: false }] },
    noise: { initial: false, writes: "any", reading: "point", parameters: [
        number("amplitude", "振幅", "field", "field", 1, { type: "field" }),
        number("scale", "噪声尺度", "m", 1, 24, { constraint: "positive" }),
        number("octaves", "倍频数", "", 1, 5, { constraint: "positive-integer" }), feather, seed
    ] },
    blend: { initial: false, writes: "any", reading: "neighborhood", construction: "strip", parameters: [] },
    split: { initial: false, writes: "any", reading: "neighborhood", construction: "strip", parameters: [] },
    batter: { initial: false, writes: "height", reading: "neighborhood", construction: "strip", parameters: [
        number("grade", "放坡坡度", "m/m", .01, .5, { constraint: "positive" })
    ] }
};

export function isBuiltinFunction(id: string) {
    return Object.hasOwn(functionTable, id);
}

export const markParameters = {
    text: number("elevation", "高度", "m", .1, 0),
    scale: number("length", "长度", "m", 1, 10, { constraint: "positive" })
};
export const gridStep = number("grid.step", "采样间距", "m", .25, 1, { constraint: "positive" });
export const displaySteps = { gridUnits: 1, gridPixels: 1, coordinates: .1, coordinateUnit: "m", section: .01, length: .1 };

const sharedStripWidths = [number("widths.0", "第一侧宽度", "m", .1, 1), number("widths.1", "第二侧宽度", "m", .1, 1)];
const singleStripWidths = [number("widths.0", "向内", "m", .1, 0), number("widths.1", "向外", "m", .1, 6)];
export const stripWidths = (shared: boolean) => shared ? sharedStripWidths : singleStripWidths;

export function matchesKey(template: Address, path: Address) {
    return template.length === path.length && template.every((part, i) => part === path[i] || part === "*" && typeof path[i] === "number");
}

export function functionParameters(f: GeoFunction) {
    return functionTable[f.type].parameters.filter(p => !p.variant || f.type === "slope" && p.variant === f.kind);
}

export function canWrite(type: GeoFunction["type"], field: string) {
    return functionTable[type].writes === "any" || field === heightId;
}

export function parameterStep(spec: ParameterSpec, field?: FieldDeclaration) {
    if (spec.step !== "field") return spec.step;
    const precision = fieldPrecision(field);
    return spec.unit === "field/m" ? Math.max(Number.MIN_VALUE, shiftDecimal(precision, -1)) : precision;
}

export function parameterUnit(spec: ParameterSpec, unit = "") {
    if (spec.unit === "field") return unit;
    if (spec.unit === "field/m") return unit + "/m";
    return spec.unit;
}

export function expandKeys(root: object, key: Address): Address[] {
    let paths: Address[] = [[]];
    for (const part of key) paths = paths.flatMap(path => {
        if (part !== "*") return [[...path, part]];
        const group = readAt(root, path);
        return Array.isArray(group) ? group.map((_, i) => [...path, i]) : [];
    });
    return paths;
}

export function fillFunctionParameters(f: GeoFunction, prefix: Address = []) {
    for (const p of functionParameters(f)) {
        if (p.type === "geometry") {
            if (!prefix.length && p.default === "empty" && readAt(f, p.key) === undefined) writeAt(f, p.key, []);
        }
        else if (!p.profile) for (const key of expandKeys(f, p.key))
            if (prefix.every((part, i) => key[i] === part) && readAt(f, key) === undefined) writeAt(f, key, p.create ?? p.default);
    }
    return f;
}

export function numericValid(p: NumericParameter, value: unknown) {
    if (p.type === "field" && typeof value === "string") return true;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (p.type === "seed" && !Number.isSafeInteger(value)) return false;
    if (!p.constraint) return true;
    if (p.constraint.endsWith("-integer") && !Number.isSafeInteger(value)) return false;
    return p.constraint.startsWith("nonnegative") ? value >= 0 : value > 0;
}
export function fieldExpressions(f: GeoFunction): Expression[] {
    return functionParameters(f).flatMap(p => p.type === "field" ? expandKeys(f, p.key).map(key => readAt(f, key) as Expression) : []);
}