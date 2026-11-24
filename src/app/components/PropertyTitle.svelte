<div class="property-title">
    <Icon name={icon} {builtin} />
    {#if rename}
        <input aria-label={label} data-tip={label} value={name} onchange={e => {
            const text = e.currentTarget.value.trim();
            if (text && text !== name) rename?.(text);
            else e.currentTarget.value = name;
        }} />
    {:else}<h2>{name}</h2>{/if}
    {#if toggle}<button class="icon-button" data-tip={toggleTitle} aria-label={toggleTitle} aria-pressed={disabled} onclick={toggle}><Icon name="exclude" /></button>{/if}
    {#if copy}<button class="icon-button" data-tip={"复制“" + name + "”"} aria-label={"复制“" + name + "”"} onclick={copy}><Icon name="copy" /></button>{/if}
    {#if remove}<button class="icon-button danger" data-action="delete" data-tip={"删除“" + name + "”"} aria-label={"删除“" + name + "”"} onclick={remove}><Icon name="delete" /></button>{/if}
</div>

<style>
    .property-title {
        display: flex;
        align-items: center;
        min-height: calc(var(--control-h) + 2 * var(--space-1));
        gap: var(--space-1);
        padding: var(--space-1) var(--panel-inset);
    }
    .property-title input, .property-title h2 {
        min-width: 0;
        flex: 1;
        font-size: var(--text-lg);
        line-height: var(--leading-lg);
        font-weight: var(--weight-semibold);
    }
</style>

<script lang="ts">
    import Icon, { type IconName } from "./Icon.svelte";
    let { icon, name, label = "名称", rename, remove, copy, toggle, builtin = false, disabled = false }: {
        icon: IconName; builtin?: boolean; name: string; label?: string; rename?: (name: string) => void;
        remove?: () => void; copy?: () => void; toggle?: () => void; disabled?: boolean;
    } = $props();
    let toggleTitle = $derived((disabled ? "启用“" : "禁用“") + name + "”");
</script>