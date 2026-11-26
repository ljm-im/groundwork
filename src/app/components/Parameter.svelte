{#if spec && spec.type !== "geometry"}
    {#if slot?.output}
        <FieldRow {label} {unit} labelIcon="outputValue" attributes={{ "data-parameter": slot.path.join(".") }}>
            <span class="profile-output" data-output-value>{displayValue(editor.numberEdits.get(key) as number, parameterStep(spec, field))}</span>
        </FieldRow>
    {:else}
        <NumberInput {editor} address={slot?.path ?? ["geoNodes", index, ...path]} {label} {unit}
            kind={spec.type === "field" ? "field" : "number"} self={key} owner={slot?.id ?? node.id} step={parameterStep(spec, field)} />
    {/if}
{/if}

<style>
    .profile-output { color: var(--text-secondary); }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type GeoNode } from "../../core/design/v5.ts";
    import { geoParameter, geoParameterName, type Address } from "../../core/design/parameters.ts";
    import { parameterStep, parameterUnit } from "../../core/design/functionTable.ts";
    import { displayValue } from "../../core/design/display.ts";
    import FieldRow from "./FieldRow.svelte";
    import NumberInput from "./NumberInput.svelte";

    let { editor, node, address, construction = false }: { editor: session.Editor; node: GeoNode; address: Address; construction?: boolean } = $props();
    let d = $derived(editor.project.design);
    let index = $derived(d.geoNodes.findIndex(n => n.id === node.id));
    let path = $derived([construction ? "construction" : "function", ...address]);
    let key = $derived(editor.numberEdits.key("geo:" + node.id + "." + (construction ? path : address).join(".")));
    let slot = $derived(editor.numberEdits.slots.get(key));
    let spec = $derived(slot?.spec ?? geoParameter(node, path));
    let label = $derived(slot?.spec?.profile ? slot.spec.label : geoParameterName(d, node, path, false) ?? slot?.label ?? "数值");
    let field = $derived(d.fields[node.field]);
    let unit = $derived(spec ? parameterUnit(spec, field?.unit) : "");
</script>