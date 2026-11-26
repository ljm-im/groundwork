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
    <div class="menu-columns">
        {#each menuColumns as column, col (col)}
            {#if col > 0}<div class="menu-separator" aria-hidden="true"></div>{/if}
            <div class="menu-column">
                {#each column as group, index (index)}
                    <div class="menu-group" role={group.title ? "group" : undefined} aria-label={group.title}>
                        {#if group.title}<div class="group-name" aria-hidden="true">{group.title}</div>{/if}
                        {#each group.items as item (item.id)}
                            <button role={kind === "listbox" ? "option" : item.selected === undefined ? "menuitem" : "menuitemradio"}
                                aria-selected={kind === "listbox" ? inputNavigation ? current === item.id : !!item.selected : undefined}
                                aria-checked={kind === "menu" ? item.selected : undefined}
                                class:danger={item.danger} disabled={item.disabled} data-option={item.id} onmouseenter={() => {
                                    if (inputNavigation) active = item.id;
                                }} onclick={() => choose(item.id)}>
                                {#if item.icon}<Icon name={item.icon} builtin={item.builtin} />{/if}
                                {item.name}
                                {#if item.branch}<span class="sub-arrow"><Icon name="chevronRight" /></span>{/if}
                            </button>
                        {/each}
                    </div>
                {/each}
            </div>
        {/each}
    </div>
    {#if !items.length}<EmptyState search={searching} text={empty} />{/if}
</div>

<style>
    .creation-menu { min-width: calc(var(--name-w) + 2 * var(--space-3)); max-width: calc(100vw - var(--space-2)); }
    .context-menu { width: max-content; max-width: calc(100vw - 32px); }
    .context-menu .menu-columns { display: flex; align-items: flex-start; }
    .context-menu .menu-column { flex: none; width: max-content; max-width: 100%; }
    .context-menu .menu-column button { white-space: nowrap; }
    .menu-separator { flex: none; align-self: stretch; width: 1px; background: var(--border); }
    .context-menu:global(.stacked) .menu-columns { flex-direction: column; }
    .context-menu:global(.stacked) .menu-separator { width: auto; height: 1px; margin: var(--space-1) var(--space-2); }
    .sub-arrow { margin-inline-start: auto; display: inline-flex; }
</style>

<script module lang="ts">
    import { type IconName } from "./Icon.svelte";

    export interface MenuItem { id: string; name: string; icon?: IconName; builtin?: boolean; selected?: boolean; disabled?: boolean; danger?: boolean; branch?: boolean }
    export interface MenuGroup { title?: string; items: readonly MenuItem[] }
</script>

<script lang="ts">
    import { onMount, tick } from "svelte";
    import { composingKey } from "../state/numbers.ts";
    import { menuDirection, placePopup } from "../state/popup.ts";
    import Icon from "./Icon.svelte";
    import EmptyState from "./EmptyState.svelte";

    let { label, groups = [], columns, choose, close, variant, kind = "menu", anchor, point, surface, viewport = false, keyboardTarget,
        back, searching = false, openingKey, pointerOpened = false, empty = "没有可用的变量" }: {
        label: string; groups?: MenuGroup[]; columns?: MenuGroup[][]; choose: (id: string) => void; close: (focus?: boolean, event?: KeyboardEvent) => void;
        variant: string; kind?: "menu" | "listbox"; anchor?: HTMLElement; point?: { x: number; y: number }; surface?: HTMLElement;
        viewport?: boolean; keyboardTarget?: HTMLElement; back?: () => void; searching?: boolean; openingKey?: string;
        pointerOpened?: boolean; empty?: string;
    } = $props();
    let menu: HTMLElement;
    let placement = $derived(point ? { point, close, surface } : { anchor: anchor!, close, viewport });
    let inputNavigation = $derived(!!keyboardTarget && !pointerOpened);
    let menuColumns = $derived(columns ?? [groups]);
    let items = $derived(menuColumns.flat().flatMap(group => group.items).filter(item => !item.disabled));
    const backId = "";
    let active = $state<string>();
    let current = $derived(items.some(item => item.id === active) || back && active === backId ? active :
        (items.find(item => item.selected) ?? items[0])?.id ?? (back ? backId : undefined));
    function buttons() {
        return [...menu.querySelectorAll<HTMLButtonElement>("button:enabled")];
    }
    function itemButton(id: string | undefined) {
        if (id === undefined) return;
        return buttons().find(button => id === backId ? button.classList.contains("ref-back") : button.dataset.option === id);
    }
    onMount(() => {
        if (inputNavigation) return;
        void tick().then(() => {
            if (!menu?.isConnected) return;
            if (pointerOpened) {
                menu.focus({ preventScroll: true }); return;
            }
            const targets = buttons(), selected = itemButton(current);
            (openingKey === "Home" ? targets[0] : openingKey === "End" ? targets.at(-1) : selected)?.focus({ preventScroll: true });
        });
    });
    function keyboard(e: KeyboardEvent) {
        if (composingKey(e)) return;
        if (e.key === "Escape") {
            e.preventDefault(); close(true, e); return;
        }
        if (e.target !== anchor && e.target !== keyboardTarget && !(e.target instanceof Node && menu?.contains(e.target))) return;
        const targets = buttons();
        if (inputNavigation && e.key === "Enter") {
            e.preventDefault(); e.stopPropagation(); itemButton(current)?.click(); return;
        }
        const horizontal = menuColumns.length === 2 && (e.key === "ArrowLeft" || e.key === "ArrowRight");
        if ((!horizontal && !menuDirection(e)) || !targets.length) return;
        e.preventDefault(); e.stopPropagation();
        const focused = inputNavigation ? itemButton(current) : targets.find(button => button === document.activeElement);
        let button: HTMLButtonElement | undefined;
        if (pointerOpened && !focused && (e.key === "ArrowDown" || e.key === "ArrowUp"))
            button = itemButton(items.find(item => item.selected)?.id) ?? (e.key === "ArrowDown" ? targets[0] : targets.at(-1));
        else if (menuColumns.length === 2) {
            const columns = [...menu.querySelectorAll(".menu-column")];
            const column = focused?.closest(".menu-column") ?? columns[0], index = columns.indexOf(column);
            if (horizontal) {
                const next = columns[index + (e.key === "ArrowRight" ? 1 : -1)];
                if (!next) return;
                const y = focused && column.contains(focused) ? columnY(focused, column) : 0;
                let distance = Infinity;
                for (const candidate of targets.filter(target => next.contains(target))) {
                    const gap = Math.abs(columnY(candidate, next) - y);
                    if (gap < distance) {
                        button = candidate;
                        distance = gap;
                    }
                }
            }
            else button = moveInColumn(targets.filter(target => column.contains(target)), focused, e.key);
        }
        else button = moveInColumn(targets, focused, e.key);
        if (!button) return;
        if (inputNavigation) {
            active = button.dataset.option ?? backId;
            button.scrollIntoView({ block: "nearest" });
        }
        else {
            button.focus({ preventScroll: true });
            if (point || pointerOpened) {
                const viewport = menu.getBoundingClientRect(), item = button.getBoundingClientRect();
                menu.scrollTop += Math.min(0, item.top - viewport.top) + Math.max(0, item.bottom - viewport.bottom);
            }
        }
    }
    function columnY(button: HTMLButtonElement, column: Element) {
        const box = button.getBoundingClientRect();
        return box.top + box.height / 2 - column.getBoundingClientRect().top;
    }
    function moveInColumn(targets: HTMLButtonElement[], focused: HTMLButtonElement | undefined, key: string) {
        const at = focused ? targets.indexOf(focused) : -1;
        const index = key === "Home" ? 0 : key === "End" ? targets.length - 1 : at < 0 ? Math.max(0, targets.indexOf(itemButton(current)!)) :
            (at + (key === "ArrowDown" ? 1 : targets.length - 1)) % targets.length;
        return targets[index];
    }
</script>