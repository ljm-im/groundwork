<aside class="inspector" class:closed={layout.propertiesClosed} style:--upper={layout.upper * 100 + "%"} inert={!!editor.busy} onchange={changed}>
    <div class="list-pane">
        <nav class="side-tabs" aria-label="列表选项卡">
            {#each tabs as [tab, label, icon] (tab)}
                <button class="icon-button" data-tab={tab} data-tip={label} aria-label={label} aria-pressed={editor.tab === tab} onclick={() => editor.changeTab(tab)}>
                    <Icon name={icon} />{#if tab === "issues" && errors}<i class="count-dot" id="issue-dot"></i>{/if}
                </button>
            {/each}
        </nav>
        <div bind:this={editor.panel} id="panel" class="panel-content">
            {#if editor.island}{#key editor.revision}
                <div class="panel-heading">
                    <h2>{tabs.find(([id]) => id === editor.tab)?.[1]}</h2>
                    {#if editor.tab === "network"}
                        <button class="icon-button" data-action="reroute-all" data-tip="重新选线" aria-label="重新选线" onclick={() => editor.rerouteAll()}><Icon name="reroute" /></button>
                    {:else if editor.tab === "buildings"}
                        <button class="icon-button" data-action="place" data-tip="放置建筑" aria-label="放置建筑" onclick={() => editor.setTool("building")}><Icon name="plus" /></button>
                    {:else if editor.tab === "issues" && editor.candidates?.length}
                        <button class="icon-button" data-action="all-issues" data-tip="全部校验" aria-label="全部校验" onclick={() => editor.changeTab("issues")}><Icon name="chevronLeft" /></button>
                    {/if}
                </div>
                {#if editor.tab === "terrain"}<GeoList {editor} />
                {:else if editor.tab === "inputs"}<Declarations {editor} />
                {:else if editor.tab === "network"}<Network {editor} listOnly />
                {:else if editor.tab === "buildings"}<Buildings {editor} listOnly />
                {:else if editor.tab === "marks"}<Marks {editor} />
                {:else if editor.tab === "issues"}<Issues {editor} />
                {:else}<Layers {editor} />{/if}
            {/key}{/if}
        </div>
    </div>
    <button class="split horizontal" data-split="upper" data-tip="调整属性区" aria-label="调整属性区" onpointerdown={onresize} ondblclick={ontoggle} onkeydown={onkey}></button>
    <div id="properties" hidden={layout.propertiesClosed}>
        {#if editor.island}
            {#if editor.selection?.kind === "geoNode"}<GeoProperties {editor} />
            {:else if editor.selection?.kind === "input" || editor.selection?.kind === "field"}<Declarations {editor} properties />
            {:else if editor.selection?.kind === "building"}<Buildings {editor} />
            {:else if editor.selection?.kind === "mark"}<Marks {editor} properties />
            {:else if editor.selection?.kind === "section"}<SectionProperties {editor} />
            {:else if editor.selection && ["edge", "via", "node"].includes(editor.selection.kind)}<Network {editor} />
            {:else}<Terrain {editor} />{/if}
        {/if}
    </div>
</aside>

<style>
    :global {
        .inspector {
            --panel-inset: var(--space-3);
            display: grid;
            grid-template-rows: clamp(125px, var(--upper), calc(100% - 145px)) var(--split-target) minmax(0, 1fr);
            min-width: 0;
            min-height: 0;
            position: relative;
            z-index: var(--z-panel);
            background: var(--bg-panel);
        }
        .inspector.closed { grid-template-rows: minmax(0, 1fr) var(--split-target) 0; }
        .list-pane { display: grid; grid-template-columns: var(--tabs-w) minmax(0, 1fr); min-height: 0; }
        .side-tabs {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding-block: var(--space-1);
            gap: var(--space-1);
            overflow: auto;
            background: var(--bg-sunken);
        }
        .side-tabs button { position: relative; }
        .side-tabs .icon { width: var(--icon-toolbar); height: var(--icon-toolbar); }
        .side-tabs .count-dot { position: absolute; top: var(--space-1); right: var(--space-1); }
        .panel-content { min-width: 0; min-height: 0; overflow: auto; overflow-wrap: anywhere; }
        #panel { padding-block: var(--space-1) var(--panel-inset); }
        #panel .part-title, #panel .panel-inset { padding-inline: var(--panel-inset); }
        #panel .panel-inset .part-title { padding-inline: 0; }
        #panel .panel-inset { margin-block: var(--space-1); }
        #panel .panel-heading + .part { margin-top: var(--space-2); }
        #properties { min-width: 0; min-height: 0; }
        #properties .part > .issue-row, #properties .part > .route-row {
            width: calc(100% + 2 * var(--panel-inset));
            margin-inline: calc(-1 * var(--panel-inset));
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Layout } from "../state/layout.ts";
    import { changeField } from "../state/fields.ts";
    import Network from "./Network.svelte";
    import Buildings from "./Buildings.svelte";
    import Terrain from "./Terrain.svelte";
    import Issues from "./Issues.svelte";
    import Layers from "./Layers.svelte";
    import Icon from "./Icon.svelte";
    import GeoList from "./GeoList.svelte";
    import GeoProperties from "./GeoProperties.svelte";
    import Declarations from "./Declarations.svelte";
    import Marks from "./Marks.svelte";
    import SectionProperties from "./SectionProperties.svelte";

    let { editor, layout, onresize, ontoggle, onkey }: {
        editor: session.Editor; layout: Layout; onresize: (e: PointerEvent) => void; ontoggle: () => void; onkey: (e: KeyboardEvent) => void;
    } = $props();
    const tabs = [["terrain", "地件", "terrain"], ["inputs", "自定义输入", "inputs"], ["network", "路网", "edge"], ["buildings", "建筑", "building"], ["marks", "标记", "marks"], ["issues", "校验", "issues"], ["layers", "显示", "display"]] as const;
    let errors = $derived.by(() => {
        editor.revision;
        return editor.island?.issues.some(issue => issue.severity === "error");
    });
    function changed(e: Event) {
        if (e.target instanceof HTMLInputElement) changeField(editor, e.target);
    }
</script>