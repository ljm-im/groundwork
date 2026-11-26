{#each issues as issue (issue)}
    <ListRow icon="issues" severity={issue.severity} name={issue.label ?? "项目"}
        description={designProblemText(issue, editor.project.design, "property")}
        selected={editor.selectedIssues.includes(issue)} attributes={{ "data-issue": editor.project.issues.indexOf(issue) }}
        select={() => editor.issueAt(issue)} onmenu={event => editor.openIssueMenu(issue, event)} />
{/each}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Issue } from "../types.ts";
    import { designProblemText } from "../state/designMessages.ts";
    import ListRow from "./ListRow.svelte";
    let { editor, issues }: { editor: session.Editor; issues: Issue[] } = $props();
</script>