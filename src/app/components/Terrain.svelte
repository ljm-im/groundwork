<PropertyPane {editor}>
    {#snippet title()}<PropertyTitle name="项目" icon="project" />{/snippet}
    <Part title="描述"><Prompt {editor} target={{ group: "design" }} /></Part>
    <Part title="随机">
        <NumberInput {editor} label={d.inputs[seedId].label ?? seedId} labelIcon="inputs" builtin={isBuiltin("input", seedId)} address={["inputs", seedId, "value"]} self={"input:" + seedId}
            step={d.inputs[seedId].range[2]} range={d.inputs[seedId].range} />
    </Part>
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
    import { isBuiltin, seedId } from "../../core/design/defaults.ts";

    let { editor }: { editor: session.Editor } = $props();
    let d = $derived.by(() => {
        editor.revision;
        return editor.project.design;
    });
</script>