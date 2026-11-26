import { type Address, readAt, writeAt } from "./address.ts";
import { fieldPrecision, heightId, seedId } from "./defaults.ts";
import { type Expression, type FieldDeclaration, type GeoFunction } from "./v5.ts";
import { shiftDecimal } from "../math/interval.ts";

type Unit = "" | "m" | "m/m" | "%" | "px" | "field" | "field/m";
type Constraint = "positive" | "nonnegative" | "positive-integer" | "nonnegative-integer" | "percentage";
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
    default: Expression | ((id: string) => Expression);
    constraint?: Constraint;
    create?: Expression;
    profile?: true;
}
type GeometryDefault = "boundary" | "center" | "draw-line" | "draw-point" | "empty";
interface GeometryParameter extends ParameterBase { type: "geometry"; default: GeometryDefault }
type ParameterSpec = NumericParameter | GeometryParameter;
interface Toggle { key: Address; label: string; default: boolean }
interface FunctionSpec {
    name: string;
    initial: boolean;
    writes: "any" | "height";
    reading: "none" | "point" | "neighborhood";
    readArea?: "canvas";
    construction?: "strip";
    parameters: readonly ParameterSpec[];
}

const asKey = (key: string): Address => key.split(".").map(part => /^\d+$/.test(part) ? Number(part) : part);
function number<S extends ParameterStep, D extends NumericParameter["default"]>(key: string, label: string, unit: Unit, step: S, value: D,
    options: Partial<Pick<NumericParameter, "type" | "constraint" | "advanced" | "variant" | "create" | "profile">> = {}): NumericParameter & { step: S; default: D } {
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
export const slopeEndpointValues = [0, 2] as const;
export const defaultNodeSlope = .75;
export const smoothIncrement: Toggle = { key: ["ease"], label: "平滑增量过渡", default: false };
const mountainLineParameters = (group: "ridges" | "valleys", label: string) => [
    geometry(group, label, "empty"),
    geometry(group + ".*.curve", label + "线", "draw-line"),
    number(group + ".*.curve.nodes.*.h", "高度", "field", "field", 0, { profile: true }),
    number(group + ".*.curve.nodes.*.slope", "坡度", "m/m", .01, defaultNodeSlope, { profile: true, constraint: "positive" })
];
export const functionTable: Record<GeoFunction["type"], FunctionSpec> = {
    ground: { name: "定值", initial: true, writes: "any", reading: "none", parameters: [
        number("value", "数值", "field", "field", 0)
    ] },
    coast: { name: "海岸", initial: false, writes: "height", reading: "point", readArea: "canvas", parameters: [
        geometry("shore", "海岸线", "boundary"),
        number("roughness", "海岸粗糙度", "m", .1, 6, { type: "field" }),
        geometry("harbor.center", "港湾圆心", "center"),
        number("harbor.radius", "港湾半径", "m", 1, 0, { constraint: "nonnegative" }),
        number("harbor.span", "过渡宽度", "m", 1, 3, { constraint: "positive" }), seed
    ] },
    mountain: { name: "山脉", initial: false, writes: "height", reading: "point", parameters: [
        floor, seed, ...mountainLineParameters("ridges", "山脊"), ...mountainLineParameters("valleys", "山谷"),
        geometry("peaks", "山峰", "empty"),
        number("crestRound", "圆角半径", "m", .1, 4, advanced),
        number("footRound", "边缘过渡高度", "m", .1, 5, advanced),
        number("blend", "融合高度", "m", .1, 5, advanced),
        geometry("peaks.*.at", "位置", "draw-point"),
        number("peaks.*.height", "高度", "field", "field", 0),
        number("peaks.*.radius", "半径", "m", .1, 5, { constraint: "positive" }),
        number("peaks.*.noise", "半径起伏", "m", .1, 0),
        number("peaks.*.scale", "噪声尺度", "m", 1, 12, { constraint: "positive" })
    ] },
    cliff: { name: "海崖", initial: false, writes: "height", reading: "neighborhood", readArea: "canvas", parameters: [
        number("factor", "悬崖系数", "m/m", .05, .6, { type: "field" }), sea, seed
    ] },
    erosion: { name: "侵蚀", initial: false, writes: "height", reading: "neighborhood", parameters: [
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
        number("lifetime", "流动距离", "m", 1, 50, { ...advanced, constraint: "positive" }),
        number("spacing", "计算间距", "m", .1, id => "{geo:" + id + ".radius} / 2", { ...advanced, constraint: "positive" })
    ] },
    islets: { name: "礁石", initial: false, writes: "height", reading: "neighborhood", readArea: "canvas", parameters: [
        number("density", "礁石密度", "", .05, .5, { type: "field" }),
        number("reach", "离岸距离", "m", 1, 12, { constraint: "nonnegative" }),
        number("threshold", "密度阈值", "", .01, .45), sea, seed
    ] },
    flat: { name: "升降", initial: false, writes: "any", reading: "point", parameters: [
        number("amount", "增量", "field", "field", 1, { type: "field" }), feather
    ] },
    slope: { name: "坡面", initial: false, writes: "any", reading: "point", parameters: [
        geometry("lines", "坡线", "empty", "path"),
        geometry("lines.*.curve", "坡线", "draw-line", "path"),
        number("lines.*.curve.nodes.*.h", "增量", "field", "field", slopeEndpointValues[0], { variant: "path", profile: true }),
        geometry("center", "圆心", "center", "radial"),
        number("radius", "半径", "m", .1, 5, { variant: "radial" }),
        number("value", "增量", "field", "field", 2, { variant: "radial" }),
        number("rate", "径向变化率", "field/m", "field", -.2, { variant: "radial" })
    ] },
    noise: { name: "噪声", initial: false, writes: "any", reading: "point", parameters: [
        number("amplitude", "振幅", "field", "field", 1, { type: "field" }),
        number("scale", "噪声尺度", "m", 1, 24, { constraint: "positive" }),
        number("octaves", "倍频数", "", 1, 5, { constraint: "positive-integer" }), feather, seed,
        number("warp", "取样扭曲", "m", .1, 0, advanced),
        number("warpScale", "扭曲尺度", "m", 1, 60, { advanced: true, constraint: "positive" }),
        number("carve", "沟谷深度", "%", 1, 0, { advanced: true, constraint: "percentage" })
    ] },
    blend: { name: "过渡", initial: false, writes: "any", reading: "neighborhood", construction: "strip", parameters: [] },
    split: { name: "断开", initial: false, writes: "any", reading: "neighborhood", construction: "strip", parameters: [] },
    batter: { name: "放坡", initial: false, writes: "height", reading: "neighborhood", construction: "strip", parameters: [
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

export function functionParameters(f: GeoFunction | GeoFunction<number, "resolved">) {
    return functionTable[f.type].parameters.filter(p => !p.variant || f.type === "slope" && p.variant === f.kind);
}

export function canWrite(type: GeoFunction["type"], field: string) {
    return functionTable[type].writes === "any" || field === heightId;
}

export function parameterDefault(spec: NumericParameter, id: string): Expression {
    return typeof spec.default === "function" ? spec.default(id) : spec.default;
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

export function fillFunctionParameters(f: GeoFunction, prefix: Address = [], id?: string) {
    for (const p of functionTable[f.type].parameters) {
        if (p.type === "geometry") {
            if (!prefix.length && p.default === "empty" && readAt(f, p.key) === undefined) writeAt(f, p.key, []);
        }
        else if (!p.profile && (id !== undefined || typeof p.default !== "function")) for (const key of expandKeys(f, p.key))
            if (prefix.every((part, i) => key[i] === part) && readAt(f, key) === undefined) writeAt(f, key, p.create ?? parameterDefault(p, id ?? ""));
    }
    return f;
}

export function numericValid(p: NumericParameter, value: unknown) {
    if (p.type === "field" && typeof value === "string") return true;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (p.type === "seed" && !Number.isSafeInteger(value)) return false;
    if (!p.constraint) return true;
    if (p.constraint === "percentage") return value >= 0 && value <= 100;
    if (p.constraint.endsWith("-integer") && !Number.isSafeInteger(value)) return false;
    return p.constraint.startsWith("nonnegative") ? value >= 0 : value > 0;
}
export function fieldExpressions(f: GeoFunction<number, "resolved">): Expression[] {
    return functionParameters(f).flatMap(p => p.type === "field" ? expandKeys(f, p.key).map(key => readAt(f, key) as Expression) : []);
}