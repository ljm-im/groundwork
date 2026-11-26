<div class="segmented" role="group" aria-label={label}>
    {#each options as [id, name, icon] (id)}
        <button class:icon-button={!showText} aria-label={name} aria-pressed={value === id} data-tip={tip ?? name}
            disabled={disabled || unavailable.includes(id)} onclick={event => activate(event.currentTarget, id)} onkeydown={move}>
            <Icon name={icon} />{#if showText}{name}{/if}
        </button>
    {/each}
</div>

<style>
    .segmented { display: flex; align-items: center; gap: var(--space-1); }
    button { flex: none; gap: var(--space-1); border: 0; background: transparent; }
    button:hover:enabled[aria-pressed="false"] { background: var(--bg-hover); }
    button[aria-pressed="true"] { background: var(--bg-selected); color: var(--accent); }
</style>

<script lang="ts" generics="Id extends string">
    import { tick } from "svelte";
    import { composingKey } from "../state/numbers.ts";
    import Icon, { type IconName } from "./Icon.svelte";

    let { label, options, value, choose, showText = false, disabled = false, unavailable = [], tip }: {
        label: string; options: readonly (readonly [Id, string, IconName])[]; value: Id; choose: (id: Id) => void | Promise<void>;
        showText?: boolean; disabled?: boolean; unavailable?: readonly Id[]; tip?: string;
    } = $props();

    function activate(button: HTMLButtonElement, id: Id) {
        const focused = document.activeElement === button;
        const work = choose(id);
        if (focused && work) void work.then(tick).then(() => {
            if (button.isConnected && document.activeElement === document.body) button.focus({ preventScroll: true });
        });
    }

    function move(event: KeyboardEvent & { currentTarget: HTMLButtonElement }) {
        const { key, currentTarget } = event;
        if (composingKey(event) || key !== "ArrowLeft" && key !== "ArrowRight") return;
        const buttons = [...currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button:enabled")];
        const index = buttons.indexOf(currentTarget), step = key === "ArrowRight" ? 1 : -1;
        if (index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const next = buttons[(index + buttons.length + step) % buttons.length];
        if (next === currentTarget) return;
        next.focus({ preventScroll: true });
        next.click();
    }
</script>