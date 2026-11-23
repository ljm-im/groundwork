<div class="parameter-row geometry-row" class:with-redraw={!!redraw}>
    <button class="geometry-select" aria-label={label} aria-pressed={active} data-tip={summary} {onclick}>
        <span class="param-name">{label}</span>
        <span class="input-box geometry-box">
            <Icon name={icon} />
            <span>{summary ?? (icon === "point" ? "点" : icon === "polyline" ? "折线（" + count + " 个顶点）" : "闭合路径（" + count + " 个节点）")}</span>
        </span>
    </button>
    {#if redraw}
        <button class="icon-button geometry-redraw" data-tip={"重画" + label} aria-label={"重画" + label} onclick={redraw}><Icon name="pen" /></button>
    {/if}
</div>

<style>
    .geometry-select {
        display: grid;
        grid-column: 1 / 3;
        grid-row: 1;
        grid-template-columns: subgrid;
        text-align: start;
        border: 0;
        padding: 0;
        background: transparent;
    }
    .geometry-select:hover:enabled { background: transparent; }
    .geometry-box { display: flex; min-width: 0; align-items: center; gap: var(--space-1); }
    .geometry-box span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .geometry-select:hover .geometry-box { border-color: var(--border-strong); }
    .geometry-select:is([aria-pressed="true"], :focus-visible) .geometry-box { border-color: var(--accent); }
    .geometry-select[aria-pressed="true"] .geometry-box { color: var(--accent); background: var(--bg-selected); }
    .geometry-select:focus-visible { box-shadow: none; }
    .geometry-select:focus-visible .geometry-box { box-shadow: 0 0 0 2px var(--focus-ring); }
    .with-redraw .geometry-box { padding-right: var(--icon-button); }
    .geometry-redraw { grid-column: 2; grid-row: 1; justify-self: end; }
</style>

<script lang="ts">
    import Icon, { type IconName } from "./Icon.svelte";
    let { label, icon = "point", count = 1, summary, active, onclick, redraw }: {
        label: string; icon?: IconName; count?: number; summary?: string; active: boolean; onclick: () => void; redraw?: () => void;
    } = $props();
</script>