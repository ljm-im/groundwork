<div class="subitem">
    <div class="subitem-heading">
        <button class="subitem-toggle" aria-expanded={open} {onclick}>
            <Icon name={open ? "collapse" : "expand"} />{#if icon}<Icon name={icon} />{/if}<span>{label}</span>
        </button>
        {#if actions}<div class="row-actions">{@render actions()}</div>{/if}
    </div>
    {#if open}<div class="subitem-fields">{@render children()}</div>{/if}
</div>

<style>
    .subitem-heading {
        display: flex;
        align-items: center;
        min-height: var(--row-h);
        margin-inline: calc(-1 * var(--panel-inset));
        padding-inline: 0 var(--panel-inset);
        background: var(--bg-sunken);
    }
    .subitem-heading:hover { background: var(--bg-hover); }
    .subitem-heading .row-actions { gap: var(--space-1); }
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
    import Icon, { type IconName } from "./Icon.svelte";
    let { label, icon, open, onclick, children, actions }: {
        label: string; icon?: IconName; open: boolean; onclick: () => void; children: Snippet; actions?: Snippet;
    } = $props();
</script>