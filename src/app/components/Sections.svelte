<section class="sections" aria-label="地形剖面">
    <div bind:this={editor.plots} id="plots" class="plots"></div>
</section>

<style>
    :global {
        .sections { height: 100%; background: var(--bg-panel); display: grid; grid-template-rows: minmax(0, 1fr); }
        .plots { min-height: 0; display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; padding: 0 var(--space-2) var(--space-2); }
        .plot { min-height: 0; min-width: 0; display: grid; grid-template-rows: var(--leading-sm) minmax(0, 1fr); padding: 0 var(--space-2); }
        .plot-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); line-height: var(--leading-sm); color: var(--text-secondary); }
        .plot-title b { margin-inline-end: var(--space-1); color: var(--text); }
        .plot canvas { display: block; width: 100%; height: 100%; min-height: 0; min-width: 0; }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
</script>