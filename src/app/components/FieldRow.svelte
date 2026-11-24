<div class="parameter-row">
    <span class="param-name">{label}</span>
    {#if readOnlyValue !== undefined}
        <span class="read-only-value" role="textbox" aria-readonly="true" aria-label={label}>{readOnlyValue}</span>
    {:else}
        {@render children?.()}
    {/if}
    <small class="unit control-unit">{unit}</small>
</div>

<style>
    .read-only-value {
        display: flex;
        align-items: center;
        min-height: var(--control-h);
        padding: 0 var(--space-2);
        border: 1px solid transparent;
        border-radius: var(--radius);
        background: var(--bg-sunken);
        overflow-wrap: anywhere;
        cursor: default;
        user-select: text;
    }
</style>

<script lang="ts">
    import { type Snippet } from "svelte";
    let { label, unit = "", readOnlyValue, children }: {
        label: string; unit?: string; readOnlyValue?: string; children?: Snippet;
    } = $props();
</script>