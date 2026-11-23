<button class="geometry-row" aria-label={label} aria-pressed={active} {onclick}>
    <span>{label}</span><span class="geometry-box"><Icon name={icon} />{icon === "point" ? "点" : icon === "polyline" ? "折线 · " + count + " 个顶点" : "闭合路径 · " + count + " 个节点"}</span>
</button>

<style>
    .geometry-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 5px; width: 100%; flex: 1; align-items: center; text-align: left; border: 0; padding: 0; background: transparent; font-size: 12px; }
    .geometry-box { display: flex; align-items: center; gap: 6px; min-height: 26px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 4px; }
    .geometry-row[aria-pressed="true"] .geometry-box { border-color: var(--teal); color: var(--teal); background: var(--light); }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    let { label, icon = "point", count = 1, active, onclick }: { label: string; icon?: "point" | "polyline" | "closedPath"; count?: number; active: boolean; onclick: () => void } = $props();
</script>