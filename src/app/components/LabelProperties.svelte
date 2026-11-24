<Part><CheckboxRow label="显示名称" checked={showLabel} change={setLabelVisibility} /></Part>
<Description {editor} {target} />

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import CheckboxRow from "./CheckboxRow.svelte";
    import Description from "./Description.svelte";
    import Part from "./Part.svelte";

    let { editor, target, showLabel, setLabelVisibility }: {
        editor: session.Editor; target: session.DescriptionTarget; showLabel: boolean; setLabelVisibility: (visible: boolean) => void;
    } = $props();
</script>