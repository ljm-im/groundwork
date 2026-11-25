<div class="parameter-row" {...attributes}>
    {#if forInput}<label class="param-name" class:disabled for={forInput}>{label}</label>
    {:else if label}<span class="param-name">{label}</span>{/if}
    <div class="parameter-control">
        {#if readOnlyValue !== undefined}
            <span class="read-only-value" role="textbox" aria-readonly="true" aria-label={label}>{readOnlyValue}</span>
        {:else}{@render children?.()}{/if}
    </div>
    {#if unitAction}<div class="unit control-unit">{@render unitAction()}</div>
    {:else}<small class="unit control-unit" data-tip={unit || undefined}>{unit}</small>{/if}
    {#if problem}<div class="parameter-error danger" role="alert">{problem}</div>{/if}
</div>

<style>
    label:not(.disabled) { cursor: pointer; }
    .disabled { color: var(--text-disabled); }
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
    let { label, unit = "", forInput, disabled = false, readOnlyValue, problem, attributes, children, unitAction }: {
        label?: string; unit?: string; forInput?: string; disabled?: boolean; readOnlyValue?: string;
        problem?: string; attributes?: Record<string, string>; children?: Snippet; unitAction?: Snippet;
    } = $props();
</script>