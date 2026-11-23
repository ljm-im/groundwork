<div class="property-title">
    <input class="wide" aria-label={label} value={name} readonly={!rename} onchange={e => {
        const text = e.currentTarget.value.trim(); if (text && text !== name) rename?.(text); else e.currentTarget.value = name;
    }} />
    {#if toggle}<button data-tip={toggleTitle} aria-label={toggleTitle} aria-pressed={!disabled} onclick={toggle}><Icon name={disabled ? "disabled" : "eye"} /></button>{/if}
    {#if copy}<button data-tip={"复制“" + name + "”"} aria-label={"复制“" + name + "”"} onclick={copy}><Icon name="copy" /></button>{/if}
    {#if remove}<button class="danger" data-action="delete" data-tip={"删除“" + name + "”"} aria-label={"删除“" + name + "”"} onclick={remove}><Icon name="delete" /></button>{/if}
</div>

<style>
    .property-title { display: flex; align-items: center; gap: 4px; }
    .property-title input { width: 0; flex: 1; min-width: 0; font-weight: 650; padding: 4px 7px; }
    .property-title button { min-width: 27px; min-height: 27px; padding: 3px; }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    let { name, label, rename, remove, copy, toggle, disabled = false }: { name: string; label: string; rename?: (name: string) => void;
        remove?: () => void; copy?: () => void; toggle?: () => void; disabled?: boolean } = $props();
    let toggleTitle = $derived((disabled ? "启用“" : "禁用“") + name + "”");
</script>