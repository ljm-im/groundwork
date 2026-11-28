<button class="icon-button" data-tip={label} aria-label={label} aria-expanded={opened} bind:this={button} onclick={event => {
    pointerOpened = event.detail > 0;
    if (opened) close();
    else opened = true;
}}><Icon name="collapse" /></button>
{#if opened}
    <Menu {label} variant="reference-menu" kind="listbox" anchor={button.closest<HTMLElement>(".subitem-heading")!} trigger={button} singleLine groups={choices} empty={"没有可用的" + category}
        {pointerOpened} close={focus => close(focus)} choose={choose} hover={key => editor.hoverCurveReference(key)} />
{/if}

<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { curveSlotName, holderLabel, isHolderRef, refKey, type CurveSlot } from "../../core/design/curveReferences.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon from "./Icon.svelte";
    import Menu from "./Menu.svelte";
    let { editor, slot }: { editor: session.Editor; slot: CurveSlot } = $props();
    let opened = $state(false), pointerOpened = $state(false), button = $state<HTMLButtonElement>(null!);
    let category = $derived(holderLabel(slot.holder!)), label = $derived("引用" + category);
    let current = $derived(slot.holder && isHolderRef(slot.holder.value) ? refKey(slot.holder.value.ref) : undefined);
    let choices = $derived.by(() => {
        if (!opened) return [];
        const graph = editor.curves;
        const holders = [...graph.holders.values()].filter(candidate => graph.canUseHolder(slot, candidate)).map(candidate => ({
            id: candidate.key, name: curveSlotName(candidate),
            icon: graph.source(graph.ofHolder(candidate)).curve.closed ? "closedPath" as const : "curve" as const, selected: candidate.key === current
        }));
        return [...(current ? [{ items: [{ id: "unlink", name: "解除引用" }] }] : []),
            { title: category, items: holders }].filter(group => group.items.length);
    });
    onDestroy(() => {
        if (opened) editor.hoverCurveReference();
    });
    function close(focus?: boolean) {
        opened = false;
        editor.hoverCurveReference();
        if (focus) button.focus({ preventScroll: true });
    }
    async function choose(id: string) {
        close(true);
        if (id === current) return;
        await editor.changeCurveReference(slot, id === "unlink" ? undefined : id);
        await tick();
        if (button?.isConnected && document.activeElement === document.body) button.focus({ preventScroll: true });
    }
</script>