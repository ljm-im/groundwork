<div class="subitem" class:inset data-curve-node={curveNode}>
    <Heading kind="subitem-heading" {actions}>
        {#if onclick}
            <button class="subitem-toggle" aria-expanded={open} {onclick}>
                <Icon name={open ? "collapse" : "expand"} /><span>{label}</span>
            </button>
        {:else}<span class="subitem-label">{label}</span>{/if}
    </Heading>
    {#if open}<div class="subitem-fields">{@render children()}</div>{/if}
</div>

<style>
    .subitem > :global(.subitem-heading) {
        min-height: var(--row-h);
        margin-inline: calc(-1 * var(--panel-inset));
        padding-inline: 0 var(--panel-inset);
        background: var(--bg-sunken);
    }
    .subitem > :global(.subitem-heading:hover) { background: var(--bg-hover); }
    .inset > :global(.subitem-heading) { margin-inline: 0; padding-inline-end: 0; }
    .subitem-label { padding-inline: var(--space-3); }
    .subitem :global(.row-actions) { gap: var(--space-1); }
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
    .subitem-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
    let { label, open = true, onclick, children, actions, inset = false, curveNode }: {
        label: string; open?: boolean; onclick?: () => void; children: Snippet; actions?: Snippet; inset?: boolean; curveNode?: string;
    } = $props();
</script>