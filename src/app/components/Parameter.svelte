{#if spec && spec.type !== "geometry"}
    <NumberInput {editor} address={["geoNodes", index, ...path]} {label} {unit}
        kind={spec.type === "field" ? "field" : "number"} self={key} owner={node.id} step={parameterStep(spec, field)} />
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type GeoNode } from "../../core/design/v5.ts";
    import { geoParameter, geoParameterName, type Address } from "../../core/design/parameters.ts";
    import { parameterStep, parameterUnit } from "../../core/design/functionTable.ts";
    import NumberInput from "./NumberInput.svelte";

    let { editor, node, address, construction = false }: { editor: session.Editor; node: GeoNode; address: Address; construction?: boolean } = $props();
    let d = $derived(editor.project.design);
    let index = $derived(d.geoNodes.findIndex(n => n.id === node.id));
    let path = $derived([construction ? "construction" : "function", ...address]);
    let key = $derived("geo:" + node.id + "." + (construction ? path : address).join("."));
    let slot = $derived(editor.numberEdits.slots.get(key));
    let spec = $derived(slot?.spec ?? geoParameter(node, path));
    let label = $derived(geoParameterName(d, node, path, false) ?? (address.includes("h") ? slot?.spec?.label : slot?.label) ?? "数值");
    let field = $derived(d.fields[node.field]);
    let unit = $derived(spec ? parameterUnit(spec, field?.unit) : "");
</script>