<FieldRow {label} forInput={id} {onmouseenter} {onmouseleave}>
    <div class="geometry-control input-box" bind:this={box}>
        <button {id} class="geometry-box" aria-label={label} aria-pressed={active} data-tip={item?.label ?? summary} {onclick}>
            <Icon name={item ? geometryIcon(item) : icon} /><span>{item?.label ?? summary ?? "线段"}</span>
        </button>
        {#if redraw}
            <button class="icon-button geometry-redraw" data-tip={redrawLabel} aria-label={redrawLabel}
                aria-pressed={redrawing} onclick={redraw}><Icon name="pen" /></button>
        {/if}
        {#if reference}
            <button class="icon-button geometry-reference" data-tip={menuLabel} aria-label={"为“" + (reference.name ?? label) + "”" + menuLabel}
                aria-expanded={opened} bind:this={toggle} onclick={e => {
                    pointerOpened = e.detail > 0;
                    if (opened) close();
                    else opened = true;
                }}><Icon name="collapse" /></button>
            {#if opened}
                <Menu label={menuLabel} variant="reference-menu" kind="listbox" anchor={box} groups={choices} empty={"没有可用的" + category}
                    singleLine={!!pointReference} {pointerOpened} close={focus => close(focus)} {choose} {hover} />
            {/if}
        {/if}
    </div>
</FieldRow>

<style>
    .geometry-control { display: flex; align-items: center; padding: 0; }
    .geometry-box { flex: 1; min-width: 0; min-height: 0; height: 100%; justify-content: flex-start; padding-inline: var(--space-1); border: 0; background: transparent; overflow: hidden; }
    .geometry-box span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .geometry-control:has(.geometry-box[aria-pressed="true"]) { color: var(--accent); background: var(--bg-selected); border-color: var(--accent); }
</style>

<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { curveKey, geometryAt, isHolderRef, type CurveSlot } from "../../core/design/curveReferences.ts";
    import { canUnlinkPoint } from "../../core/edit/geoNodes.ts";
    import { pointSlotForSelection, type PointTarget } from "../../core/edit/selection.ts";
    import { geometryIcon } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import Menu from "./Menu.svelte";
    import FieldRow from "./FieldRow.svelte";
    const id = $props.id();
    let { label, icon = "point", summary, active, onclick, redraw, redrawLabel = "重画" + label, redrawing = false, onmouseenter, onmouseleave, reference }: {
        label: string; icon?: IconName; summary?: string; active: boolean; onclick: () => void;
        reference?: { editor: session.Editor; name?: string } & ({ slot: CurveSlot } | { target: PointTarget });
        redraw?: () => void; redrawLabel?: string; redrawing?: boolean; onmouseenter?: () => void; onmouseleave?: () => void;
    } = $props();
    let opened = $state(false), pointerOpened = $state(false);
    let box = $state<HTMLElement>(null!), toggle = $state<HTMLButtonElement>(null!);
    let curveReference = $derived(reference && "slot" in reference ? reference : undefined);
    let pointReference = $derived(reference && "target" in reference ? reference : undefined);
    let pointSlot = $derived(pointReference && pointSlotForSelection(pointReference.editor.project.design, pointReference.target));
    let category = $derived(pointReference ? "点" : "曲线");
    let menuLabel = $derived("引用" + category);
    let current = $derived(curveReference?.editor.curves.source(curveReference.slot).id);
    let item = $derived(current === undefined ? undefined : geometryAt(curveReference!.editor.project.design, current));
    let shoreAlias = $derived(curveReference?.slot.holder?.kind === "shore" && isHolderRef(curveReference.slot.holder.value));
    let choices = $derived.by(() => {
        if (!opened || !reference) return [];
        if (pointReference && pointSlot) {
            const editor = pointReference.editor, design = editor.project.design, { value } = pointSlot;
            const points = Object.entries(design.geometry).flatMap(([id, item]) => "point" in item && !editor.screenPointIds.has(id) ?
                [{ id: "point:" + id, name: item.label, icon: "point" as const, selected: "point" in value && value.point === id }] : []);
            return [...(canUnlinkPoint(design, value, editor.geometryUses) ? [{ items: [{ id: "unlink", name: "解除引用" }] }] : []),
                { title: "点", items: points }].filter(group => group.items.length);
        }
        const { editor: { curves }, slot } = curveReference!;
        const shapes = [...curves.slots.values()].flatMap(candidate => candidate.holder || !curves.canUse(slot, candidate) ? [] :
            [{ id: candidate.key, name: candidate.name, icon: candidate.value.closed ? "closedPath" as const : "curve" as const, selected: candidate.id === current }]);
        return [...(shoreAlias || curves.canUnlinkShape(slot) ? [{ items: [{ id: "unlink", name: "解除引用" }] }] : []),
            { title: slot.closed ? "闭合曲线" : "曲线", items: shapes }].filter(group => group.items.length);
    });
    onDestroy(() => {
        if (opened) hover();
    });
    function hover(id?: string) {
        if (pointReference) pointReference.editor.hoverPointReference(id?.startsWith("point:") ? id.slice(6) : undefined);
        else curveReference?.editor.hoverCurveReference(id);
    }
    function close(focus?: boolean) {
        opened = false;
        hover();
        if (focus) toggle.focus({ preventScroll: true });
    }
    async function choose(id: string) {
        close(true);
        if (pointReference && pointSlot) {
            const { value } = pointSlot, target = id === "unlink" ? undefined : id.slice(6);
            if ("point" in value && target === value.point) return;
            await pointReference.editor.changePointReference(pointReference.target, target);
            await tick();
            if (toggle?.isConnected && document.activeElement === document.body) toggle.focus({ preventScroll: true });
        }
        else if (curveReference && (current === undefined || id !== curveKey(current)))
            void curveReference.editor.changeCurveReference(curveReference.slot, id === "unlink" ? undefined : id, !(shoreAlias && id === "unlink"));
    }
</script>