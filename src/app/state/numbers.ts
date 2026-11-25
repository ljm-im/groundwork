import { literalPattern, tokens } from "../../core/design/expression.ts";
import { type Slot } from "../../core/design/parameters.ts";
import { isBuiltin } from "../../core/design/defaults.ts";
import { type Design, type Expression } from "../../core/design/v5.ts";

export const composingKey = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

export type Range = [number, number, number];
export function numericText(text: string, literal: boolean) {
    const trimmed = text.trim().replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
    if (literalPattern.test(trimmed) && Number.isFinite(Number(trimmed))) return Number(trimmed);
    if (literal) throw Error("这里只能输入一个数");
    return trimmed;
}
export function adjustInputStep(value: number, steps: number) {
    for (let i = 0; i < Math.abs(steps); i++) {
        const power = Math.floor(Math.log10(value));
        const candidates = [power - 1, power, power + 1].flatMap(exponent =>
            [1, 2, 5].map(digit => Number(digit + "e" + exponent))).filter(n => n > 0 && Number.isFinite(n));
        const next = steps < 0 ? candidates.findLast(n => n < value) : candidates.find(n => n > value);
        if (next === undefined) break;
        value = next;
    }
    return value;
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
    let next = sumSteps(initial, sumSteps(0, steps * step));
    if (parts[before]?.text === "/" && initial * steps < 0) {
        const zeroStep = Math.abs(initial / step);
        if (Math.abs(zeroStep - Math.round(zeroStep)) < 1e-10 && Math.round(zeroStep) <= Math.abs(steps))
            next = sumSteps(next, Math.sign(steps) * step);
    }
    if (operator && binary) {
        if (next === 0 && i === parts.length - 1 && parts.findIndex(t => literalPattern.test(t.text)) === i)
            return value.slice(0, operator.start).trimEnd() + value.slice(literal.end);
        return value.slice(0, operator.start) + (next < 0 ? "-" : "+") + value.slice(operator.end, literal.start) + Math.abs(next) + value.slice(literal.end);
    }
    return value.slice(0, signed ? last.start : literal.start) + next + value.slice(literal.end);
}

export class NumberDrag {
    moved = false;
    private x = 0;
    private y = 0;
    private pixels = 0;
    private skipMove = false;

    lockChanged() {
        this.skipMove = true;
    }

