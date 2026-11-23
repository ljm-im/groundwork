<Part title="选线参数">
    {#each settings as [key, label, unit] (key)}
        <NumberInput {editor} {label} unit={unit.replace(" / ", "")} address={["routing", key]}
            step={["relaxPasses", "profilePasses", "profileRadius"].includes(key) ? 1 : .1} />
    {/each}
</Part>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import NumberInput from "./NumberInput.svelte";
    import Part from "./Part.svelte";
    let { editor }: { editor: session.Editor } = $props();
    const settings = [["turnCost", "转弯代价", ""], ["overGradePenalty", "超坡惩罚", ""], ["minHeight", "最低通行高度", " / m"],
        ["sampleStep", "采样间距", " / m"], ["gradeWindow", "坡度测量窗口", " / m"], ["viaTolerance", "途经点容差", " / m"],
        ["landing", "平台长度", " / m"], ["clearLead", "入口直线长度", " / m"], ["relaxPasses", "平面平滑次数", ""],
        ["profilePasses", "纵断面平滑次数", ""], ["profileRadius", "平滑半径", " / 格"], ["roadBedExtra", "路基加宽", " / m"],
        ["detourLimit", "绕行比上限", ""], ["clearance", "道路净距", " / m"], ["overlapLength", "重叠长度", " / m"], ["junctionRadius", "路口半径", " / m"]] as const;
</script>