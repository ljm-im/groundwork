<PropertyPane {editor}>
    {#snippet title()}<PropertyTitle name="项目" icon="project" />{/snippet}
    <Part title="描述"><Prompt {editor} target={{ group: "design" }} /></Part>
    <Part title="随机">
        {#if d.inputs.seed}<NumberInput {editor} label="种子" address={["inputs", "seed", "value"]} self="input:seed" step={d.inputs.seed.range?.[2] ?? 1} range={d.inputs.seed.range} />{/if}
    </Part>
    <Part title="地形计算"><NumberInput {editor} label="采样间距" unit="m" kind="literal" address={["grid", "step"]} /></Part>
    <Routing {editor} />
</PropertyPane>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import NumberInput from "./NumberInput.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import Routing from "./Routing.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let d = $derived.by(() => {
        editor.revision;
        return editor.island.design;
    });
</script>