<aside class="inspector" style:--upper={layout.upper * 100 + "%"}>
    <nav class="side-tabs" aria-label="检查器">
        {#each tabs as [tab, label, icon] (tab)}
            <button data-tab={tab} data-tip={label} aria-label={label} aria-pressed={editor.tab === tab} onclick={() => editor.changeTab(tab)}>
                <Icon name={icon} />{#if tab === "issues" && errors}<i class="count-dot" id="issue-dot"></i>{/if}
            </button>
        {/each}
    </nav>
    <div class="panel-stack" class:closed={layout.propertiesClosed} inert={!!editor.busy} onchange={changed}>
        <div bind:this={editor.panel} id="panel" class="panel-content">
            {#if editor.island}{#key editor.revision}
                {#if editor.tab === "terrain"}<GeoList {editor} />
                {:else if editor.tab === "variables"}<Declarations {editor} />
                {:else if editor.tab === "network"}<Network {editor} listOnly />
                {:else if editor.tab === "buildings"}<Buildings {editor} listOnly />
                {:else if editor.tab === "issues"}<Issues {editor} />
                {:else}<Layers {editor} />{/if}
            {/key}{/if}
        </div>
        <button class="split horizontal" data-split="upper" data-tip="调整属性区" aria-label="调整属性区" onpointerdown={onresize} ondblclick={ontoggle} onkeydown={onkey}></button>
        <div bind:this={editor.properties} id="properties" class="panel-content" hidden={layout.propertiesClosed}>
            {#if editor.island}{#key editor.revision}
                {#if editor.selection?.kind === "geoNode"}<GeoProperties {editor} />
                {:else if editor.selection?.kind === "variable" || editor.selection?.kind === "field"}<Declarations {editor} properties />
                {:else if editor.selection?.kind === "building"}<Buildings {editor} />
                {:else if editor.selection?.kind === "section"}
                    {@const section = editor.island.design.sections.find(s => s.id === editor.selection!.id)}
                    {#if section}<h2>{section.name}</h2>
                        <GeometryInput label="剖面线" icon="polyline" count={section.points.length} active={editor.map?.objectGeometry?.kind === "section"} onclick={() => editor.focusObjectGeometry({ kind: "section", id: section.id })} />
                    {/if}
                {:else if editor.selection && ["edge", "via", "node"].includes(editor.selection.kind)}<Network {editor} />
                {:else}
                    {#if editor.tab === "network"}<Routing {editor} />{/if}
                    <Terrain {editor} />
                {/if}
            {/key}{/if}
        </div>
    </div>
</aside>

<style>
    :global {
        .inspector { background: var(--panel); display: grid; grid-template-columns: 38px minmax(0, 1fr); min-height: 0; }
        .side-tabs { background: var(--paper); border-right: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; padding: 6px 0; gap: 4px; }
        .side-tabs button { border: 0; background: transparent; width: 32px; height: 34px; padding: 0; position: relative; color: var(--muted); }
        .side-tabs button[aria-pressed="true"] { color: var(--teal); background: var(--light); box-shadow: inset 2px 0 var(--teal); }
        .count-dot { position: absolute; top: 4px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--red); }
        .panel-stack { display: grid; grid-template-rows: clamp(125px, var(--upper), calc(100% - 145px)) 5px minmax(0, 1fr); min-height: 0; }
        .panel-stack.closed { grid-template-rows: minmax(0, 1fr) 5px 0; }
        .panel-content { overflow: auto; padding: 12px; min-height: 0; scrollbar-gutter: stable; overflow-wrap: anywhere; }
        .panel-content h2 { font-size: 16px; }
        .panel-content .part { margin-top: 11px; padding-top: 9px; }
        .panel-content .object-row[aria-pressed="true"], .panel-content .route-row[aria-pressed="true"] { background: var(--light); }
        .panel-content .field input, .panel-content .field select { max-width: 58%; }
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
    import GeometryInput from "./GeometryInput.svelte";
    import GeoProperties from "./GeoProperties.svelte";
    import Declarations from "./Declarations.svelte";
    import Routing from "./Routing.svelte";

    let { editor, layout, onresize, ontoggle, onkey }: { editor: session.Editor; layout: Layout; onresize: (e: PointerEvent) => void; ontoggle: () => void; onkey: (e: KeyboardEvent) => void } = $props();
    const tabs = [["terrain", "地件", "terrain"], ["variables", "变量", "variables"], ["network", "路网", "edge"], ["buildings", "建筑", "building"], ["issues", "校验", "issues"], ["layers", "显示", "eye"]] as const;
    let errors = $derived.by(() => {
        editor.revision; return editor.island?.issues.some(i => i.severity === "error");
    });
    function changed(e: Event) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) changeField(editor, e.target);
    }
</script>