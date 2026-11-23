<h2>设计</h2>
<Prompt {editor} title="全岛描述" target={{ group: "design" }} />
<Part title="随机细节">
    {#if d.variables.seed}<NumberInput {editor} label="种子" address={["variables", "seed", "value"]} self="var:seed" step={d.variables.seed.range?.[2] ?? 1} range={d.variables.seed.range} />{/if}
    <button data-action="reseed" onclick={() => editor.edit(d => {
        const current = Math.round(editor.island.resolved.variables.seed?.value ?? 0);
        const next = ((Math.imul(current, 7) + 13) >>> 0) % 997;
        d.variables.seed = { label: "种子", ...d.variables.seed, value: next === current ? (next + 1) % 997 : next };
    })}>换一组随机细节</button>
</Part>
<Part title="网格"><NumberInput {editor} label="网格间距" unit="m" kind="literal" address={["grid", "step"]} />
    <div class="field">东西范围<span class="mono">{editor.island.terrain.grid.xMin} … {editor.island.terrain.grid.xMax} m</span></div>
    <div class="field">南北范围<span class="mono">{editor.island.terrain.grid.yMin} … {editor.island.terrain.grid.yMax} m</span></div>
</Part>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import NumberInput from "./NumberInput.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design);
</script>