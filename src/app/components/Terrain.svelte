<PropertyPane {editor}>
    {#snippet title()}<PropertyTitle name="项目" icon="project" />{/snippet}
    <Part title="描述"><Prompt {editor} target={{ group: "design" }} /></Part>
    <Part title="地形计算"><NumberInput {editor} label={gridStep.label} unit={gridStep.unit} step={gridStep.step} kind="literal" address={gridStep.key} /></Part>
</PropertyPane>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import NumberInput from "./NumberInput.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import { gridStep } from "../../core/design/functionTable.ts";

    let { editor }: { editor: session.Editor } = $props();
</script>