import { literalPattern, tokens } from "../../core/design/expression.ts";
import { parameters, type Slot } from "../../core/design/parameters.ts";
import { type Design, type Expression } from "../../core/design/v5.ts";

export type Range = [number, number, number];
export function numericText(text: string, literal: boolean) {
    const trimmed = text.trim().replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
    if (literalPattern.test(trimmed) && Number.isFinite(Number(trimmed))) return Number(trimmed);
    if (literal) throw Error("这里只能输入一个数");
    return trimmed;
}
export function displayNumber(n: number, step: number) {
    const [mantissa, exponent] = String(step).split("e");
    return n.toFixed(Math.min(100, Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent ?? 0))));
}
const sumSteps = (v: number, delta: number) => Number((v + delta).toPrecision(15));
export function adjustNumber(value: Expression, steps: number, step: number, range?: Range): Expression {
    if (!steps) return value;
    if (typeof value === "number") {
        const next = sumSteps(value, steps * step);
        return range ? Math.max(range[0], Math.min(range[1], next)) : next;
    }
    const parts = tokens(value), i = parts.findLastIndex(t => literalPattern.test(t.text));
    if (i < 0) return adjustNumber(value + " + 0", steps, step);
    const literal = parts[i], last = parts[i - 1], signed = last?.text === "-";
    const operator = signed || last?.text === "+" ? last : undefined;
    const binary = operator && i > 1 && !["(", "+", "-", "*", "/"].includes(parts[i - 2].text);
    let before = i - (signed ? 2 : 1), closing = i + 1;
    while (parts[before]?.text === "(" && parts[closing]?.text === ")") {
        before--; closing++;
    }
    const initial = Number(literal.text) * (signed ? -1 : 1);
    let next = sumSteps(initial, steps * step);
    if (parts[before]?.text === "/" && initial * steps < 0) {
        const zeroStep = Math.abs(initial / step);
        if (Math.abs(zeroStep - Math.round(zeroStep)) < 1e-10 && Math.round(zeroStep) <= Math.abs(steps))
            next = sumSteps(next, Math.sign(steps) * step);
    }
    if (operator && binary) return value.slice(0, operator.start) + (next < 0 ? "-" : "+") + value.slice(operator.end, literal.start) + Math.abs(next) + value.slice(literal.end);
    return value.slice(0, signed ? last.start : literal.start) + next + value.slice(literal.end);
}

export class NumberDrag {
    moved = false;
    private x = 0;
    private y = 0;
    private pixels = 0;
    move(dx: number, dy: number, shift: boolean, ctrl: boolean) {
        this.x += dx; this.y += dy;
        this.pixels += dx * (shift ? .1 : 1) * (ctrl ? 10 : 1);
        this.moved ||= Math.hypot(this.x, this.y) > 3;
        const steps = this.moved ? Math.trunc(this.pixels / 4) : 0;
        this.pixels -= steps * 4;
        return steps;
    }
}
export function repeatButton(change: () => void) {
    change();
    let interval: ReturnType<typeof setInterval> | undefined;
    const delay = setTimeout(() => {
        change();
        interval = setInterval(change, 80);
    }, 400);
    return () => {
        clearTimeout(delay); clearInterval(interval);
    };
}

export function referenceLabel(key: string, d: Design, slots: Map<string, Slot>) {
    const kind = key.slice(0, key.indexOf(":")), id = key.slice(kind.length + 1);
    if (kind === "field") return { icon: "field" as const, name: id === "height" ? "高度" : d.fields[id]?.label ?? id };
    const s = slots.get(key);
    if (kind === "var") return { icon: "variables" as const, name: d.variables[id]?.label ?? id };
    const icon = kind === "geo" ? "terrain" : kind === "edge" ? "edge" : kind === "building" ? "building" : "node";
    return { icon, name: s?.name ?? id, property: s?.label } as const;
}
export function displayExpression(v: Expression, d: Design) {
    if (typeof v === "number") return String(v);
    const slots = parameters(d);
    return v.replace(/\{([^{}]+)\}/g, (_, key: string) => {
        const item = referenceLabel(key, d, slots);
        return item.name + (item.property ? " · " + item.property : "");
    }).replaceAll("*", "×").replaceAll("/", "÷");
}

// A reference chip occupies one caret stop and serializes to its full JSON reference.
export function editorText(node: Node): string {
    if (node instanceof HTMLElement && node.dataset.ref) return "{" + node.dataset.ref + "}";
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replaceAll("\u00a0", " ");
    return Array.from(node.childNodes, editorText).join("");
}
export function selectionOffsets(el: HTMLElement): [number, number] {
    const selection = el.ownerDocument.getSelection(), end = editorText(el).length;
    if (!selection?.rangeCount) return [end, end];
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return [end, end];
    function offset(node: Node, at: number) {
        const before = document.createRange();
        before.selectNodeContents(el); before.setEnd(node, at);
        return editorText(before.cloneContents()).length;
    }
    return [offset(range.startContainer, range.startOffset), offset(range.endContainer, range.endOffset)];
}
export function caretAt(el: HTMLElement, at: number) {
    const range = document.createRange();
    range.selectNodeContents(el); range.collapse(false);
    for (const child of el.childNodes) {
        const length = editorText(child).length;
        if (at <= length) {
            if (child.nodeType === Node.TEXT_NODE) range.setStart(child, at);
            else if (at === 0) range.setStartBefore(child);
            else range.setStartAfter(child);
            break;
        }
        at -= length;
    }
    range.collapse(true);
    const selection = el.ownerDocument.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
}