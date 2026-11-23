<div class="property-title">
    <input class="wide" aria-label={label} data-tip={label} value={name} readonly={!rename} onchange={e => {
        const text = e.currentTarget.value.trim(); if (text && text !== name) rename?.(text); else e.currentTarget.value = name;
    }} />
    {#if toggle}<button data-tip={toggleTitle} aria-label={toggleTitle} aria-pressed={disabled} onclick={toggle}><Icon name="exclude" /></button>{/if}
    {#if copy}<button data-tip={"复制“" + name + "”"} aria-label={"复制“" + name + "”"} onclick={copy}><Icon name="copy" /></button>{/if}
    {#if remove}<button class="danger" data-action="delete" data-tip={"删除“" + name + "”"} aria-label={"删除“" + name + "”"} onclick={remove}><Icon name="delete" /></button>{/if}
</div>
{#if setLabelVisibility}
    <label class="toggle">在地图上显示标签<input type="checkbox" checked={showLabel} onchange={e => setLabelVisibility?.(e.currentTarget.checked)} /></label>
{/if}

<style>
    .property-title { display: flex; align-items: center; gap: 4px; }
    .property-title input { width: 0; flex: 1; min-width: 0; font-weight: 650; padding: 4px 7px; }
    .property-title button { min-width: 27px; min-height: 27px; padding: 3px; }
    .property-title button[aria-pressed="true"] { background: var(--light); color: var(--teal); }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    let { name, label = "标签", rename, remove, copy, toggle, disabled = false, showLabel = true, setLabelVisibility }: { name: string; label?: string; rename?: (name: string) => void;
        remove?: () => void; copy?: () => void; toggle?: () => void; disabled?: boolean;
        showLabel?: boolean; setLabelVisibility?: (visible: boolean) => void } = $props();
    let toggleTitle = $derived((disabled ? "启用“" : "禁用“") + name + "”");
</script>