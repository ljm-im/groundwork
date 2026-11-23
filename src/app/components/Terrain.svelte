<h2>设计</h2>
<Prompt {editor} title="全岛描述" target={{ group: "design" }} />
<Part title="随机细节"><label class="field">种子<input type="number" id="seed" value={d.seed} step="1" /></label>
    <button data-action="reseed" onclick={() => {
        const next = ((Math.imul(d.seed, 7) + 13) >>> 0) % 997; d.seed = next === d.seed ? (next + 1) % 997 : next; editor.rebuild();
    }}>换一组随机细节</button></Part>
<Part title="网格"><div class="field">网格间距<span class="mono">{d.grid.step} m</span></div>
    <div class="field">东西范围<span class="mono">{editor.island.terrain.grid.xMin} … {editor.island.terrain.grid.xMax} m</span></div><div class="field">南北范围<span class="mono">{editor.island.terrain.grid.yMin} … {editor.island.terrain.grid.yMax} m</span></div></Part>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design);
</script>