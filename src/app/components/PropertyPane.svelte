<div class="property-inspector" class:tabbed={showTabs}>
    {#if showTabs}
        <nav class="side-tabs" aria-label="属性选项卡">
            {#each tabs as [tab, label, icon] (tab)}
                <button class="icon-button" data-property-tab={tab} data-tip={label} aria-label={label}
                    aria-pressed={!nested && editor.propertyTab === tab} onclick={() => editor.changePropertyTab(tab)}>
                    <Icon name={icon} />{#if tab === "issues" && errors}<i class="count-dot danger" aria-label="有错误"></i>{/if}
                </button>
            {/each}
            {#if nested && editor.geometryPage}
                <hr />
                <button class="icon-button" data-property-tab="geometry" data-tip={editor.geometryPage.item.label}
                    aria-label={editor.geometryPage.item.label} aria-pressed="true">
                    <Icon name={geometryIcon(editor.geometryPage.item)} />
                </button>
            {/if}
        </nav>
    {/if}
    <div class="property-column">
        {@render title()}
        <div id="property-content" class="panel-content property-content" bind:this={editor.properties}>
            {#if children}{@render children(editor.propertyTab)}{/if}
        </div>
    </div>
</div>

<style>
    .property-inspector { display: grid; grid-template-columns: minmax(0, 1fr); height: 100%; min-height: 0; }
    .property-inspector.tabbed { grid-template-columns: var(--tabs-w) minmax(0, 1fr); }
    .property-column { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
    hr { width: var(--icon-tab); margin: var(--space-1) 0; border: 0; border-top: 1px solid var(--border); }
    .property-content {
        padding: var(--space-6) var(--panel-inset) calc(var(--panel-inset) + var(--editor-clearance, 0px));
    }
</style>

<script lang="ts">
    import { type Snippet } from "svelte";
    import { objectIssues } from "../../core/checks/issues.ts";
    import { geometryIcon, propertyTabs, type PropertyTab } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon from "./Icon.svelte";

    let { editor, title, children }: { editor: session.Editor; title: Snippet; children?: Snippet<[PropertyTab]> } = $props();
    let markKind = $derived(editor.selection?.kind === "mark" ? editor.project.design.marks.find(m => m.id === editor.selection!.id)?.kind : undefined);
    let tabs = $derived(propertyTabs(editor.selection, markKind));
    let nested = $derived(!!editor.geometryPage?.fromHolder);
    let showTabs = $derived(tabs.length > 1 || nested);
    let errors = $derived(objectIssues(editor.project, editor.selection).some(issue => issue.severity === "error"));
</script>