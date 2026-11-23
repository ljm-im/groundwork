<TopBar {editor} />
<Workspace {editor} />
<Dialogs {editor} />
<Tooltip />

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Tooltip from "./Tooltip.svelte";
    import TopBar from "./TopBar.svelte";
    import Workspace from "./Workspace.svelte";
    import Dialogs from "./Dialogs.svelte";

    const editor = new session.Editor();
</script>