<h2>项目</h2>
<Prompt {editor} title="描述" target={{ group: "design" }} />
<Part title="随机">
    {#if d.inputs.seed}<NumberInput {editor} label="种子" address={["inputs", "seed", "value"]} self="input:seed" step={d.inputs.seed.range?.[2] ?? 1} range={d.inputs.seed.range} />{/if}
</Part>
<Part title="地形计算"><NumberInput {editor} label="采样间距" unit="m" kind="literal" address={["grid", "step"]} /></Part>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import NumberInput from "./NumberInput.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design);
</script>