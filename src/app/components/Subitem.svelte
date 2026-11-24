<div class="subitem">
    <Heading kind="subitem-heading" {actions}>
        <button class="subitem-toggle" aria-expanded={open} {onclick}>
            <Icon name={open ? "collapse" : "expand"} /><span>{label}</span>
        </button>
    </Heading>
    {#if open}<div class="subitem-fields">{@render children()}</div>{/if}
</div>

<style>
    .subitem :global(.subitem-heading) {
        min-height: var(--row-h);
        margin-inline: calc(-1 * var(--panel-inset));
        padding-inline: 0 var(--panel-inset);
        background: var(--bg-sunken);
    }
    .subitem :global(.subitem-heading:hover) { background: var(--bg-hover); }
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
    let { label, open, onclick, children, actions }: {
        label: string; open: boolean; onclick: () => void; children: Snippet; actions?: Snippet;
    } = $props();
</script>