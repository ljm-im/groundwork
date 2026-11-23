<div class="choice" bind:this={root}>
    <span>{label}</span><button class="choice-face" aria-label={label} aria-expanded={open} onclick={() => {
        const b = root.getBoundingClientRect(); const height = Math.min(300, options.length * 27 + 56, innerHeight - 12);
        position = { x: Math.min(innerWidth - 200, Math.max(4, b.right - 196)), y: b.bottom + height < innerHeight ? b.bottom : Math.max(4, b.top - height), height };
        open = !open;
    }}><Icon name={icon} />{options.find(o => o.id === value)?.name ?? value}<small>▾</small></button>
    {#if open}<div class="choices" role="group" aria-label={group} style:left={position.x + "px"} style:top={position.y + "px"} style:max-height={position.height + "px"}>
        <div class="group-name">{group}</div>
        {#each options as item (item.id)}<button aria-pressed={item.id === value} onclick={() => {
            open = false; if (item.id !== value) choose(item.id);
        }}><Icon name={icon} />{item.name}</button>{/each}
        <button onclick={() => {
            open = false; create();
        }}><Icon name="plus" />{newLabel}</button>
    </div>{/if}
</div>
<svelte:window onpointerdown={e => {
    if (!root?.contains(e.target as Node)) open = false;
}} onkeydown={e => {
    if (open && e.key === "Escape") {
        open = false; e.stopPropagation();
    }
}} />

<style>
    .choice { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin: 5px 0; font-size: 12px; }
    .choice-face { justify-content: flex-start; width: 65%; gap: 5px; }
    .choice-face small { margin-left: auto; }
    .choices { position: fixed; z-index: 7; width: 196px; display: grid; padding: 4px; border: 1px solid var(--line); border-radius: 5px; overflow: auto; background: var(--panel); box-shadow: 0 5px 20px #173e3426; }
    .choices button { gap: 6px; justify-content: flex-start; border: 0; min-height: 25px; }
    .choices button[aria-pressed="true"] { background: var(--light); }
    .group-name { margin: 3px 5px; color: var(--muted); font-size: 10px; }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    let { label, group, icon, value, options, newLabel, choose, create }: { label: string; group: string; icon: "function" | "field";
        value: string; options: { id: string; name: string }[]; newLabel: string; choose: (v: string) => void; create: () => void } = $props();
    let root: HTMLElement, open = $state(false), position = $state({ x: 0, y: 0, height: 300 });
</script>