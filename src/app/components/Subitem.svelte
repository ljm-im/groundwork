<div class="subitem" class:inset class:flush class:selected data-outline={outline} data-curve-node={curveNode} data-curve-segment={curveSegment}>
    <Heading kind="subitem-heading" actions={reference || buttons ? rowActions : undefined} {onmouseenter} {onmouseleave}>
        <div class="subitem-caption">
            {#if onclick}
                <button class="subitem-toggle" aria-expanded={open} aria-current={selected || undefined} {onclick}>
                    <Icon name={open ? "collapse" : "expand"} /><span>{label}</span>
                </button>
            {:else}<span class="subitem-label">{label}</span>{/if}
            {#if source && reference}
                <button class="subitem-source" data-tip={source.name} aria-label={source.name} onclick={() => reference?.editor.focusCurveHolder(source!.key)}>
                    <ReferenceChip curve={source} />
                </button>
            {/if}
        </div>
    </Heading>
    {#if open}<div class="subitem-fields">{@render children()}</div>{/if}
</div>

{#snippet rowActions()}
    {#if reference}<CurveHolderMenu editor={reference.editor} slot={reference.slot} />{/if}
    {@render buttons?.()}
{/snippet}

<style>
    .subitem > :global(.subitem-heading) {
        min-height: var(--row-h);
        margin-inline: calc(-1 * var(--panel-inset));
        padding-inline: 0 var(--panel-inset);
        background: var(--bg-sunken);
    }
    .subitem > :global(.subitem-heading:hover) { background: var(--bg-hover); }
    .selected > :global(.subitem-heading) { background: var(--bg-selected); }
    .inset > :global(.subitem-heading) { margin-inline: 0; padding-inline-end: 0; }
    .subitem-label { padding-inline: var(--space-3); }
    .subitem-caption { display: flex; flex: 1; align-items: center; min-width: 0; }
    .subitem-source { min-width: 0; max-width: 55%; padding: 0; background: transparent; border: 0; }
    .subitem-source :global(.ref-chip) { max-width: 100%; overflow: hidden; }
    .subitem-source :global(.ref-chip > span) { overflow: hidden; text-overflow: ellipsis; }
    .subitem :global(.row-actions) { gap: var(--space-1); flex: none; }
    .subitem-toggle {
        min-width: 0;
        min-height: var(--row-h);
        flex: 1;
        justify-content: flex-start;
        text-align: start;
        padding: var(--space-1) var(--panel-inset);
        border: 0;
        border-radius: 0;
        background: transparent;
    }
    .subitem-toggle :global(.icon) { flex: none; }
    .subitem-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .flush .subitem-fields { padding-inline-start: 0; }
    .subitem-fields {
        display: grid;
        gap: var(--space-1);
        padding: var(--space-1) 0 var(--space-1) var(--space-3);
    }
</style>

<script lang="ts">
    import { type Snippet } from "svelte";
    import Icon from "./Icon.svelte";
    import Heading from "./Heading.svelte";
    import ReferenceChip from "./ReferenceChip.svelte";
    import CurveHolderMenu from "./CurveHolderMenu.svelte";
    import { curveSlotName, isHolderRef, refKey, type CurveSlot } from "../../core/design/curveReferences.ts";
    import * as session from "../state/session.svelte.ts";
    let { label, open = true, onclick, children, actions: buttons, inset = false, flush = false, selected = false, outline, curveNode, curveSegment,
        onmouseenter, onmouseleave, reference }: {
        label: string; open?: boolean; onclick?: () => void; children: Snippet; actions?: Snippet; inset?: boolean; flush?: boolean; selected?: boolean;
        outline?: string; curveNode?: string; curveSegment?: string; onmouseenter?: () => void; onmouseleave?: () => void;
        reference?: { editor: session.Editor; slot: CurveSlot };
    } = $props();
    let source = $derived.by(() => {
        const holder = reference?.slot.holder;
        if (!reference || !holder || !isHolderRef(holder.value)) return;
        const graph = reference.editor.curves, key = refKey(holder.value.ref)!;
        const target = graph.holders.get(key);
        if (target) return { key, name: curveSlotName(target), closed: graph.source(graph.ofHolder(target)).curve.closed };
    });
</script>