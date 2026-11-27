<Heading kind="property-title">
    <Icon name={icon} {builtin} />
    {#if rename}
        <input aria-label={label} data-tip={label} value={name} bind:this={input}
            use:pendingInput={commit} onchange={commit} />
    {:else}<h2>{name}</h2>{/if}
    {#snippet actions()}
        {#if toggle}<button class="icon-button" data-tip={toggleTitle} aria-label={toggleTitle} aria-pressed={disabled} onclick={toggle}><Icon name="exclude" /></button>{/if}
        {#if redraw}<button class="icon-button" data-tip={redrawLabel} aria-label={redrawLabel} aria-pressed={redrawing} onclick={redraw}><Icon name="pen" /></button>{/if}
        {#if copy}<button class="icon-button" data-tip={"复制" + category} aria-label={"复制" + category} onclick={copy}><Icon name="copy" /></button>{/if}
        {#if remove}<button class="icon-button danger" data-action="delete" data-tip={"删除" + category} aria-label={"删除" + category} onclick={remove}><Icon name="delete" /></button>{/if}
    {/snippet}
</Heading>

<style>
    :global(.property-title) {
        min-height: var(--property-title-h);
        gap: var(--space-1);
        padding: var(--space-1) var(--panel-inset);
    }
    :global(.property-title > svg.icon) { margin-inline: var(--title-icon-inset); }
    :global(.property-title .row-actions) { gap: var(--space-1); }
    input, h2 {
        min-width: 0;
        flex: 1;
        font-size: var(--text-xl);
        line-height: var(--leading-xl);
        font-weight: var(--weight-semibold);
    }
    :global(.property-title) input { height: var(--property-name-h); }
</style>

<script lang="ts">
    import Icon, { type IconName } from "./Icon.svelte";
    import Heading from "./Heading.svelte";
    import { pendingInput } from "../state/pendingInput.ts";
    let { icon, name, category, label = "名称", rename, remove, copy, redraw, redrawLabel = "重画" + category, redrawing = false, toggle, builtin = false, disabled = false }: {
        icon: IconName; builtin?: boolean; name: string; category: string; label?: string; rename?: (name: string) => void;
        remove?: () => void; copy?: () => void; redraw?: () => void; redrawLabel?: string; redrawing?: boolean; toggle?: () => void; disabled?: boolean;
    } = $props();
    let toggleTitle = $derived((disabled ? "启用" : "禁用") + category);
    let input = $state<HTMLInputElement>(null!);
    function commit() {
        const text = input.value.trim();
        if (text && text !== name) rename?.(text);
        else input.value = name;
    }
</script>