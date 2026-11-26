{#snippet formatted(text: string, operators: boolean)}
    {#each text.split(/(\{(?:input|field|geo|mark):[^{}]+\})/g) as part, i (i)}
        {#if part.startsWith("{") && part.endsWith("}")}<ReferenceChip refKey={part.slice(1, -1)} design={base} {slots} canonical={editor.numberEdits.key} />
        {:else}{operators ? displayValue(part, step) : part}{/if}
    {/each}
{/snippet}
{#snippet editControl()}
    <div class="edit-face"><div class="numeric-edit" use:numericCaret role="textbox" aria-label={label} aria-invalid={!!error}
        aria-multiline="false" data-tip={tip} contenteditable="true" spellcheck="false" tabindex="0"
        bind:this={input} use:pendingInput={() => {
            if (!composing) finish(true);
        }} oninput={e => {
            if (!composing && !(e instanceof InputEvent && e.isComposing)) onInput();
        }} oncompositionstart={() => composing = true} oncompositionend={() => {
            composing = false; onInput(); syncEdit(value);
        }} onkeydown={key} onbeforeinput={beforeInput} onpointerdown={e => {
            if (e.button === 0) editorPress = [e.clientX, e.clientY];
        }} onclick={placeCaret} onfocus={() => {
            if (menuSelection) closeMenu();
        }} onblur={e => {
            if (editing && (!menuSelection || !inReferenceMenu(e.relatedTarget))) finish(true);
        }} onpaste={e => {
            e.preventDefault();
            insertText((e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n|[\r\n\u2028\u2029]/g, " "));
        }}></div></div>
{/snippet}
{#snippet variableMenuButton()}
    {#if kind !== "literal"}<button class="reference-toggle" data-tip="插入变量" aria-label={"为" + actionLabel + "插入变量"} aria-expanded={opened}
        onpointerdown={e => e.preventDefault()} onclick={toggleMenu}><Icon name="collapse" /></button>{/if}
{/snippet}
{#snippet control()}
    <div class="number-box input-box" class:danger={!!error} class:invalid={!!error} class:warning={outside} bind:this={box}>
        {#if stepButtons}<button class="step" aria-label={"减小" + actionLabel} data-tip="减小" onpointerdown={e => beginGesture(e, -1)} onclick={e => keyboardStep(e, -1)}><Icon name="chevronLeft" /></button>{/if}
        {#if editing && !expanded}
            {@render editControl()}
        {:else}
            <button class="numeric-face" use:flagOverflow bind:this={face} aria-label={label} data-tip={tip} onpointerdown={e => beginGesture(e, 0)}
                onclick={e => {
                    if (!e.detail) void startEdit();
                }}>
                <span class="numeric-label">
                    {#if typeof shown === "number"}{displayValue(shown, step, faceUnit ? unit : "")}
                    {:else}{@render formatted(shown, true)}{/if}
                </span>
            </button>
        {/if}
        {#if stepButtons}<button class="step" aria-label={"增大" + actionLabel} data-tip="增大" onpointerdown={e => beginGesture(e, 1)} onclick={e => keyboardStep(e, 1)}><Icon name="chevronRight" /></button>{/if}
        {#if !expanded}{@render variableMenuButton()}
{:else if kind !== "literal"}<span class="menu-spacer"></span>{/if}
    </div>
{/snippet}
<div class="number-row" data-parameter={address?.join(".")} {...attributes} bind:this={row} onfocusout={leaveReferenceMenu}>
    {#if compact}
        {@render control()}
        {#if !expanded && error}<div class="number-error danger" role="alert">{error}</div>{/if}
    {:else}
        <FieldRow {label} {unit} {action} problem={expanded ? undefined : error}>{@render control()}</FieldRow>
    {/if}
    {#if editing}<div hidden bind:this={mirror}>{@render formatted(draft, false)}</div>{/if}
    {#if editing && expanded}
        <div class="expanded-edit popup" role="group" aria-label={"编辑" + actionLabel} popover="manual" bind:this={expandedBox}
            use:placePopup={{ anchor: box, close: () => finish(true), expanded: true }}>
            <div class="expanded-line number-box input-box" class:danger={!!error} class:invalid={!!error}>{@render editControl()}{@render variableMenuButton()}</div>
            {#if error}<div class="number-error danger" role="alert">{error}</div>{/if}
        </div>
    {/if}
    {#if opened}
        {#key parent}
            <Menu label="可用变量" variant="reference-menu" kind="listbox"
                groups={groups.map(group => ({ title: group.title, items: group.items.map(item => ({
                    ...item, id: item.key, selected: draft.trim() === "{" + item.key + "}"
                })) }))} anchor={expandedBox ?? box} viewport={expanded} keyboardTarget={input} pointerOpened={!!menuSelection} searching={!!query}
                back={parent ? () => parent = "" : undefined} close={dismissMenu}
                choose={id => choose(options.find(item => item.key === id)!)} />
        {/key}
    {/if}
</div>
<style>
    .number-box { display: flex; align-items: stretch; min-width: 0; padding: 0; }
    .number-box.warning { border-color: var(--warning); }
    .number-box.invalid { border-color: currentColor; }
    .number-box button { min-height: 0; padding: 0; background: transparent; border: 0; }
    .number-box .step, .number-box .reference-toggle, .menu-spacer { flex: 0 0 var(--step-w); touch-action: none; }
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
    .numeric-label { display: inline-block; }
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
    .number-error { font-size: var(--text-xs); line-height: var(--leading-xs); margin-top: var(--space-1); }
</style>

<script lang="ts">
    import { onDestroy, tick, untrack, type Snippet } from "svelte";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import * as session from "../state/session.svelte.ts";
    import { type Expression } from "../../core/design/v5.ts";
    import { readAt, type Address } from "../../core/design/parameters.ts";
    import { evaluate, sampleValue } from "../../core/design/expression.ts";
    import { parameterStep, parameterUnit } from "../../core/design/functionTable.ts";
    import { declarationEntries, isBuiltin } from "../../core/design/defaults.ts";
    import { adjustInputStep, adjustNumber, authoredCaret, caretOffsetAt, chipSpans, composingKey, editorSelection, flagOverflow,
        editorText, NumberDrag, numericCaret, numericText, referenceLabel, repeatButton, selectionOffsets, type Range } from "../state/numbers.ts";
    import { displayReading, displayValue } from "../../core/design/display.ts";
    import { designErrorText } from "../state/designMessages.ts";
    import { placePopup } from "../state/popup.ts";
    import { pendingInput } from "../state/pendingInput.ts";
    import { matchesSearch } from "../state/inspector.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import ReferenceChip from "./ReferenceChip.svelte";
    import FieldRow from "./FieldRow.svelte";
    import Menu from "./Menu.svelte";
    let { editor, address, setting, label, kind = "number", step = .1, range, unit = "", self, owner, compact = false,
        inputStep = false, fallback = 0, attributes, namedInput = false, faceUnit = false, stepButtons = true, action }: {
        editor: session.Editor; label: string; kind?: "number" | "field" | "literal"; step?: number;
        range?: Range; unit?: string; self?: string; owner?: string; compact?: boolean; inputStep?: boolean; fallback?: number;
        attributes?: Record<string, string>; namedInput?: boolean; faceUnit?: boolean; stepButtons?: boolean; action?: Snippet;
    } & ({ address: Address; setting?: never } | { address?: never; setting: { value: number; change: (n: number) => void; validate: (n: number) => void; retainDraft?: boolean } }) = $props();
    let actionLabel = $derived(namedInput ? "“" + label + "”" : label);
    let face = $state<HTMLButtonElement>(), expandedBox = $state<HTMLElement>();
    let row: HTMLElement;
    let box = $state<HTMLElement>(null!), input = $state<HTMLElement>(null!), mirror = $state<HTMLElement>(null!);
    let base = $derived(editor.project.design), authored = $derived(address ? readAt(base, address) as Expression | undefined : undefined);
    let resolvedValue = $derived.by(() => {
        if (!address) return;
        const resolvedAddress = self ? editor.numberEdits.slots.get(self)?.resolvedPath ?? address : address;
        return readAt(editor.project.resolved, resolvedAddress) as number | undefined;
    });
    let value = $derived(setting?.value ?? authored ?? resolvedValue ??
        (self ? editor.numberEdits.get(self) as number : fallback));
    let editing = $state(false), expanded = $state(false), draft = $state(""), error = $state(""), opened = $state(false), parent = $state(""), query = $state("");
    let menuSelection = $state.raw<[number, number]>();
    let queryStart = 0, queryEnd = 0, composing = false, editedValue: Expression;
    let editorPress: [number, number] | undefined;
    let slots = $derived(editor.numberEdits.slots);
    let gesturing = $state(false), live = $state<Expression>(0), shown = $derived(gesturing ? live : value);
    let result = $derived(currentResult(shown));
    let reading = $derived(result?.value);
    let outside = $derived(reading !== undefined && range && (reading < range[0] || reading > range[1]));
    let tip = $derived(typeof shown === "string" ? (reading === undefined ? "= 未定义" :
        "= " + (result?.sampled ? displayReading(reading, step, unit) : displayValue(reading, step, unit))) : undefined);
    let cleanup: (() => void) | undefined, version = 0;
    type Option = { key: string; name: string; reading?: string; icon: IconName; builtin?: boolean; branch?: boolean };
    type Group = { title: string; items: Option[] };
    let groups = $derived.by((): Group[] => {
        if (!opened) return [];
        const filter = (v: Option) => matchesSearch(query, v.name + " " + v.key);
        const excluded = self ? editor.numberEdits.affected([self]) : undefined;
        const allowed = (key: string) => !excluded?.has(key);
        const leaves = [...slots.values()].filter(s => allowed(s.key) && (kind === "field" || !s.field || typeof editor.numberEdits.get(s.key) === "number"));
        if (parent) return [{ title: leaves.find(s => s.owner + ":" + s.id === parent)?.name ?? "属性",
            items: leaves.filter(s => s.owner + ":" + s.id === parent).map((s): Option => {
                const declaration = s.location.kind === "geo" ? base.fields[base.geoNodes[s.location.index!].field] : undefined;
                const reading = s.output && s.spec ? displayValue(editor.numberEdits.get(s.key) as number,
                    parameterStep(s.spec, declaration), parameterUnit(s.spec, declaration?.unit)) : undefined;
                return { key: s.key, name: s.label, icon: s.output ? "outputValue" : "property", reading };
            }).filter(filter) }];
        const items: Option[] = declarationEntries("input", base.inputs).flatMap(([id, input]) => {
            const key = "input:" + id;
            return allowed(key) ? [{ key, name: input.label ?? id, icon: "inputs", builtin: isBuiltin("input", id) }] : [];
        });
        const result: Group[] = [{ title: "输入", items: items.filter(filter) }];
        if (kind === "field") {
            const fields = declarationEntries("field", base.fields).map(([id, field]) => ({
                key: "field:" + id, name: field.label, icon: "field" as const, builtin: isBuiltin("field", id)
            }));
            result.push({ title: "场", items: fields.filter(filter) });
        }
        for (const [owner, title, icon] of [["geo", "地件", "terrain"], ["mark", "标记", "marks"]] as const) {
            const items = new SvelteMap<string, Option>(), matched = new SvelteSet<string>();
            for (const s of leaves) if (s.owner === owner) {
                const item = { key: owner + ":" + s.id, name: s.name, icon, branch: true };
                if (!items.has(s.id)) items.set(s.id, item);
                if (filter(item) || matchesSearch(query, s.label)) matched.add(s.id);
            }
            result.push({ title, items: [...items].filter(([id]) => matched.has(id)).map(([, item]) => item) });
        }
        return result.filter(group => group.items.length);
    });
    let options = $derived(groups.flatMap(g => g.items));
    function fieldReading(field: string) {
        return owner ? editor.fieldReading(owner, field) : undefined;
    }
    function currentResult(v: Expression) {
        if (typeof v === "number") return { value: v, sampled: false };
        try {
            const expression = evaluate(v, editor.numberEdits.get);
            const value = sampleValue(expression, fieldReading);
            return { value, sampled: typeof expression !== "number" };
        }
        catch {
            return undefined;
        }
    }
    function candidate(v: Expression) {
        if (address) return editor.numberEdits.validate(address, v);
        setting?.validate(Number(v));
    }
    function parseDraft() {
        return numericText(draft, kind === "literal", faceUnit ? unit : "");
    }
    function validate() {
        try {
            candidate(parseDraft()); error = "";
        }
        catch (e) {
            error = designErrorText(e, base, "message");
        }
    }
    function closeMenu() {
        opened = false; menuSelection = undefined; parent = query = ""; queryStart = queryEnd = 0;
    }
    function inReferenceMenu(target: EventTarget | null) {
        return target instanceof Element && target.closest(".reference-menu")?.parentElement === row;
    }
    function leaveReferenceMenu(e: FocusEvent) {
        if (menuSelection && inReferenceMenu(e.target) && e.relatedTarget instanceof Node && !row.contains(e.relatedTarget)) finish(true);
    }
    function dismissMenu(_focus?: boolean, event?: KeyboardEvent) {
        if (event?.key === "Escape") finish(false);
        else if (menuSelection) finish(true);
        else closeMenu();
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
    async function startEdit(at?: number) {
        if (editing) return;
        expanded = face?.hasAttribute("data-overflow") ?? false;
        editing = true; editedValue = value; draft = String(value); error = "";
        await paint(at ?? draft.length);
    }
    function syncEdit(next: Expression) {
        if (!editing || composing || setting?.retainDraft || next === editedValue) return;
        editedValue = next;
        const [start, end] = input ? selectionOffsets(input) : [0, 0];
        draft = String(next);
        closeMenu();
        error = "";
        void paint(Math.min(start, draft.length), Math.min(end, draft.length));
    }
    $effect(() => {
        const next = value;
        untrack(() => syncEdit(next));
    });
    function placeCaret(e: MouseEvent) {
        const press = editorPress;
        editorPress = undefined;
        if (!press || !editing || e.detail !== 1 || e.shiftKey || Math.hypot(press[0] - e.clientX, press[1] - e.clientY) > 3) return;
        const at = caretOffsetAt(input, e.clientX, e.clientY);
        input.focus({ preventScroll: true });
        closeMenu();
        editorSelection(input, at);
    }
    async function toggleMenu(e: MouseEvent) {
        if (opened) {
            const selection = menuSelection;
            closeMenu();
            if (selection) await paint(...selection);
            return;
        }
        const pointerOpened = e.detail > 0;
        await startEdit(); closeMenu();
        if (pointerOpened) menuSelection = selectionOffsets(input);
        opened = true;
    }
    function finish(save: boolean) {
        if (!editing) return;
        let committed: Expression | undefined;
        if (save && draft !== String(editedValue)) {
            try {
                const parsed = parseDraft();
                committed = candidate(parsed)?.value ?? parsed;
            }
            catch (e) {
                editor.message("未保存：" + designErrorText(e, base, "message"));
            }
        }
        editing = expanded = false; closeMenu(); error = "";
        if (address && committed !== undefined) editor.commitNumber(address, committed);
        if (setting && typeof committed === "number" && committed !== value) setting.change(committed);
    }
    function insertText(text: string, replaceLiteral = false) {
        const [start, end] = menuSelection ?? selectionOffsets(input);
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
            parent = item.key; query = ""; return;
        }
        insertText("{" + item.key + "}", true);
    }
    function onInput() {
        draft = editorText(input);
        const at = selectionOffsets(input)[0], prefix = draft.slice(0, at);
        const word = prefix.match(/([a-zA-Z\u3400-\u9fff][\w\u3400-\u9fff-]*)$/)?.[1];
        const exponent = word && /^[eE]\d*$/.test(word) && /\d/.test(prefix.at(-word.length - 1) ?? "");
        if (kind !== "literal" && word && !exponent && prefix.lastIndexOf("{") <= prefix.lastIndexOf("}")) {
            queryStart = at - word.length; queryEnd = at; query = word; opened = true;
        }
        else if (query) closeMenu();
        validate();
        if (prefix.endsWith("}")) void paint(at);
    }
    function beforeInput(e: InputEvent) {
        if (e.inputType !== "insertParagraph" && e.inputType !== "insertLineBreak") return;
        e.preventDefault();
        if (!composing && !e.isComposing && !error) finish(true);
    }
    function key(e: KeyboardEvent) {
        if (e.defaultPrevented || composing || composingKey(e)) return;
        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault(); e.stopPropagation();
            if (e.key === "Escape" || !error) finish(e.key === "Enter");
            return;
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
    function adjusted(v: Expression, steps: number) {
        return inputStep ? adjustInputStep(Number(v), steps) : adjustNumber(v, steps, step, range);
    }
    function rejectedStep(next: Expression, cause: unknown) {
        const reading = displayValue(next, step, "", key => {
            const { name, property } = referenceLabel(editor.numberEdits.key(key), base, slots);
            return property ? name + "." + property : name;
        });
        const reason = designErrorText(cause, base, "message");
        return "值 " + reading + (reason === "无效" ? " " : "：") + reason;
    }
    function advance(n: number) {
        const next = adjusted(live, n);
        if (next === live) return;
        try {
            const change = candidate(next);
            live = next; error = "";
            if (change) editor.previewNumber(change);
        }
        catch (e) {
            error = rejectedStep(next, e);
        }
    }
    function keyboardStep(e: MouseEvent, direction: number) {
        if (e.detail) return;
        let next: Expression | undefined;
        try {
            next = adjusted(value, direction);
            const change = candidate(next);
            if (address && change) editor.commitNumber(address, change.value);
            else if (typeof next === "number") setting?.change(next);
        }
        catch (e) {
            error = next === undefined ? designErrorText(e, base, "message") : rejectedStep(next, e);
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
        live = initial; gesturing = true;
        const button = e.currentTarget as HTMLButtonElement, drag = new NumberDrag(), id = e.pointerId;
        const label = direction ? undefined : button.querySelector<HTMLElement>(".numeric-label");
        const at = label && authoredCaret(String(initial), editorText(label), caretOffsetAt(label, e.clientX, e.clientY));
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
            if (address && (cancel || !changed)) editor.clearNumberPreview();
            if (!cancel && changed) {
                if (address) editor.commitNumber(address, live);
                else if (typeof live === "number") setting?.change(live);
            }
            else if (!cancel && !direction && !drag.moved) void startEdit(at ?? undefined);
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
        if (!cleanup) return;
        cleanup();
        if (address) editor.clearNumberPreview();
    });
</script>