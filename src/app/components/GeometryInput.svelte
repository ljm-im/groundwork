{#snippet removeAction()}
    <button class="icon-button danger geometry-remove" aria-label="删除边界" data-tip="删除边界" onclick={remove}><Icon name="delete" /></button>
{/snippet}
<FieldRow {label} forInput={id} unitAction={remove ? removeAction : undefined}>
    <div class="geometry-control">
        <button {id} class="input-box geometry-box" aria-label={label} aria-pressed={active} data-tip={summary} {onclick}>
            <Icon name={icon} />
            <span>{summary ?? (icon === "point" ? "点" : icon === "section" ? "线段" :
                (icon === "closedPath" ? "闭合曲线" : "曲线") + "（" + count + " 个节点）")}</span>
        </button>
        {#if redraw}
            <button class="icon-button geometry-redraw" data-tip={"重画" + label} aria-label={"重画" + label}
                aria-pressed={redrawing} onclick={redraw}><Icon name="pen" /></button>
        {/if}
    </div>
</FieldRow>

<style>
    .geometry-control { display: flex; position: relative; }
    .geometry-box { width: 100%; min-width: 0; justify-content: flex-start; }
    .geometry-box span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .geometry-box[aria-pressed="true"] { color: var(--accent); background: var(--bg-selected); border-color: var(--accent); }
    .geometry-control:has(.geometry-redraw) .geometry-box { padding-inline-end: var(--icon-button); }
    .geometry-redraw { position: absolute; inset: 0 0 auto auto; }
    :global(.parameter-row:not(:hover, :focus-within)) .geometry-remove { opacity: 0; pointer-events: none; }
</style>

<script lang="ts">
    import Icon, { type IconName } from "./Icon.svelte";
    import FieldRow from "./FieldRow.svelte";
    const id = $props.id();
    let { label, icon = "point", count = 1, summary, active, onclick, redraw, redrawing = false, remove }: {
        label: string; icon?: IconName; count?: number; summary?: string; active: boolean; onclick: () => void;
        redraw?: () => void; redrawing?: boolean; remove?: () => void;
    } = $props();
</script>