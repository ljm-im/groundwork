<aside>
    <nav class="tabs" aria-label="检查器">
        {#each tabs as [tab, label] (tab)}
            <button data-tab={tab} class:active={editor.tab === tab} aria-pressed={editor.tab === tab} onclick={() => editor.changeTab(tab)}>{label}{#if tab === "issues"} <i id="issue-dot" class="count-dot" hidden={!errors}></i>{/if}</button>
        {/each}
    </nav>
    <div bind:this={editor.panel} id="panel" inert={!!editor.busy} onchange={ev => {
        if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) changeField(editor, ev.target);
    }}>
        {#if editor.island}{#key editor.revision}<View {editor} />{/key}{/if}
    </div>
    <div class="hint"><span>双击道路、山脊或边界加点，也可按住 <kbd>Alt</kbd> 单击</span><span>拖动空白处或双指滑动平移 · 滚轮或捏合缩放</span></div>
</aside>

<style>
    :global {
        aside {
            background: var(--panel);
            border-left: 1px solid #cbd4ca;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }
        .tabs {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 4px;
            padding: 0 12px;
            border-bottom: 1px solid var(--line);
        }
        .tabs button {
            border: 0;
            border-bottom: 2px solid transparent;
            border-radius: 0;
            padding: 12px 0 10px;
            background: transparent;
            color: var(--muted);
            font-size: 13px;
        }
        .tabs button.active {
            color: var(--teal);
            font-weight: 650;
            border-bottom-color: var(--teal);
        }
        .count-dot {
            display: inline-block;
            width: 6px;
            height: 6px;
            background: var(--red);
            border-radius: 50%;
        }
        #panel {
            overflow: auto;
            scrollbar-gutter: stable;
            flex: 1;
            padding: 20px 14px 20px 18px;
        }
        .hint {
            border-top: 1px solid var(--line);
            padding: 11px 16px;
            color: var(--muted);
            font-size: 11px;
        }
        .hint span {
            display: block;
        }
        @media (max-width:680px) {
            aside {
                border: 0;
                border-top: 1px solid var(--line);
                min-height: 350px;
            }
            #panel {
                max-height: 62dvh;
            }
        }
    }
</style>

<script lang="ts">
    import * as session from "./session.svelte";
    import { changeField } from "./fields";
    import Network from "./Network.svelte";
    import Buildings from "./Buildings.svelte";
    import Terrain from "./Terrain.svelte";
    import Issues from "./Issues.svelte";
    import Layers from "./Layers.svelte";

    let { editor }: { editor: session.Editor } = $props();
    const tabs = [["network", "路网"], ["buildings", "建筑"], ["terrain", "地形"], ["layers", "图层"], ["issues", "校验"]] as const;
    const views = { network: Network, buildings: Buildings, terrain: Terrain, layers: Layers, issues: Issues };
    let View = $derived(views[editor.tab]);
    let errors = $derived.by(() => {
        editor.revision;
        return editor.island?.issues.some(i => i.severity === "error");
    });
</script>