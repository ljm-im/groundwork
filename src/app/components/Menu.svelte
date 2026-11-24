<svelte:window onkeydowncapture={keyboard} />
<div class={"popup menu " + variant} role={kind} tabindex="-1" aria-label={label} popover="manual"
    bind:this={menu} use:placePopup={placement} onpointerdown={e => {
        if (keyboardTarget) e.preventDefault();
    }}>
    {#if back}
        <button class="ref-back" role="option" aria-selected={current === backId} onclick={back}>
            <Icon name="chevronLeft" />返回
        </button>
    {/if}
    {#each groups as group, index (index)}
        <div class="menu-group">
            {#if group.title}<div class="group-name">{group.title}</div>{/if}
            {#each group.items as item (item.id)}
                <button role={kind === "listbox" ? "option" : item.selected === undefined ? "menuitem" : "menuitemradio"}
                    aria-selected={kind === "listbox" ? keyboardTarget ? current === item.id : !!item.selected : undefined}
                    aria-checked={kind === "menu" ? item.selected : undefined}
                    class:danger={item.danger} data-option={item.id} onmouseenter={() => {
                        if (keyboardTarget) active = item.id;
                    }} onclick={() => choose(item.id)}>
                    {#if item.icon}<Icon name={item.icon} builtin={item.builtin} />{/if}
                    {item.name}
                    {#if item.branch}<span class="sub-arrow"><Icon name="chevronRight" /></span>{/if}
                </button>
            {/each}
        </div>
    {/each}
    {#if !items.length}<EmptyState search={searching} text="没有可用的变量" />{/if}
</div>

<style>
    .creation-menu, .context-menu { min-width: calc(var(--name-w) + 2 * var(--space-3)); max-width: calc(100vw - var(--space-2)); }
    .context-menu { max-height: calc(100dvh - var(--space-2)); }
    .sub-arrow { margin-inline-start: auto; display: inline-flex; }
</style>

<script module lang="ts">
    import { type IconName } from "./Icon.svelte";

    export interface MenuItem { id: string; name: string; icon?: IconName; builtin?: boolean; selected?: boolean; danger?: boolean; branch?: boolean }
    export interface MenuGroup { title?: string; items: readonly MenuItem[] }
</script>

<script lang="ts">
    import { onMount, tick } from "svelte";
    import { composingKey } from "../state/numbers.ts";
    import { menuDirection, placePopup } from "../state/popup.ts";
    import Icon from "./Icon.svelte";
    import EmptyState from "./EmptyState.svelte";

    let { label, groups, choose, close, variant, kind = "menu", anchor, point, viewport = false, keyboardTarget,
        back, searching = false, openingKey }: {
        label: string; groups: MenuGroup[]; choose: (id: string) => void; close: (focus?: boolean) => void;
        variant: string; kind?: "menu" | "listbox"; anchor?: HTMLElement; point?: { x: number; y: number };
        viewport?: boolean; keyboardTarget?: HTMLElement; back?: () => void; searching?: boolean; openingKey?: string;
    } = $props();
    let menu: HTMLElement;
    let placement = $derived(point ? { point, close } : { anchor: anchor!, close, viewport });
    let items = $derived(groups.flatMap(group => group.items));
    const backId = "";
    let active = $state<string>();
    let current = $derived(items.some(item => item.id === active) || back && active === backId ? active :
        (items.find(item => item.selected) ?? items[0])?.id ?? (back ? backId : undefined));
    function buttons() {
        return [...menu.querySelectorAll("button")];
    }
    function itemButton(id: string | undefined) {
        return buttons().find(button => id === backId ? button.classList.contains("ref-back") : button.dataset.option === id);
    }
    onMount(() => {
        if (keyboardTarget) return;
        void tick().then(() => {
            if (!menu?.isConnected) return;
            const targets = buttons(), selected = itemButton(current);
            (openingKey === "Home" ? targets[0] : openingKey === "End" ? targets.at(-1) : selected)?.focus({ preventScroll: true });
        });
    });
    function keyboard(e: KeyboardEvent) {
        if (composingKey(e)) return;
        if (e.key === "Escape") {
            e.preventDefault(); close(true); return;
        }
        if (e.target !== anchor && e.target !== keyboardTarget && !(e.target instanceof Node && menu?.contains(e.target))) return;
        const targets = buttons();
        if (keyboardTarget && e.key === "Enter") {
            e.preventDefault(); e.stopPropagation(); itemButton(current)?.click(); return;
        }
        if (!menuDirection(e) || !targets.length) return;
        e.preventDefault(); e.stopPropagation();
        const focused = targets.indexOf((keyboardTarget ? itemButton(current) : document.activeElement) as HTMLButtonElement);
        const index = e.key === "Home" ? 0 : e.key === "End" ? targets.length - 1 : focused < 0 ? Math.max(0, targets.indexOf(itemButton(current)!)) :
            (focused + (e.key === "ArrowDown" ? 1 : targets.length - 1)) % targets.length;
        const button = targets[index];
        if (keyboardTarget) {
            active = button.dataset.option ?? backId;
            button.scrollIntoView({ block: "nearest" });
        }
        else button.focus({ preventScroll: true });
    }
</script>