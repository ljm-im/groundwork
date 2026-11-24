import { type Expression } from "./v5.ts";

export const literalPattern = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const tokenPattern = /\s+|\{[^{}]+\}|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[-+*/()]/gy;
export interface Token { text: string; start: number; end: number }
export function tokens(source: string): Token[] {
    const result: Token[] = [];
    for (let start = 0; start < source.length;) {
        tokenPattern.lastIndex = start;
        const match = tokenPattern.exec(source);
        if (!match) throw Error("第 " + (start + 1) + " 个字符无法识别");
        const text = match[0], end = start + text.length;
        if (text.startsWith("{") && !/^\{(?:input|field|geo):[^{}]+\}$/.test(text))
            throw Error("第 " + (start + 1) + " 个字符无法识别，未知的变量 " + text);
        if (text.trim()) result.push({ text, start, end });
        start = end;
    }
    return result;
}

export type Value = number | { offset: number; terms: [string, number][] };
function checked(n: number) {
    if (!Number.isFinite(n)) throw Error("数值必须有限");
    return n;
}
function scaled(v: Value, k: number): Value {
    return typeof v === "number" ? checked(v * k) : { offset: checked(v.offset * k), terms: v.terms.map(([field, n]) => [field, checked(n * k)]) };
}
function combine(a: Value, op: string, b: Value): Value {
    if (op === "*") {
        if (typeof a === "number") return scaled(b, a);
        if (typeof b === "number") return scaled(a, b);
        throw Error("场不能与场相乘");
    }
    if (op === "/") {
        if (typeof b !== "number") throw Error("除数不能是场");
        if (b === 0) throw Error("除数不能为 0");
        return typeof a === "number" ? checked(a / b) : scaled(a, 1 / b);
    }
    if (op === "-") b = scaled(b, -1);
    if (typeof a === "number" && typeof b === "number") return checked(a + b);
    const left = typeof a === "number" ? { offset: a, terms: [] } : a;
    const right = typeof b === "number" ? { offset: b, terms: [] } : b;
    return { offset: checked(left.offset + right.offset), terms: [...left.terms, ...right.terms] };
}
export const fieldValue = (name: string): Value => ({ offset: 0, terms: [[name, 1]] });
export function evaluate(value: Expression, ref: (key: string) => Value): Value {
    if (typeof value === "number") return checked(value);
    if (typeof value !== "string") throw Error("未知的参数格式，需要数字或表达式字符串");
    const parts = tokens(value);
    let i = 0;
    const peek = () => parts[i]?.text;
    function atom(): Value {
        const part = parts[i++];
        if (!part) throw Error("缺少数字或变量");
        if (part.text === "-") return scaled(atom(), -1);
        if (part.text === "(") {
            const v = sum();
            if (parts[i++]?.text !== ")") throw Error("缺少右括号");
            return v;
        }
        if (part.text.startsWith("{")) return ref(part.text.slice(1, -1));
        if (!literalPattern.test(part.text)) throw Error("第 " + (part.start + 1) + " 个字符需要数字或变量");
        return checked(Number(part.text));
    }
    function product(): Value {
        let v = atom();
        while (peek() === "*" || peek() === "/") v = combine(v, parts[i++].text, atom());
        return v;
    }
    function sum(): Value {
        let v = product();
        while (peek() === "+" || peek() === "-") v = combine(v, parts[i++].text, product());
        return v;
    }
    const result = sum();
    if (i < parts.length) throw Error("第 " + (parts[i].start + 1) + " 个字符处缺少运算符或括号不匹配");
    return result;
}
export function sampleValue(v: Value, read: (field: string) => number | undefined) {
    if (typeof v === "number") return v;
    let result = v.offset;
    for (const [field, scale] of v.terms) {
        const sample = read(field);
        if (sample === undefined) return;
        result += sample * scale;
    }
    return result;
}
export function references(v: Expression) {
    return typeof v === "string" ? tokens(v).filter(t => t.text.startsWith("{")).map(t => t.text.slice(1, -1)) : [];
}