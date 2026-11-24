<div class="property-inspector" class:tabbed={tabs.length > 1}>
    {#if tabs.length > 1}
        <nav class="side-tabs" aria-label="属性选项卡">
            {#each tabs as [tab, label, icon] (tab)}
                <button class="icon-button" data-property-tab={tab} data-tip={label} aria-label={label}
                    aria-pressed={editor.propertyTab === tab} onclick={() => editor.changePropertyTab(tab)}>
                    <Icon name={icon} />{#if tab === "issues" && errors}<i class="count-dot" aria-label="有校验错误"></i>{/if}
                </button>
            {/each}
        </nav>
    {/if}
    <div class="property-column">
        {#key editor.revision}{@render title()}{/key}
        <div id="property-content" class="panel-content property-content" bind:this={editor.properties}>
            {#key editor.revision}{#if children}{@render children(editor.propertyTab)}{/if}{/key}
        </div>
    </div>
</div>

<style>
    .property-inspector { display: grid; grid-template-columns: minmax(0, 1fr); height: 100%; min-height: 0; }
    .property-inspector.tabbed { grid-template-columns: var(--tabs-w) minmax(0, 1fr); }
    .property-column { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
    .property-content {
        padding: var(--space-6) var(--panel-inset) calc(var(--panel-inset) + var(--editor-clearance, 0px));
    }
</style>

<script lang="ts">
    import { type Snippet } from "svelte";
    import { objectIssues } from "../../core/checks/issues.ts";
    import { propertyTabs, type PropertyTab } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon from "./Icon.svelte";

    let { editor, title, children }: { editor: session.Editor; title: Snippet; children?: Snippet<[PropertyTab]> } = $props();
    let tabs = $derived(propertyTabs(editor.selection));
    let errors = $derived.by(() => {
        editor.revision;
        return objectIssues(editor.project, editor.selection).some(issue => issue.severity === "error");
    });
</script>