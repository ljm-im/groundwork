{#snippet content()}
    <span class="row-icon" class:danger={severity === "error"} class:issue-warning={severity === "warning"}><Icon name={icon} {builtin} /></span>
    <span class="row-text">
        <span>{name}</span>
        {#if description}<small>{description}</small>{/if}
    </span>
    {#if problem}<i class="count-dot danger" data-tip={problem} aria-label={problem}></i>{/if}
    {#if detail}{@render detail()}{/if}
{/snippet}
<div class="list-row" class:muted class:outside class:referenced class:insert-before={insertion === "before"}
    class:insert-after={insertion === "after"} class:described={!!description} role="group" aria-label={name}
    draggable={!!ondragstart} {ondragstart} {ondragend} {onmouseenter} {onmouseleave} {...rowAttributes}>
    {#if select}
        <button class="row-content" aria-pressed={selected} {...attributes} onclick={select} oncontextmenu={menu}>
            {@render content()}
        </button>
    {:else}
        <div class="row-content">{@render content()}</div>
    {/if}
    {#if actions}<div class="row-controls" style:flex-basis={actionsWidth}>{@render actions()}</div>{/if}
</div>

<style>
    .list-row { position: relative; display: flex; align-items: center; min-height: var(--row-h); }
    .list-row:hover { background-color: var(--bg-hover); }
    .list-row:has(> button[aria-pressed="true"]) { background-color: var(--bg-selected); }
    .list-row[draggable="true"]:not(:has(button.row-content)) { cursor: grab; }
    .row-content {
        flex: 1 1 0;
        display: flex;
        min-width: 0;
        min-height: var(--row-h);
        align-items: center;
        justify-content: flex-start;
        gap: var(--space-1);
        padding: var(--space-1) var(--panel-inset);
        text-align: start;
        border: 0;
        border-radius: 0;
        background: transparent;
    }
    .row-content:hover:enabled { background: transparent; }
    .list-row:has(> .row-controls) > .row-content { padding-inline-end: var(--space-1); }
    .row-icon { display: inline-flex; }
    .row-text { min-width: 0; }
    .row-text > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-text small { display: block; color: var(--text-secondary); }
    .row-controls { min-width: 0; padding-inline-end: var(--panel-inset); }
    .described .row-content { align-items: flex-start; }
    .described .row-icon { margin-block-start: 2px; }
    .muted :is(.row-text, :global(small)) { color: var(--text-disabled); text-decoration: line-through; }
    .outside { background: repeating-linear-gradient(45deg, var(--border) 0 1px, transparent 1px var(--stripe-step)) var(--bg-sunken); }
    .referenced { box-shadow: inset 0 0 0 1px var(--warning); }
    .insert-before::after, .insert-after::after { content: ""; position: absolute; inset: auto 0; height: 2px; background: var(--accent); pointer-events: none; }
    .insert-before::after { top: 0; }
    .insert-after::after { bottom: 0; }
</style>

<script lang="ts">
    import { type Snippet } from "svelte";
    import Icon, { type IconName } from "./Icon.svelte";

    let { icon, name, builtin = false, selected = false, muted = false, outside = false, referenced = false,
        insertion, attributes, rowAttributes, severity, description, problem, detail, actions, actionsWidth, select, onmenu,
        ondragstart, ondragend, onmouseenter, onmouseleave }: {
        icon: IconName; name: string; builtin?: boolean; selected?: boolean; muted?: boolean; outside?: boolean; referenced?: boolean;
        insertion?: "before" | "after"; attributes?: Record<string, string | number>; rowAttributes?: Record<string, string>;
        severity?: "error" | "warning"; description?: string; problem?: string; detail?: Snippet; actions?: Snippet; actionsWidth?: string;
        select?: () => void; onmenu?: (event: MouseEvent) => void; ondragstart?: (event: DragEvent) => void; ondragend?: () => void;
        onmouseenter?: () => void; onmouseleave?: () => void;
    } = $props();
    function menu(event: MouseEvent) {
        if (!onmenu) return;
        event.preventDefault();
        onmenu(event);
    }
</script>