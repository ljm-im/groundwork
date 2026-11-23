<svg class="icon" viewBox="0 0 18 18" aria-hidden="true"><path d={icons[name]} /></svg>

<script lang="ts">
    const icons = {
        up: "M9 15V3m-5 5 5-5 5 5",
        field: "M2 3h14v12H2z M2 7h14M2 11h14M7 3v12m4-12v12",
        function: "M3 13h3l3-9h4M5 8h7m0 2 4 5m0-5-4 5",
        property: "M3 13 8 4l5 9z M3 15h12",
        disabled: "M2 2l14 14M2 8l-1 1s3 5 8 5l3-1m-6-8 3-1c5 0 8 5 8 5l-2 2",
        copy: "M6 6h9v10H6z M3 12H2V2h9v1",
        delete: "M2 5h14M6 5V3h6v2M4 5l1 11h8l1-11M7 8v5m4-5v5",
        terrain: "m2 6 7-4 7 4-7 4z M2 9l7 4 7-4 M2 12l7 4 7-4",
        variables: "M2 9h5m4 0h5M7 5h4v8H7z",
        issues: "m9 2 7.5 13H1.5z M9 6v4m0 2.5v.2",
        eye: "M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5S1.5 9 1.5 9z M11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
        pen: "m3 15 2-8 7-4 3 3-4 7z M3 15l5-5m2-2-1 2-2-1 1-2z",
        rect: "M2.5 4h13v10h-13z", circle: "M15.5 9a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0z",
        sector: "M3 15V3a12 12 0 0 1 12 12z", strip: "M2 12c6 0 4-8 14-8M2 15c9 0 7-8 14-8",
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