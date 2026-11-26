<FieldRow {label} forInput={id} {onmouseenter} {onmouseleave}>
    <div class="geometry-control input-box" bind:this={box}>
        <button {id} class="geometry-box" aria-label={label} aria-pressed={active} data-tip={source?.name ?? item?.label ?? summary} {onclick}>
            {#if source}<ReferenceChip curve={source} />
            {:else}<Icon name={item ? geometryIcon(item) : icon} /><span>{item?.label ?? summary ?? "线段"}</span>{/if}
        </button>
        {#if redraw}
            <button class="icon-button geometry-redraw" data-tip={"重画" + label} aria-label={"重画" + label}
                aria-pressed={redrawing} onclick={redraw}><Icon name="pen" /></button>
        {/if}
        {#if reference}
            <button class="icon-button geometry-reference" data-tip="引用曲线" aria-label={"为“" + (reference.name ?? label) + "”引用曲线"}
                aria-expanded={opened} bind:this={toggle} onclick={e => {
                    pointerOpened = e.detail > 0;
                    if (opened) close();
                    else opened = true;
                }}><Icon name="collapse" /></button>
            {#if opened}
                <Menu label="引用曲线" variant="reference-menu" kind="listbox" anchor={box} groups={choices} empty="没有可用的曲线"
                    {pointerOpened} close={focus => close(focus)} choose={choose} hover={key => reference?.editor.hoverCurveReference(key)} />
            {/if}
        {/if}
    </div>
</FieldRow>

<style>
    .geometry-control { display: flex; align-items: center; padding: 0; }
    .geometry-box { flex: 1; min-width: 0; min-height: 0; height: 100%; justify-content: flex-start; padding-inline: var(--space-1); border: 0; background: transparent; overflow: hidden; }
    .geometry-box span, .geometry-box :global(.ref-chip > span) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .geometry-control:has(.geometry-box[aria-pressed="true"]) { color: var(--accent); background: var(--bg-selected); border-color: var(--accent); }
</style>

<script lang="ts">
    import { onDestroy } from "svelte";
    import { curveKey, curveSlotName, geometryAt, holderLabel, isHolderRef, refKey, type CurveSlot } from "../../core/design/curveReferences.ts";
    import { geometryIcon } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import ReferenceChip from "./ReferenceChip.svelte";
    import Menu from "./Menu.svelte";
    import FieldRow from "./FieldRow.svelte";
    const id = $props.id();
    let { label, icon = "point", summary, active, onclick, redraw, redrawing = false, onmouseenter, onmouseleave, reference }: {
        label: string; icon?: IconName; summary?: string; active: boolean; onclick: () => void;
        reference?: { editor: session.Editor; slot: CurveSlot; name?: string };
        redraw?: () => void; redrawing?: boolean; onmouseenter?: () => void; onmouseleave?: () => void;
    } = $props();
    let opened = $state(false), pointerOpened = $state(false);
    let box = $state<HTMLElement>(null!), toggle = $state<HTMLButtonElement>(null!);
    let direct = $derived.by(() => {
        const value = reference?.slot.holder?.value;
        if (value && !isHolderRef(value)) return value.curve;
    });
    let item = $derived(direct === undefined ? undefined : geometryAt(reference!.editor.project.design, direct));
    let alias = $derived.by(() => {
        const value = reference?.slot.holder?.value;
        if (value && isHolderRef(value)) return refKey(value.ref);
    });
    let source = $derived.by(() => {
        if (!alias || !reference) return;
        const graph = reference.editor.curves, holder = graph.holders.get(alias);
        if (holder) return { key: alias, name: curveSlotName(holder), closed: graph.source(graph.ofHolder(holder)).curve.closed };
    });
    let choices = $derived.by(() => {
        if (!opened || !reference?.slot.holder) return [];
        const { editor: { curves }, slot } = reference;
        function item(option: CurveSlot, name: string, id = option.key, selected?: boolean) {
            return { id, name, icon: curves.source(option).curve.closed ? "closedPath" as const : "curve" as const, selected };
        }
        const same = [...curves.holders.values()].filter(candidate => curves.canUseHolder(slot, candidate))
            .map(candidate => item(curves.ofHolder(candidate), curveSlotName(candidate), candidate.key, candidate.key === alias));
        const current = curveKey(curves.source(slot).id);
        const shapes = [...curves.slots.values()].filter(candidate => curves.canUse(slot, candidate))
            .map(candidate => item(candidate, candidate.name, candidate.key, candidate.key === current));
        return [...(curves.canUnlink(slot) ? [{ items: [{ id: "unlink", name: "解除引用" }] }] : []),
            { title: holderLabel(slot.holder!), items: same }, { title: slot.closed ? "闭合曲线" : "曲线", items: shapes }].filter(group => group.items.length);
    });
    onDestroy(() => {
        if (opened) reference?.editor.hoverCurveReference();
    });
    function close(focus?: boolean) {
        opened = false;
        reference?.editor.hoverCurveReference();
        if (focus) toggle.focus({ preventScroll: true });
    }
    function choose(id: string) {
        const r = reference!;
        close(true);
        if (id !== alias && (direct === undefined || id !== curveKey(direct)))
            void r.editor.changeCurveReference(r.slot, id === "unlink" ? undefined : id);
    }
</script>