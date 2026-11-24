import { type Expression } from "./v5.ts";

function fractionDigits(value: number) {
    const [mantissa, exponent] = String(Math.abs(value)).split("e");
    return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent ?? 0));
}

export function displayValue(value: Expression | undefined, step: number, unit = "", name?: (key: string) => string): string {
    if (typeof value === "string") {
        return value.replace(/\{([^{}]+)\}|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[*/]/g, (part, key?: string) => {
            if (key) return name?.(key) ?? part;
            if (part === "*") return "×";
            if (part === "/") return "÷";
            return displayValue(Number(part), step);
        });
    }
    if (value === undefined || !Number.isFinite(value)) return "–";
    const digits = Math.max(fractionDigits(step), fractionDigits(Number(value.toFixed(4))));
    const rounded = digits > 100 ? String(value) : value.toFixed(digits);
    return (Number(rounded) === 0 ? rounded.replace(/^-/, "") : rounded) + (unit && unit !== "%" ? " " + unit : unit);
}

export function displayReading(value: number | undefined, precision: number, unit = "") {
    if (value === undefined || !Number.isFinite(value)) return "–";
    const digits = fractionDigits(precision);
    return displayValue(digits > 100 ? value : Number(value.toFixed(digits)), precision, unit);
}