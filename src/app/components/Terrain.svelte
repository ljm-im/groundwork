<PropertyPane {editor}>
    {#snippet title()}<PropertyTitle name="项目" category="项目" icon="project" />{/snippet}
    <Description {editor} target={{ group: "design" }} />
    <Part title="地形计算"><NumberInput {editor} label={gridStep.label} unit={gridStep.unit} step={gridStep.step} kind="literal" address={gridStep.key} /></Part>
</PropertyPane>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import Description from "./Description.svelte";
    import NumberInput from "./NumberInput.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import { gridStep } from "../../core/design/functionTable.ts";

    let { editor }: { editor: session.Editor } = $props();
</script>