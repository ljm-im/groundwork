{#snippet formatted(text: string, operators: boolean)}
    {#each text.split(/(\{(?:input|field|geo):[^{}]+\})/g) as part, i (i)}
        {#if part.startsWith("{") && part.endsWith("}")}<ReferenceChip refKey={part.slice(1, -1)} design={base} {slots} />
        {:else}{operators ? part.replaceAll("*", "×").replaceAll("/", "÷") : part}{/if}
    {/each}
{/snippet}
{#snippet editControl()}
    <div class="edit-face"><div class="numeric-edit" use:numericCaret role="textbox" aria-label={label} aria-invalid={!!error}
        aria-multiline={expanded} data-tip={tip} contenteditable="true" spellcheck="false" tabindex="0"
        bind:this={input} oninput={e => {
            if (!composing && !(e instanceof InputEvent && e.isComposing)) onInput();
        }} oncompositionstart={() => composing = true} oncompositionend={() => {
            composing = false; onInput();
        }} onkeydown={key} onpointerdown={selectChip} onblur={() => {
            if (editing) finish(true);
        }} onpaste={e => {
            e.preventDefault(); insertText(e.clipboardData?.getData("text/plain") ?? "");
        }}></div></div>
{/snippet}
{#snippet variableMenuButton()}
    {#if kind !== "literal"}<button class="reference-toggle" data-tip="插入变量" aria-label={"为" + label + "插入变量"} aria-expanded={opened}
        onpointerdown={e => e.preventDefault()} onclick={() => {
            if (opened) closeMenu(); else showMenu();
        }}><Icon name="collapse" /></button>{/if}
{/snippet}
<div class="number-row" class:compact data-parameter={address.join(".")} bind:this={root}>
    <div class="number-line parameter-row">{#if !compact}<span class="number-label param-name">{#if labelIcon}<Icon name={labelIcon} {builtin} />{/if}{label}</span>{/if}
        <div class="number-box input-box" class:invalid={!!error} class:warning={outside} bind:this={box}>
            <button class="step" aria-label={"减小" + label} data-tip="减小" onpointerdown={e => beginGesture(e, -1)} onclick={e => keyboardStep(e, -1)}><Icon name="chevronLeft" /></button>
            {#if editing && !expanded}
                {@render editControl()}
            {:else}
                <button class="numeric-face" use:flagOverflow bind:this={face} aria-label={label} data-tip={tip} onpointerdown={e => beginGesture(e, 0)}
                    onclick={e => {
                        if (!e.detail) void startEdit();
                    }}>
                    {#if typeof shown === "number"}{displayNumber(shown, step)}
                    {:else}{@render formatted(shown, true)}{/if}
                </button>
            {/if}
            <button class="step" aria-label={"增大" + label} data-tip="增大" onpointerdown={e => beginGesture(e, 1)} onclick={e => keyboardStep(e, 1)}><Icon name="chevronRight" /></button>
            {#if !expanded}{@render variableMenuButton()}
            {:else if kind !== "literal"}<span class="menu-spacer"></span>{/if}
        </div>
        {#if !compact}<small class="unit control-unit">{unit}</small>{/if}
    </div>
    {#if editing}<div hidden bind:this={mirror}>{@render formatted(draft, false)}</div>{/if}
    {#if editing && expanded}
        <div class="expanded-edit popup" role="group" aria-label={"编辑" + label} popover="manual" bind:this={expandedBox} use:placeEditor>
            <div class="expanded-line number-box input-box" class:invalid={!!error}>{@render editControl()}{@render variableMenuButton()}</div>
            {#if error}<div class="number-error" role="alert">{error}</div>{/if}
        </div>
    {:else if error}<div class="number-error" role="alert">{error}</div>{/if}
    {#if opened}
        <div class="reference-menu popup menu" role="listbox" tabindex="-1" aria-label="可用变量" popover="manual" use:anchoredPopup={{ anchor: expandedBox ?? box, close: closeMenu, viewport: expanded }} onpointerdown={e => e.preventDefault()}>
            {#if parent}<button class="ref-back" onclick={() => {
                parent = ""; active = 0;
            }}><Icon name="chevronLeft" />返回</button>{/if}
            {#each groups as group (group.title)}
                <div class="menu-group"><div class="group-name">{group.title}</div>
                    {#each group.items as item (item.key)}
                        <button role="option" aria-selected={options[active]?.key === item.key} data-option={item.key}
                            onmouseenter={() => active = options.indexOf(item)} onclick={() => choose(item)}>
                            <Icon name={item.icon} builtin={item.builtin} />{item.name}{#if item.branch}<span class="sub-arrow"><Icon name="chevronRight" /></span>{/if}
                        </button>
                    {/each}
                </div>
            {/each}
            {#if !options.length}<div class="list-empty">没有匹配的结果</div>{/if}
        </div>
    {/if}
</div>
<style>
    .number-label { display: flex; align-items: center; gap: var(--space-1); }
    .compact .number-line { grid-template-columns: minmax(0, 1fr); }
    .number-box { display: flex; align-items: stretch; min-width: 0; padding: 0; }
    .number-box.warning { border-color: var(--warning); }
    .number-box.invalid { border-color: var(--danger); }
    .number-box button { min-height: 0; padding: 0; background: transparent; border: 0; }
    .number-box .step, .number-box .reference-toggle, .menu-spacer { flex: 0 0 var(--unit-w); touch-action: none; }
    .number-box .step { color: var(--text-secondary); }
    .number-box:hover .step { color: var(--text); }
    .number-box .reference-toggle, .menu-spacer { border-left: 1px solid var(--border); border-radius: 0; }
    .numeric-face, .numeric-edit {
        display: block;
        flex: 1;
        min-width: 0;
        text-align: center;
        white-space: nowrap;
        line-height: var(--leading-md);
    }
    .numeric-face { cursor: ew-resize; user-select: none; overflow: hidden; touch-action: none; }
    .numeric-face:global([data-overflow]) { text-align: left; mask-image: linear-gradient(to right, var(--text) calc(100% - var(--space-4)), transparent); }
    .expanded-edit { padding: var(--space-2); overflow: auto; }
    .expanded-line { height: auto; }
    .expanded-line .edit-face { align-self: stretch; }
    .expanded-line .numeric-edit { min-height: calc(3 * var(--leading-md)); padding: var(--space-1); white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; }
    .expanded-line :global(.ref-chip) { max-width: 100%; white-space: normal; }
    .edit-face { position: relative; align-self: center; min-width: 0; flex: 1; overflow: hidden; }
    .edit-face::after {
        content: "";
        display: var(--caret-display, none);
        position: absolute;
        left: var(--caret-x);
        top: var(--caret-y);
        height: var(--leading-md);
        width: 1px;
        background: currentColor;
        pointer-events: none;
        animation: blink 1.1s steps(1) infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
    .numeric-edit { caret-color: transparent; min-height: var(--leading-md); outline: none; overflow-x: auto; scrollbar-width: none; white-space: pre; }
    .number-error { color: var(--danger); font-size: var(--text-xs); line-height: var(--leading-xs); margin: var(--space-1) 0 0 calc(var(--name-w) + var(--space-1)); }
    .compact .number-error, .expanded-edit .number-error { margin-left: 0; }
    .sub-arrow { margin-left: auto; display: inline-flex; }
</style>

<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { type Design, type Expression } from "../../core/design/v5.ts";
    import { canReference, expressionGraph, parameters, readAt, writeAt, type Address } from "../../core/design/parameters.ts";
    import { evaluate, sampleValue } from "../../core/design/expression.ts";
    import { parseDesign } from "../../core/design/model.ts";
    import { seedId } from "../../core/design/defaults.ts";
    import { adjustNumber, chipSpans, composingKey, displayNumber, editorSelection, flagOverflow, editorText, NumberDrag, numericCaret, numericText, repeatButton, selectionOffsets, type Range } from "../state/numbers.ts";
    import { anchoredPopup } from "../state/popup.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import ReferenceChip from "./ReferenceChip.svelte";
    let { editor, address, label, labelIcon, builtin = false, kind = "number", step = .1, range, unit = "", self, owner, compact = false }: {
        editor: session.Editor; address: Address; label: string; labelIcon?: IconName; builtin?: boolean; kind?: "number" | "field" | "literal"; step?: number;
        range?: Range; unit?: string; self?: string; owner?: string; compact?: boolean;
    } = $props();
    let face = $state<HTMLButtonElement>(), expandedBox = $state<HTMLElement>();
    let root: HTMLElement, box = $state<HTMLElement>(null!), input = $state<HTMLElement>(null!), mirror = $state<HTMLElement>(null!);
    let base = $derived(editor.project.design), authored = $derived(readAt(base, address) as Expression | undefined);
    let value = $derived(authored ?? (readAt(editor.project.resolved, address) as number | undefined) ??
        (self ? expressionGraph(base).get(self) as number : 0));
    let editing = $state(false), expanded = $state(false), draft = $state(""), error = $state(""), opened = $state(false), parent = $state(""), query = $state("");
    let queryStart = 0, queryEnd = 0, composing = false;
    let active = $state(0);
    let slots = $derived(parameters(base));
    let gesturing = $state(false), live = $state<Expression>(0), shown = $derived(gesturing ? live : value);
    let result = $derived(currentResult(shown));
    let outside = $derived(result !== undefined && range && (result < range[0] || result > range[1]));
    let tip = $derived(typeof shown === "string" ? (result === undefined ? "= 未定义" : "= " + displayNumber(result, step, unit)) : undefined);
    let origin: Design | undefined, cleanup: (() => void) | undefined, version = 0;
    type Option = { key: string; name: string; icon: IconName; builtin?: boolean; branch?: boolean };
    type Group = { title: string; items: Option[] };
    let groups = $derived.by((): Group[] => {
        if (!opened) return [];
        const filter = (v: Option) => (v.name + " " + v.key).toLowerCase().includes(query.toLowerCase());
        const allowed = (key: string) => canReference(slots, self, key);
        const leaves = [...slots.values()].filter(s => !s.field && allowed(s.key));
        if (parent) return [{ title: leaves.find(s => s.owner + ":" + s.id === parent)?.name ?? "属性",
            items: leaves.filter(s => s.owner + ":" + s.id === parent).map(s => ({ key: s.key, name: s.label, icon: "property" as const })).filter(filter) }];
        const items: Option[] = leaves.filter(s => s.owner === "input").map(s => ({
            key: s.key, name: s.name, icon: "inputs", builtin: s.id === seedId
        }));
        const result: Group[] = [{ title: "输入", items: items.filter(filter) }];
        if (kind === "field") {
            const fields = ["height", ...Object.keys(base.fields)].map(id => ({
                key: "field:" + id, name: id === "height" ? "高度" : base.fields[id].label ?? id, icon: "field" as const, builtin: id === "height"
            }));
            result.push({ title: "场", items: fields.filter(filter) });
        }
        const nodes = leaves.filter(s => s.owner === "geo");
        const itemsById = new Map(nodes.map(s => [s.id, { key: "geo:" + s.id, name: s.name, icon: "terrain" as const, branch: true }]));
        result.push({ title: "地件", items: [...itemsById].filter(([id, item]) =>
            filter(item) || nodes.some(s => s.id === id && s.label.includes(query))).map(([, item]) => item) });
        return result.filter(group => group.items.length);
    });
    let options = $derived(groups.flatMap(g => g.items));
    function currentResult(v: Expression | undefined) {
        if (v === undefined || typeof v === "number") return v;
        try {
            return sampleValue(evaluate(v, expressionGraph(base).get), field => owner ? editor.project.inputAt(owner, field, editor.geoCenter(owner)) : undefined);
        }
        catch {
            return undefined;
        }
    }
    function candidate(v: Expression, from = base) {
        const d = structuredClone(from);
        writeAt(d, address, v);
        return parseDesign(d, true);
    }
    function parseDraft() {
        const value = numericText(draft, kind === "literal");
        return value;
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
    async function paint(at: number, end = at) {
        const paintId = ++version;
        await tick();
        if (!editing || paintId !== version || !input) return;
        // The browser owns the editable subtree. Svelte only renders the read-only chip template.
        // eslint-disable-next-line svelte/no-dom-manipulating
        input.replaceChildren(...Array.from(mirror.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE && n.textContent).map(n => n.cloneNode(true)));
        input.focus({ preventScroll: true });
        editorSelection(input, at, end);
    }
    async function startEdit(chip?: { start: number; end: number }) {
        if (editing) return;
        expanded = face?.hasAttribute("data-overflow") ?? false;
        editing = true; draft = String(value); error = "";
        await paint(chip?.start ?? draft.length, chip?.end);
    }
    function placeEditor(popup: HTMLElement) {
        const panel = box.closest<HTMLElement>(".panel-content");
        const inset = panel ? parseFloat(getComputedStyle(panel).getPropertyValue("--panel-inset")) : 12;
        function reveal() {
            if (!panel) return;
            const space = innerHeight - box.getBoundingClientRect().bottom;
            if (space < 116) {
                panel.style.setProperty("--editor-clearance", "116px");
                panel.scrollTop += 116 - space;
            }
        }
        reveal();
        popup.showPopover();
        function position() {
            const container = panel?.getBoundingClientRect(), bounds = box.getBoundingClientRect();
            if (bounds.bottom < (container?.top ?? 0) || bounds.top >= (container?.bottom ?? innerHeight)) {
                finish(true); return;
            }
            const width = Math.max(360, (panel?.clientWidth ?? bounds.width) - 2 * inset);
            const left = (container?.left ?? bounds.right - width) + inset;
            popup.style.width = width + "px";
            popup.style.left = Math.max(4, Math.min(left, innerWidth - width - 4)) + "px";
            popup.style.top = bounds.bottom + "px";
            popup.style.maxHeight = Math.max(0, innerHeight - bounds.bottom - 4) + "px";
        }
        function outside(e: PointerEvent) {
            const path = e.composedPath();
            if (!path.includes(box) && !path.includes(popup) && !path.some(n => n instanceof Element && n.matches(".reference-menu"))) finish(true);
        }
        function resizeEditor() {
            reveal(); position();
        }
        position();
        const lifecycle = new AbortController(), options = { signal: lifecycle.signal };
        document.addEventListener("pointerdown", outside, { ...options, capture: true });
        document.addEventListener("scroll", position, { ...options, capture: true });
        window.addEventListener("resize", resizeEditor, options);
        const resize = new ResizeObserver(position);
        if (panel) resize.observe(panel);
        return { destroy() {
            resize.disconnect(); lifecycle.abort();
            panel?.style.removeProperty("--editor-clearance");
        } };
    }
    function chipAt(input: HTMLElement, target: EventTarget | null) {
        return target instanceof Node ? chipSpans(input).find(chip => chip.node.contains(target)) : undefined;
    }
    function selectChip(e: PointerEvent) {
        if (e.button !== 0) return;
        const chip = chipAt(input, e.target);
        if (!chip) return;
        e.preventDefault();
        input.focus({ preventScroll: true });
        closeMenu();
        editorSelection(input, chip.start, chip.end);
    }
    async function showMenu() {
        await startEdit(); closeMenu(); opened = true;
    }
    function finish(save: boolean) {
        if (!editing) return;
        let next: Design | undefined;
        if (save && draft !== String(value)) {
            try {
                next = candidate(parseDraft());
            }
            catch (e) {
                error = (e as Error).message;
            }
        }
        editing = expanded = false; closeMenu(); error = "";
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
        insertText("{" + item.key + "}", true);
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
        if (composing || composingKey(e)) return;
        if (expanded && e.key === "Escape") {
            e.preventDefault(); e.stopPropagation(); finish(false); return;
        }
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
        const [a, b] = selectionOffsets(input);
        const chips = chipSpans(input);
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const left = e.key === "ArrowLeft";
            if (a !== b && !e.shiftKey) {
                e.preventDefault();
                editorSelection(input, left ? a : b);
                return;
            }
            const selection = input.ownerDocument.getSelection();
            const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
            const backwards = range && selection?.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
            const focus = backwards ? a : b, anchor = backwards ? b : a;
            const chip = chips.find(c => left ? c.end === focus : c.start === focus);
            if (chip) {
                e.preventDefault();
                const next = left ? chip.start : chip.end;
                editorSelection(input, e.shiftKey ? anchor : next, next);
            }
        }
        if (e.key === "Backspace" || e.key === "Delete") {
            const left = e.key === "Backspace";
            const chip = a === b ? chips.find(c => left ? c.end === a : c.start === b) : undefined;
            if (!chip && !chips.some(c => c.start < b && c.end > a)) return;
            e.preventDefault();
            const start = chip?.start ?? a, end = chip?.end ?? b;
            draft = draft.slice(0, start) + draft.slice(end);
            closeMenu(); validate(); void paint(start);
        }
    }
    function advance(n: number) {
        const next = adjustNumber(live, n, step, range);
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
            editor.commitNumber(candidate(adjustNumber(value, direction, step, range)));
        }
        catch (e) {
            error = (e as Error).message;
        }
    }
    function beginGesture(e: PointerEvent, direction: number) {
        if (e.button !== 0 || cleanup) return;
        e.preventDefault();
        if (editing && expanded) {
            finish(true); return;
        }
        if (editing) finish(false);
        const initial = value;
        origin = base; live = initial; gesturing = true;
        const button = e.currentTarget as HTMLButtonElement, drag = new NumberDrag(), id = e.pointerId;
        const chip = direction ? undefined : chipAt(button, e.target);
        button.setPointerCapture(id);
        const stop = direction ? repeatButton(() => advance(direction)) : undefined;
        let x = e.clientX, y = e.clientY, requested = false, locked = document.pointerLockElement === button;
        function lockChanged() {
            const next = document.pointerLockElement === button;
            if (next !== locked) drag.lockChanged();
            locked = next;
        }
        function move(ev: PointerEvent) {
            if (ev.pointerId !== id || direction) return;
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
            else if (!cancel && !direction && !drag.moved) void startEdit(chip);
            origin = undefined;
        }
        const up = (ev: PointerEvent) => {
            if (ev.pointerId === id) end(false);
        };
        const cancel = () => end(true);
        document.addEventListener("pointerlockchange", lockChanged);
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("blur", cancel);
        cleanup = () => {
            document.removeEventListener("pointerlockchange", lockChanged);
            stop?.(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel);
        };
    }
    onDestroy(() => {
        cleanup?.();
    });
</script>