    move(dx: number, dy: number, shift: boolean, ctrl: boolean) {
        if (this.skipMove) {
            this.skipMove = false;
            return 0;
        }
        if (Math.abs(dx) > 64 || Math.abs(dy) > 64) return 0;
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
    if (kind === "field") return { icon: "field" as const, builtin: isBuiltin("field", id), name: d.fields[id]?.label ?? id };
    const s = slots.get(key);
    if (kind === "input") return { icon: "inputs" as const, builtin: isBuiltin("input", id), name: d.inputs[id]?.label ?? id };
    return { icon: "property", builtin: false, name: s?.name ?? id, property: s?.label } as const;
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
export function flagOverflow(el: HTMLElement) {
    const measure = () => el.toggleAttribute("data-overflow", el.scrollWidth > el.clientWidth);
    const resize = new ResizeObserver(measure), label = el.firstElementChild;
    const content = label ? undefined : new MutationObserver(measure);
    resize.observe(el);
    // The numeric label keeps its natural width so overflow is measured after layout.
    if (label) resize.observe(label);
    else content?.observe(el, { childList: true, subtree: true, characterData: true });
    measure();
    return { destroy() {
        resize.disconnect(); content?.disconnect();
    } };
}

export function chipSpans(input: HTMLElement) {
    let start = 0;
    return Array.from(input.childNodes).flatMap(node => {
        const end = start + editorText(node).length;
        const span = { node, start, end };
        start = end;
        return node instanceof HTMLElement && node.dataset.ref ? [span] : [];
    });
}

export function caretOffsetAt(input: HTMLElement, x: number, y: number) {
    const range = input.ownerDocument.createRange();
    let start = 0, nearest = 0, best = Infinity;
    function consider(at: number, left: number, top: number, bottom: number) {
        const dy = Math.max(top - y, y - bottom, 0), distance = Math.hypot(left - x, dy);
        if (distance < best) {
            nearest = at; best = distance;
        }
    }
    for (const node of input.childNodes) {
        const length = editorText(node).length;
        if (node instanceof HTMLElement && node.dataset.ref) {
            const { left, top, right, bottom } = node.getBoundingClientRect();
            if (x >= left && x <= right && y >= top && y <= bottom) return x < (left + right) / 2 ? start : start + length;
            consider(start, left, top, bottom);
            consider(start + length, right, top, bottom);
        }
        else if (node.nodeType === Node.TEXT_NODE && length) {
            for (let i = 0; i <= length; i++) {
                range.setStart(node, i); range.collapse(true);
                const { left, top, bottom, height } = range.getBoundingClientRect();
                if (height) consider(start + i, left, top, bottom);
            }
        }
        start += length;
    }
    return nearest;
}

export function authoredCaret(source: string, displayed: string, offset: number) {
    if (offset === displayed.length) return source.length;
    if (!offset || source === displayed) return offset;
    try {
        const raw = tokens(source), visual = tokens(displayed.replaceAll("×", "*").replaceAll("÷", "/"));
        const index = visual.findIndex(t => offset <= t.end);
        if (index >= 0 && raw.length === visual.length) {
            const from = visual[index], to = raw[index];
            return offset === from.end ? to.end : Math.min(to.end, to.start + offset - from.start);
        }
    }
    catch { /* An invalid expression can still open for editing. */ }
    return Math.min(offset, source.length);
}

export function editorSelection(el: HTMLElement, anchor: number, focus = anchor) {
    function point(at: number): [Node, number] {
        for (const [i, child] of Array.from(el.childNodes).entries()) {
            const length = editorText(child).length;
            if (at <= length) return child.nodeType === Node.TEXT_NODE ? [child, at] : [el, i + Number(at > 0)];
            at -= length;
        }
        return [el, el.childNodes.length];
    }
    el.ownerDocument.getSelection()?.setBaseAndExtent(...point(anchor), ...point(focus));
}

export function numericCaret(input: HTMLElement) {
    const wrapper = input.parentElement!;
    function update() {
        const selection = input.ownerDocument.getSelection();
        const [start, end] = selectionOffsets(input);
        for (const chip of chipSpans(input)) if (chip.node instanceof HTMLElement)
            chip.node.toggleAttribute("data-selected", chip.start >= start && chip.end <= end);
        const lineHeight = parseFloat(getComputedStyle(input).lineHeight);
        let x: number | undefined, y = input.getBoundingClientRect().top;
        if (selection?.isCollapsed && selection.rangeCount && document.activeElement === input && input.contains(selection.anchorNode)) {
            const range = selection.getRangeAt(0).cloneRange(), rect = range.getBoundingClientRect();
            if (rect.height) {
                x = rect.left; y = rect.top + (rect.height - lineHeight) / 2;
            }
            else {
                // Chromium returns an empty rectangle at element boundaries beside noneditable chips.
                const parent = range.startContainer, offset = range.startOffset;
                const next = parent.childNodes[offset], previous = parent.childNodes[offset - 1];
                if (next || previous) {
                    range.selectNode(next ?? previous);
                    const edge = range.getBoundingClientRect();
                    x = next ? edge.left : edge.right;
                    y = edge.top + (edge.height - lineHeight) / 2;
                }
                else {
                    const box = input.getBoundingClientRect();
                    x = box.left + box.width / 2;
                }
            }
        }
        wrapper.style.setProperty("--caret-display", x === undefined ? "none" : "block");
        if (x !== undefined) {
            const box = wrapper.getBoundingClientRect();
            wrapper.style.setProperty("--caret-x", x - box.left + "px");
            wrapper.style.setProperty("--caret-y", y - box.top + "px");
        }
    }
    const resize = new ResizeObserver(update); resize.observe(input);
    const controller = new AbortController(), options = { signal: controller.signal };
    document.addEventListener("selectionchange", update, options);
    for (const event of ["focus", "blur", "input", "scroll"]) input.addEventListener(event, update, options);
    return { destroy() {
        resize.disconnect(); controller.abort();
    } };
}