<FieldRow {label} forInput={id} {onmouseenter} {onmouseleave}>
    <div class="geometry-control" class:has-reference={!!reference} bind:this={box}>
        <button {id} class="input-box geometry-box" aria-label={label} aria-pressed={active} data-tip={source ? source.name : summary} {onclick}>
            {#if source}<ReferenceChip curve={source} />
            {:else}<Icon name={icon} />
                <span>{summary ?? (icon === "point" ? "点" : icon === "section" ? "线段" :
                    (icon === "closedPath" ? "闭合曲线" : "曲线") + "（" + count + " 个节点）")}</span>{/if}
        </button>
        {#if reference}
            <button class="icon-button geometry-reference" data-tip="引用曲线" aria-label={"为“" + (reference.name ?? label) + "”引用曲线"}
                aria-expanded={opened} bind:this={toggle} onclick={() => opened = !opened}><Icon name="collapse" /></button>
            {#if opened}
                <Menu label="可用曲线" variant="reference-menu" kind="listbox" anchor={box} groups={choices} empty="没有可用的曲线"
                    close={focus => close(focus)} choose={choose} />
            {/if}
        {/if}
        {#if redraw}
            <button class="icon-button geometry-redraw" data-tip={"重画" + label} aria-label={"重画" + label}
                aria-pressed={redrawing} onclick={redraw}><Icon name="pen" /></button>
        {/if}
    </div>
</FieldRow>

<style>
    .geometry-control { display: flex; position: relative; }
    .geometry-box { width: 100%; min-width: 0; justify-content: flex-start; }
    .geometry-box span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .geometry-box[aria-pressed="true"] { color: var(--accent); background: var(--bg-selected); border-color: var(--accent); }
    .geometry-control:has(.geometry-redraw) .geometry-box { padding-inline-end: var(--icon-button); }
    .geometry-control.has-reference .geometry-box { padding-inline-end: var(--icon-button); }
    .geometry-control.has-reference:has(.geometry-redraw) .geometry-box { padding-inline-end: calc(2 * var(--icon-button)); }
    .geometry-reference { position: absolute; inset: 0 0 auto auto; }
    .geometry-control:has(.geometry-redraw) .geometry-reference { inset-inline-end: var(--icon-button); }
    .geometry-box :global(.ref-chip) { min-width: 0; }
    .geometry-redraw { position: absolute; inset: 0 0 auto auto; }
</style>

<script lang="ts">
    import Icon, { type IconName } from "./Icon.svelte";
    import { curveSlotName, isCurveRef, refKey, type CurveSlot } from "../../core/design/curveReferences.ts";
    import * as session from "../state/session.svelte.ts";
    import ReferenceChip from "./ReferenceChip.svelte";
    import Menu from "./Menu.svelte";
    import FieldRow from "./FieldRow.svelte";
    const id = $props.id();
    let { label, icon = "point", count = 1, summary, active, onclick, redraw, redrawing = false, onmouseenter, onmouseleave, reference }: {
        label: string; icon?: IconName; count?: number; summary?: string; active: boolean; onclick: () => void;
        reference?: { editor: session.Editor; slot: CurveSlot; name?: string };
        redraw?: () => void; redrawing?: boolean; onmouseenter?: () => void; onmouseleave?: () => void;
    } = $props();
    let opened = $state(false);
    let box = $state<HTMLElement>(null!), toggle = $state<HTMLButtonElement>(null!);
    let selected = $derived(reference && isCurveRef(reference.slot.value) ? refKey(reference.slot.value.ref) : undefined);
    let source = $derived.by(() => {
        const graph = reference?.editor.curves, slot = selected && graph?.slots.get(selected);
        return slot && graph ? { key: slot.key, name: curveSlotName(slot), closed: graph.source(slot).curve.closed } : undefined;
    });
    let choices = $derived.by(() => {
        if (!opened || !reference) return [];
        const { editor: { curves }, slot } = reference;
        const items = [...curves.slots.values()].filter(candidate => curves.canUse(slot, candidate)).map(candidate => ({
            id: candidate.key, name: curveSlotName(candidate), icon: curves.source(candidate).curve.closed ? "closedPath" as const : "curve" as const,
            selected: candidate.key === selected
        }));
        return [...(selected ? [{ items: [{ id: "unlink", name: "解除引用" }] }] : []), { title: "可用曲线", items }];
    });
    function close(focus?: boolean) {
        opened = false;
        if (focus) toggle.focus({ preventScroll: true });
    }
    function choose(id: string) {
        const r = reference!;
        close(true);
        if (id !== selected) void r.editor.changeCurveReference(r.slot, id === "unlink" ? undefined : id);
    }
</script>