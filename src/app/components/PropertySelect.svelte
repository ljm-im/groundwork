<div class="choice">
    <span>{label}</span><button class="choice-face" aria-label={label} aria-expanded={open} bind:this={anchor} onclick={() => open = !open}><Icon name={icon} />{options.find(o => o.id === value)?.name ?? value}<small>▾</small></button>
    {#if open}<div class="choices" role="group" aria-label={group} popover="manual" use:anchoredPopup={{ anchor, close: () => open = false }}>
        <div class="group-name">{group}</div>
        {#each options as item (item.id)}<button aria-pressed={item.id === value} onclick={() => {
            open = false; if (item.id !== value) choose(item.id);
        }}><Icon name={icon} />{item.name}</button>{/each}
        {#if create}<button onclick={() => {
            open = false; create?.();
        }}><Icon name="plus" />{newLabel}</button>{/if}
    </div>{/if}
</div>
<svelte:window onkeydowncapture={e => {
    if (open && e.key === "Escape") {
        open = false; e.preventDefault(); e.stopPropagation();
    }
}} />

<style>
    .choice { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin: 5px 0; font-size: 12px; }
    .choice-face { justify-content: flex-start; width: 65%; gap: 5px; }
    .choice-face small { margin-left: auto; }
    .choices { position: fixed; z-index: 7; inset: auto; margin: 0; display: grid; padding: 4px; border: 1px solid var(--line); border-radius: 5px; overflow: auto; background: var(--panel); box-shadow: 0 5px 20px #173e3426; }
    .choices button { gap: 6px; justify-content: flex-start; border: 0; min-height: 25px; }
    .choices button[aria-pressed="true"] { background: var(--light); }
    .group-name { margin: 3px 5px; color: var(--muted); font-size: 10px; }
</style>

<script lang="ts">
    import { anchoredPopup } from "../state/popup.ts";
    import Icon from "./Icon.svelte";
    let { label, group, icon, value, options, newLabel, choose, create }: { label: string; group: string; icon: "function" | "field";
        value: string; options: { id: string; name: string }[]; newLabel?: string; choose: (v: string) => void; create?: () => void } = $props();
    let anchor = $state<HTMLButtonElement>(null!), open = $state(false);
</script>