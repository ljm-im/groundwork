{#snippet formatted(text: string, operators: boolean)}
    {#each text.split(/(\{(?:var|field|geo|edge|node|building):[^{}]+\})/g) as part, i (i)}
        {#if part.startsWith("{") && part.endsWith("}")}<ReferenceChip refKey={part.slice(1, -1)} design={catalog} {slots} />
        {:else}{operators ? part.replaceAll("*", "×").replaceAll("/", "÷").replaceAll("-", "−") : part}{/if}
    {/each}
{/snippet}
<div class="number-row" data-parameter={address.join(".")} bind:this={root}>
    <div class="number-line"><span class="number-label">{label}</span>
        <div class="number-box" class:invalid={!!error} class:warning={outside} bind:this={box}>
            <button class="step" aria-label={"减小" + label} data-tip="减小" onpointerdown={e => beginGesture(e, -1)} onclick={e => keyboardStep(e, -1)}>‹</button>
            {#if editing}
                <div class="edit-face"><div class="numeric-edit" use:numericCaret role="textbox" aria-label={label} aria-invalid={!!error} data-tip={tip} contenteditable="true" spellcheck="false" tabindex="0"
                    bind:this={input} oninput={onInput} onkeydown={key} onblur={() => {
                        if (editing) finish(true);
                    }}
                    onpaste={e => {
                        e.preventDefault(); insertText(e.clipboardData?.getData("text/plain") ?? "");
                    }}></div></div>
                <div hidden bind:this={mirror}>{@render formatted(draft, false)}</div>
            {:else}
                <button class="numeric-face" aria-label={label} data-tip={tip} onpointerdown={e => beginGesture(e, 0)}
                    onclick={e => {
                        if (!e.detail) startEdit();
                    }}>
                    {#if typeof shown === "number"}{displayNumber(shown * displayFactor, step)}
                    {:else}{@render formatted(shown, true)}{/if}
                </button>
            {/if}
            <button class="step" aria-label={"增大" + label} data-tip="增大" onpointerdown={e => beginGesture(e, 1)} onclick={e => keyboardStep(e, 1)}>›</button>
            {#if kind !== "literal"}<button class="reference-toggle" data-tip="插入引用" aria-label={"为" + label + "插入引用"} aria-expanded={opened}
                onpointerdown={e => e.preventDefault()} onclick={() => {
                    if (opened) closeMenu(); else showMenu();
                }}>▾</button>{/if}
        </div>
        {#if unit}<small class="unit">{unit}</small>{/if}
    </div>
    {#if error}<div class="number-error" role="alert">{error}</div>{/if}
    {#if opened}
        <div class="reference-menu" role="listbox" tabindex="-1" aria-label="可用引用" popover="manual" use:anchoredPopup={{ anchor: box, close: closeMenu }} onpointerdown={e => e.preventDefault()}>
            {#if parent}<button class="ref-back" onclick={() => {
                parent = ""; active = 0;
            }}>‹ 返回</button>{/if}
            {#each groups as group (group.title)}
                <div class="ref-group"><div class="group-name">{group.title}</div>
                    {#each group.items as item (item.key)}
                        <button role="option" aria-selected={options[active]?.key === item.key} data-option={item.key}
                            onmouseenter={() => active = options.indexOf(item)} onclick={() => choose(item)}>
                            <Icon name={item.icon} />{item.name}{#if item.branch}<span class="sub-arrow">›</span>{/if}
                        </button>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
</div>
<style>
    .number-row { margin: 5px 0; }
    .number-line { display: flex; align-items: center; gap: 5px; min-height: 27px; }
    .number-label { flex: 1 1 32%; min-width: 0; font-size: 12px; }
    .number-label:empty { display: none; }
    .number-box { display: flex; align-items: stretch; flex: 2 1 64%; min-width: 0; border: 1px solid #b8c6ba; border-radius: 4px; background: #fffefa; }
    .number-box:focus-within { border-color: var(--teal); }
    .number-box.warning { border-color: #ad771c; }
    .number-box.invalid { border-color: var(--red); }
    .number-box button { min-height: 25px; padding: 0; background: transparent; border: 0; border-radius: 2px; }
    .number-box button:hover { background: var(--light); }
    .number-box .step, .number-box .reference-toggle { flex: 0 0 17px; color: var(--muted); touch-action: none; }
    .number-box .reference-toggle { border-left: 1px solid var(--line); }
    .numeric-face, .numeric-edit { display: block; flex: 1; min-width: 0; text-align: center; white-space: nowrap; font: inherit; font-size: 12px; line-height: 18px; }
    .numeric-face { cursor: ew-resize; user-select: none; overflow: hidden; text-overflow: ellipsis; touch-action: none; }
    .edit-face { position: relative; align-self: center; min-width: 0; flex: 1; overflow: hidden; --caret-height: 18px; }
    .edit-face::after { content: ""; display: var(--caret-display, none); position: absolute; left: var(--caret-x); top: 0; height: var(--caret-height); width: 1px; background: currentColor; pointer-events: none; animation: blink 1.1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .numeric-edit { caret-color: transparent; line-height: var(--caret-height); min-height: var(--caret-height); padding: 0 2px; outline: none; overflow-x: auto; scrollbar-width: none; white-space: pre; }
    .unit { color: var(--muted); font-size: 11px; }
    .number-error { color: var(--red); font-size: 11px; margin: 3px 0; }
    .reference-menu { position: fixed; z-index: 8; inset: auto; margin: 0; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 5px; box-shadow: 0 5px 22px #163e342e; padding: 4px; }
    .ref-group + .ref-group { border-top: 1px solid var(--line); }
    .group-name { font-size: 10px; color: var(--muted); margin: 4px 6px; }
    .ref-group button, .ref-back { display: flex; width: 100%; align-items: center; gap: 6px; justify-content: flex-start; border: none; background: transparent; min-height: 24px; font-size: 12px; }
    .ref-group button[aria-selected="true"] { background: var(--light); }
    .sub-arrow { margin-left: auto; }
</style>

<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { type Design, type Expression } from "../../core/design/v5.ts";
    import { canReference, expressionGraph, parameters, readAt, writeAt, type Address, type Owner } from "../../core/design/parameters.ts";
    import { evaluate, sampleValue } from "../../core/design/expression.ts";
    import { parseDesign } from "../../core/design/model.ts";
    import { addVariable, addField } from "../../core/edit/geoNodes.ts";
    import { offsetBuildingParts } from "../../core/edit/buildings.ts";
    import { adjustNumber, caretAt, displayNumber, editorText, NumberDrag, numericCaret, numericText, repeatButton, selectionOffsets, type Range } from "../state/numbers.ts";
    import { anchoredPopup } from "../state/popup.ts";
    import Icon from "./Icon.svelte";
    import ReferenceChip from "./ReferenceChip.svelte";
    let { editor, address, label, kind = "number", step = .1, range, unit = "", self, owner, displayFactor = 1 }: {
        editor: session.Editor; address: Address; label: string; kind?: "number" | "field" | "literal"; step?: number;
        range?: Range; unit?: string; self?: string; owner?: string; displayFactor?: number;
    } = $props();
    let root: HTMLElement, box = $state<HTMLElement>(null!), input = $state<HTMLElement>(null!), mirror = $state<HTMLElement>(null!);
    let base = $derived(editor.island.design), authored = $derived(readAt(base, address) as Expression | undefined);
    let value = $derived(authored ?? (readAt(editor.island.resolved, address) as number | undefined) ??
        (self ? expressionGraph(base).get(self) as number : 0));
    let editing = $state(false), draft = $state(""), error = $state(""), opened = $state(false), parent = $state(""), query = $state("");
    let queryStart = 0, queryEnd = 0;
    let active = $state(0);
    let catalogDraft = $state.raw<Design>(), catalog = $derived(catalogDraft ?? base), slots = $derived(parameters(catalog));
    let gesturing = $state(false), live = $state<Expression>(0), shown = $derived(gesturing ? live : value);
    let outside = $derived(typeof shown === "number" && range && (shown < range[0] || shown > range[1]));
    let tip = $derived.by(() => {
        if (typeof shown !== "string") return;
        const result = currentResult(shown);
        return result === undefined ? "= 未定义" : "= " + Number(displayNumber(result * displayFactor, step)) + (unit ? " " + unit : "");
    });
    let origin: Design | undefined, cleanup: (() => void) | undefined, version = 0;
    type IconName = "variables" | "field" | "terrain" | "edge" | "node" | "building" | "property" | "plus";
    type Option = { key: string; name: string; icon: IconName; branch?: boolean };
    type Group = { title: string; items: Option[] };
    const categories: [Owner, string, IconName][] = [["geo", "地件", "terrain"], ["edge", "道路", "edge"], ["node", "节点", "node"], ["building", "建筑", "building"]];
    let groups = $derived.by((): Group[] => {
        if (!opened) return [];
        const filter = (v: Option) => (v.name + " " + v.key).toLowerCase().includes(query.toLowerCase());
        const allowed = (key: string) => canReference(slots, self, key);
        const leaves = [...slots.values()].filter(s => !s.field && allowed(s.key));
        if (parent) return [{ title: leaves.find(s => s.owner + ":" + s.id === parent)?.name ?? "属性",
            items: leaves.filter(s => s.owner + ":" + s.id === parent).map(s => ({ key: s.key, name: s.label, icon: "property" as const })).filter(filter) }];
        const items: Option[] = leaves.filter(s => s.owner === "var").map(s => ({ key: s.key, name: s.name, icon: "variables" }));
        const result: Group[] = [{ title: "变量", items: [...items.filter(filter), { key: "+var", name: "新建变量", icon: "plus" }] }];
        if (kind === "field") {
            const fields = ["height", ...Object.keys(catalog.fields)].map(id => ({ key: "field:" + id, name: catalog.fields[id]?.label ?? (id === "height" ? "高度" : id), icon: "field" as const }));
            result.push({ title: "场", items: [...fields.filter(filter), { key: "+field", name: "新建场", icon: "plus" }] });
        }
        for (const [category, title, icon] of categories) {
            const elements = leaves.filter(s => s.owner === category);
            const ids = [...new Set(elements.map(s => s.id))];
            result.push({ title, items: ids.map(id => ({ key: category + ":" + id, name: elements.find(s => s.id === id)!.name, icon, branch: true }))
                .filter(item => filter(item) || elements.some(s => s.id === item.key.slice(category.length + 1) && s.label.includes(query))) });
        }
        return result;
    });
    let options = $derived(groups.flatMap(g => g.items));
    function currentResult(v: Expression | undefined) {
        if (v === undefined || typeof v === "number") return v;
        try {
            return sampleValue(evaluate(v, expressionGraph(catalog).get), field => owner ? editor.island.inputAt(owner, field, editor.geoCenter(owner)) : undefined);
        }
        catch {
            return undefined;
        }
    }
    function candidate(v: Expression, from = catalog) {
        const d = structuredClone(from);
        writeAt(d, address, v);
        const [group, index, key] = address;
        if (group === "buildings" && typeof index === "number" && (key === "angle" || key === "radius")) {
            const b = d.buildings[index], slot = "building:" + b.id + "." + key;
            const before = from.buildings[index][key] === undefined ? 0 : expressionGraph(from).get(slot);
            const after = expressionGraph(d).get(slot);
            if (typeof before === "number" && typeof after === "number") offsetBuildingParts(b, key, after - before);
        }
        return parseDesign(d, true);
    }
    function parseDraft() {
        const value = numericText(draft, kind === "literal");
        return typeof value === "number" ? value / displayFactor : value;
    }
    function validate() {
        try {
            candidate(parseDraft()); error = "";
        }
        catch (e) {
            error = (e as Error).message;
        }
    }
    function closeMenu() {
        opened = false; parent = query = ""; queryStart = queryEnd = 0; active = 0;
    }
    async function paint(at: number) {
        const paintId = ++version;
        await tick();
        if (!editing || paintId !== version || !input) return;
        // The browser owns the editable subtree. Svelte only renders the read-only chip template.
        // eslint-disable-next-line svelte/no-dom-manipulating
        input.replaceChildren(...Array.from(mirror.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE && n.textContent).map(n => n.cloneNode(true)));
        input.focus({ preventScroll: true });
        caretAt(input, at);
    }
    async function startEdit() {
        if (editing) return;
        editing = true; draft = String(typeof value === "number" ? value * displayFactor : value); error = "";
        await paint(draft.length);
    }
    async function showMenu() {
        await startEdit(); closeMenu(); opened = true;
    }
    function finish(save: boolean) {
        if (!editing) return;
        let next: Design | undefined;
        if (save && (catalogDraft || draft !== String(typeof value === "number" ? value * displayFactor : value))) {
            try {
                next = candidate(parseDraft());
            }
            catch (e) {
                error = (e as Error).message;
            }
        }
        editing = false; closeMenu(); catalogDraft = undefined; error = "";
        if (next && JSON.stringify(next) !== JSON.stringify(base)) editor.commitNumber(next);
    }
    function insertText(text: string, replaceLiteral = false) {
        const [start, end] = selectionOffsets(input);
        const filtering = opened && queryEnd > queryStart;
        const fromQuery = filtering ? queryStart : start, toQuery = filtering ? queryEnd : end;
        const withoutQuery = filtering ? draft.slice(0, fromQuery) + draft.slice(toQuery) : draft;
        const empty = replaceLiteral && (typeof numericText(withoutQuery, false) === "number" || !withoutQuery.trim());
        const from = empty ? 0 : fromQuery;
        draft = draft.slice(0, from) + text + (empty ? "" : draft.slice(toQuery));
        closeMenu(); validate(); void paint(from + text.length);
    }
    function choose(item: Option) {
        if (item.branch) {
            parent = item.key; active = 0; query = ""; return;
        }
        let key = item.key;
        if (key.startsWith("+")) {
            const d = structuredClone(catalog);
            if (key === "+var") {
                const formula = queryEnd > queryStart ? draft.slice(0, queryStart) + draft.slice(queryEnd) : draft;
                const entered = numericText(formula, false);
                const effective = currentResult(typeof entered === "number" ? entered / displayFactor : entered) ?? currentResult(value) ?? 0;
                key = "var:" + addVariable(d, effective);
            }
            else key = "field:" + addField(d);
            catalogDraft = d;
        }
        insertText("{" + key + "}", true);
    }
    function onInput() {
        draft = editorText(input);
        const at = selectionOffsets(input)[0], prefix = draft.slice(0, at);
        const word = prefix.match(/([a-zA-Z\u3400-\u9fff][\w\u3400-\u9fff-]*)$/)?.[1];
        const exponent = word && /^[eE]\d*$/.test(word) && /\d/.test(prefix.at(-word.length - 1) ?? "");
        if (kind !== "literal" && word && !exponent && prefix.lastIndexOf("{") <= prefix.lastIndexOf("}")) {
            queryStart = at - word.length; queryEnd = at; query = word; opened = true; active = 0;
        }
        else if (query) closeMenu();
        validate();
        if (prefix.endsWith("}")) void paint(at);
    }
    function key(e: KeyboardEvent) {
        if (opened && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) {
            e.preventDefault(); e.stopPropagation();
            if (e.key === "Escape") closeMenu();
            else if (e.key === "Enter") {
                if (options[active]) choose(options[active]);
            }
            else {
                active = (active + (e.key === "ArrowUp" ? -1 : 1) + options.length) % (options.length || 1);
                void tick().then(() => root.querySelector("[aria-selected=\"true\"]")?.scrollIntoView({ block: "nearest" }));
            }
            return;
        }
        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault(); e.stopPropagation();
            if (e.key === "Escape" || !error) finish(e.key === "Enter");
        }
        if (e.key === "Backspace" || e.key === "Delete") {
            const [a, b] = selectionOffsets(input);
            if (a !== b) return;
            const match = e.key === "Backspace" ? draft.slice(0, a).match(/\{[^{}]+\}$/) : draft.slice(b).match(/^\{[^{}]+\}/);
            if (match) {
                e.preventDefault();
                const start = e.key === "Backspace" ? a - match[0].length : a;
                draft = draft.slice(0, start) + draft.slice(start + match[0].length); validate(); void paint(start);
            }
        }
    }
    function advance(n: number) {
        const next = adjustNumber(live, n, step / displayFactor, range);
        if (next === live) return;
        try {
            const d = candidate(next, origin); live = next; error = ""; editor.previewNumber(d);
        }
        catch (e) {
            error = (e as Error).message;
        }
    }
    function keyboardStep(e: MouseEvent, direction: number) {
        if (e.detail) return;
        try {
            editor.commitNumber(candidate(adjustNumber(value, direction, step / displayFactor, range)));
        }
        catch (e) {
            error = (e as Error).message;
        }
    }
    function beginGesture(e: PointerEvent, direction: number) {
        if (e.button !== 0 || cleanup) return;
        e.preventDefault();
        if (editing) finish(false);
        const initial = value;
        origin = base; live = initial; gesturing = true;
        const button = e.currentTarget as HTMLButtonElement, drag = new NumberDrag(), id = e.pointerId;
        button.setPointerCapture(id);
        const stop = direction ? repeatButton(() => advance(direction)) : undefined;
        let x = e.clientX, y = e.clientY, requested = false;
        function move(ev: PointerEvent) {
            if (ev.pointerId !== id || direction) return;
            const locked = document.pointerLockElement === button;
            const steps = drag.move(locked ? ev.movementX : ev.clientX - x, locked ? ev.movementY : ev.clientY - y, ev.shiftKey, ev.ctrlKey);
            x = ev.clientX; y = ev.clientY;
            if (drag.moved && !requested) {
                requested = true;
                try {
                    button.requestPointerLock?.()?.then(() => {
                        if (!cleanup && document.pointerLockElement === button) document.exitPointerLock();
                    }).catch(() => {});
                }
                catch { /* Pointer capture still supports ordinary dragging. */ }
            }
            if (steps) advance(steps);
        }
        function end(cancel: boolean) {
            if (!cleanup) return;
            cleanup(); cleanup = undefined;
            if (document.pointerLockElement === button) document.exitPointerLock();
            if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
            const changed = live !== initial;
            gesturing = false; error = "";
            if (changed || direction || drag.moved) editor.commitNumber(cancel ? origin! : candidate(live, origin));
            else if (!cancel && !direction && !drag.moved) void startEdit();
            origin = undefined;
        }
        const up = (ev: PointerEvent) => {
            if (ev.pointerId === id) end(false);
        };
        const cancel = () => end(true);
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("blur", cancel);
        cleanup = () => {
            stop?.(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel);
        };
    }
    onDestroy(() => {
        cleanup?.();
    });
</script>