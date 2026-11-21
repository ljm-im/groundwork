{#if editor.candidates?.length}
    <button class="flat back" data-action="all-issues" onclick={() => editor.changeTab("issues")}>‹ 全部校验</button><h2>此处的问题</h2>
    <Part title="选择一条定位" count={editor.candidates.length}><IssueRows {editor} issues={editor.candidates} /></Part>
{:else}
    <h2>设计校验</h2><div class="sub">单击记录可在平面图中定位。</div>
    <Part title="问题" count={errors.length}>{#if errors.length}<IssueRows {editor} issues={errors} />{:else}<div class="sub">通过全部检查</div>{/if}</Part>
    <Part title="提示" count={warnings.length}>{#if warnings.length}<IssueRows {editor} issues={warnings} />{:else}<div class="sub">无提示</div>{/if}</Part>
{/if}

<script lang="ts">
    import * as session from "./session.svelte";
    import IssueRows from "./IssueRows.svelte";
    import Part from "./Part.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let errors = $derived(editor.island.issues.filter(i => i.severity === "error"));
    let warnings = $derived(editor.island.issues.filter(i => i.severity === "notice"));
</script>