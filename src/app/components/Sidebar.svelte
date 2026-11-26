<aside class="inspector" class:closed={layout.propertiesClosed} style:--upper={layout.upper * 100 + "%"} inert={!!editor.busy}>
    <div class="list-pane">
        <nav class="side-tabs" aria-label="列表选项卡">
            {#each tabs as [tab, label, icon] (tab)}
                <button class="icon-button" data-tab={tab} data-tip={label} aria-label={label} aria-pressed={editor.tab === tab} onclick={() => editor.changeTab(tab)}>
                    <Icon name={icon} />{#if tab === "issues" && errors}<i class="count-dot danger" id="issue-dot"></i>{/if}
                </button>
            {/each}
        </nav>
        <div bind:this={editor.panel} id="panel" class="panel-content">
            {#if editor.project}
                <Heading kind="panel-heading" title={tabs.find(([id]) => id === editor.tab)?.[1]}>
                    {#snippet actions()}
                        {#if editor.tab === "terrain"}
                            <AddButton label="新建地件" options={geoTools} choose={start} active={geoTools.some(({ id }) => editor.toolActive(id))} />
                        {:else if editor.tab === "marks"}
                            <AddButton label="新建标记" options={markTools} choose={start} active={markTools.some(({ id }) => editor.toolActive(id))} />
                        {/if}
                    {/snippet}
                </Heading>
                {#if search}
                    <Search id={search.id} label={search.label} value={editor[search.key]} change={value => editor[search!.key] = value} />
                {/if}
                {#if editor.tab === "terrain"}<GeoList {editor} />
                {:else if editor.tab === "inputs"}<Declarations {editor} />
                {:else if editor.tab === "marks"}<Marks {editor} />
                {:else if editor.tab === "issues"}<Issues {editor} />
                {:else}<Layers {editor} />{/if}
            {/if}
        </div>
    </div>
    <button class="split horizontal" data-split="upper" data-tip="调整属性区" aria-label="调整属性区" onpointerdown={onresize} ondblclick={ontoggle} onkeydown={onkey}></button>
    <div id="properties" hidden={layout.propertiesClosed}>
        {#if editor.project}
            {#key inspected}
                {#if editor.geometryPage}
                    {@const { id, item, target } = editor.geometryPage}
                    <GeometryProperties {editor} {id} {item} path={target?.index ?? -1} />
                {:else if editor.selection?.kind === "geoNode"}<GeoProperties {editor} />
                {:else if editor.selection?.kind === "input" || editor.selection?.kind === "field"}<Declarations {editor} properties />
                {:else if editor.selection?.kind === "mark"}<Marks {editor} properties />
                {:else if editor.selection?.kind === "section"}<SectionProperties {editor} />
                {:else}<Terrain {editor} />{/if}
            {/key}
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
            box-shadow: inset -1px 0 var(--border-region);
        }
        .side-tabs button { position: relative; }
        .side-tabs button[aria-pressed="true"] { box-shadow: inset 2px 0 var(--accent); }
        .side-tabs button[aria-pressed="true"]:focus-visible { box-shadow: inset 2px 0 var(--accent), 0 0 0 2px var(--focus-ring); }
        .side-tabs .icon { width: var(--icon-tab); height: var(--icon-tab); }
        .side-tabs .count-dot { position: absolute; top: var(--space-1); right: var(--space-1); }
        .panel-content { min-width: 0; min-height: 0; overflow: auto; overflow-wrap: anywhere; }
        #panel { padding-block: 0 var(--panel-inset); }
        #panel .part-title, #panel .panel-inset { padding-inline: var(--panel-inset); }
        #panel .panel-inset .part-title { padding-inline: 0; }
        #panel .panel-inset { margin-block: var(--space-1); }
        #panel .panel-inset + .part { margin-top: var(--space-2); }
        #properties { min-width: 0; min-height: 0; }
        #properties .part > .list-row {
            width: calc(100% + 2 * var(--panel-inset));
            margin-inline: calc(-1 * var(--panel-inset));
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Layout } from "../state/layout.ts";
    import Terrain from "./Terrain.svelte";
    import Issues from "./Issues.svelte";
    import Layers from "./Layers.svelte";
    import Icon from "./Icon.svelte";
    import AddButton from "./AddButton.svelte";
    import Heading from "./Heading.svelte";
    import Search from "./Search.svelte";
    import { type Tool } from "../types.ts";
    import GeoList from "./GeoList.svelte";
    import GeoProperties from "./GeoProperties.svelte";
    import GeometryProperties from "./GeometryProperties.svelte";
    import Declarations from "./Declarations.svelte";
    import Marks from "./Marks.svelte";
    import SectionProperties from "./SectionProperties.svelte";

    let { editor, layout, onresize, ontoggle, onkey }: {
        editor: session.Editor; layout: Layout; onresize: (e: PointerEvent) => void; ontoggle: () => void; onkey: (e: KeyboardEvent) => void;
    } = $props();
    const tabs = [["terrain", "地件", "terrain"], ["inputs", "变量", "inputs"], ["marks", "标记", "marks"],
        ["issues", "问题", "issues"], ["layers", "显示", "display"]] as const;
    const geoTools = [{ id: "pen", name: "钢笔", icon: "pen" }, { id: "rect", name: "矩形", icon: "rect" },
        { id: "circle", name: "圆", icon: "circle" }, { id: "sector", name: "扇形", icon: "sector" }, { id: "strip", name: "条带", icon: "strip" }] as const;
    const markTools = [{ id: "textMark", name: "文字标记", icon: "textMark" }, { id: "scaleMark", name: "比例尺", icon: "scaleMark" },
        { id: "section", name: "剖面线", icon: "sectionMark" }] as const;
    const searches = {
        terrain: { id: "terrain-search", label: "查找地件", key: "terrainFilter" },
        inputs: { id: "variable-search", label: "查找变量", key: "variableFilter" },
        marks: { id: "mark-search", label: "查找标记", key: "markFilter" },
        issues: undefined, layers: undefined
    } as const;
    let search = $derived(searches[editor.tab]);
    function start(tool: string) {
        editor.setTool(tool as Tool);
        editor.map.canvas.focus({ preventScroll: true });
    }
    let errors = $derived(editor.project?.issues.some(issue => issue.severity === "error"));
    let inspected = $derived(editor.selection ? editor.selection.kind + ":" + editor.selection.id : null);
</script>