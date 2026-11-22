<svg class="icon" viewBox="0 0 18 18" aria-hidden="true"><path d={icons[name]} /></svg>

<script lang="ts">
    const icons = {
        cursor: "M4 3l12 8-6 1-3 5z",
        node: "M11 5H4v10h10V9M15 2v6m-3-3h6",
        edge: "M4 12V5h7m-4 8h8V7 M2 12h4v4H2z M12 2h4v4h-4z",
        via: "M2 14l5-4m4-3 5-4M6 9l3-3 3 3-3 3z",
        door: "M3 16h12M5 15V3l8-1v13M10 9h1",
        gate: "M2 15V4h3v11m8 0V4h3v11M5 6l6 2v6l-6-2",
        building: "M2 8l7-6 7 6M4 7v9h10V7M7 16v-5h4v5",
        fork: "M3 15l5-6 7-6M8 9l7 4M13 2h3v3m-3 6 3 2-2 2",
        undo: "M7 4L3 8l4 4M4 8h7c6 0 6 8 0 8",
        redo: "M11 4l4 4-4 4m3-4H7c-6 0-6 8 0 8",
        open: "M2 5h5l2 2h7v2M2 5v10h13l2-6H5l-2 6",
        new: "M3 2h8l4 4v10H3zM11 2v4h4M6 10h6m-3-3v6",
        save: "M3 3h10l3 3v10H3zM6 3v5h7V3M6 16v-5h7v5",
        minus: "M3 9h12",
        plus: "M3 9h12M9 3v12",
        fit: "M2 7V3h4m6 0h4v4m0 5v4h-4m-6 0H2v-4"
    };
    let { name }: { name: keyof typeof icons } = $props();
</script>