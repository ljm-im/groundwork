<svelte:window oncontextmenu={contextMenu} />

<TopBar {editor} {appearance} {chooseAppearance} />
<Workspace {editor} {theme} />
<Dialogs {editor} />
<Tooltip />

<script lang="ts">
    import { onMount } from "svelte";
    import { terrainFieldHashes } from "../state/terrainHash.ts";
    import { isEditableText } from "../state/pendingInput.ts";
    import { applyTheme, readAppearance, resolveTheme, saveAppearance, systemThemeQuery, type Appearance } from "../state/theme.ts";
    import * as session from "../state/session.svelte.ts";
    import Tooltip from "./Tooltip.svelte";
    import TopBar from "./TopBar.svelte";
    import Workspace from "./Workspace.svelte";
    import Dialogs from "./Dialogs.svelte";

    const editor = new session.Editor();
    const systemTheme = matchMedia(systemThemeQuery);
    let appearance = $state(readAppearance());
    let systemDark = $state(systemTheme.matches);
    let theme = $derived(resolveTheme(appearance, systemDark));

    function contextMenu(event: MouseEvent) {
        if (!isEditableText(event.target)) event.preventDefault();
    }
    function chooseAppearance(value: Appearance) {
        appearance = value;
        saveAppearance(value);
    }
    $effect(() => applyTheme(theme));
    onMount(() => {
        if (import.meta.env.DEV) window.terrainFieldHashes = () => terrainFieldHashes(editor.project);
        function changed(event: MediaQueryListEvent) {
            systemDark = event.matches;
        }
        systemTheme.addEventListener("change", changed);
        return () => {
            systemTheme.removeEventListener("change", changed);
            if (import.meta.env.DEV) delete window.terrainFieldHashes;
        };
    });
</script>