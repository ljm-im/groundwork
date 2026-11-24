{#each issues as issue (issue)}
    <button class="issue-row" class:is-selected={editor.selectedIssues.includes(issue)} aria-pressed={editor.selectedIssues.includes(issue)} data-issue={editor.project.issues.indexOf(issue)} onclick={() => editor.issueAt(issue)}>
        <span class={issue.severity === "error" ? "issue-error" : "issue-warning"}><Icon name="issues" /></span>
        <span><b>{issue.label ?? "项目"}</b><small>{designProblemText(issue, editor.project.design, "property")}</small></span>
    </button>
{/each}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Issue } from "../types.ts";
    import { designProblemText } from "../state/designMessages.ts";
    import Icon from "./Icon.svelte";
    let { editor, issues }: { editor: session.Editor; issues: Issue[] } = $props();
</script>