<NumberInput {editor} address={["geoNodes", index, ...(construction ? ["construction"] : ["function"]), ...address]} label={title}
    unit={unit ?? ""} kind={field ? "field" : "number"} self={key} owner={node.id}
    step={["seed", "droplets", "octaves", "lifetime"].includes(String(address.at(-1))) ? 1 : .1} />

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type GeoNode } from "../../core/design/v5.ts";
    import { type Address } from "../../core/design/parameters.ts";
    import NumberInput from "./NumberInput.svelte";
    let { editor, node, address, label, field = false, construction = false }: { editor: session.Editor; node: GeoNode; address: Address; label: string; field?: boolean; construction?: boolean } = $props();
    let index = $derived(editor.island.design.geoNodes.findIndex(n => n.id === node.id));
    let [title, unit] = $derived(label.split(" / "));
    let key = $derived("geo:" + node.id + "." + (construction ? "construction." : "") + address.join("."));
</script>