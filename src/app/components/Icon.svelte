<svg class="icon" viewBox="0 0 18 18" aria-hidden="true">
    {#if builtin || subtype}
        <defs>
            <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="18" height="18">
                <rect width="18" height="18" fill="white" stroke="none" />
                {#if builtin}<circle cx="15" cy="3" r="5" fill="black" stroke="none" />{/if}
                {#if subtype}<rect x="8.6" y="10" width="10" height="9" rx="2" fill="black" stroke="none" />{/if}
            </mask>
        </defs>
        <path d={icons[subtype ? "marks" : name]} mask={"url(#" + id + ")"} />
        {#if subtype}<path d={icons[name]} />{/if}
        {#if builtin}<circle cx="15" cy="3" r="2.5" fill="currentColor" stroke="none" />{/if}
    {:else}<path d={icons[name]} />{/if}
</svg>

<script module lang="ts">
    const icons = {
        point: "M9 1v4m0 8v4M1 9h4m8 0h4M12 9a3 3 0 1 1-6 0 3 3 0 1 1 6 0z",
        polyline: "M3 12l4-7 7 4M1 12h3v3H1z M6 2h3v3H6z M13 8h3v3h-3z",
        closedPath: "M5 3c4-2 10 0 10 5s-3 8-7 7-7-4-6-8z M3 2h3v3H3z",
        up: "M9 15V3m-5 5 5-5 5 5",
        field: "M2 3h14v12H2z M2 7h14M2 11h14M7 3v12m4-12v12",
        function: "M3 13h3l3-9h4M5 8h7m0 2 4 5m0-5-4 5",
        property: "M3 13 8 4l5 9z M3 15h12",
        exclude: "M15.5 9a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0z M4.4 13.6l9.2-9.2",
        marks: "M4 16V3m0 1c4-4 7 3 11-1v8c-4 4-7-3-11 1",
        section: "M3 5v8m0-4h12m0-4v8",
        tag: "M2.5 3h7l6 6-6 6-7-7z M6 6h.2",
        region: "M2.5 6V2.5H6m3 0h1m3 0h2.5V6m0 3v1m0 3v2.5H12m-3 0H8m-3 0H2.5V12m0-3v-1",
        project: "M4 2.5h6l4 4v9H4z M10 2.5v4h4",
        expand: "m7 5 4 4-4 4",
        collapse: "m5 7 4 4 4-4",
        chevronLeft: "m11 4-5 5 5 5",
        chevronRight: "m7 4 5 5-5 5",
        textMark: "M11 12h6.5M14.25 12v5.5",
        scaleMark: "M10.5 12.5h7v4.5h-7z M13 12.5v2M15.5 12.5v2",
        display: "M2 3h14v10H2z M6 16h6m-3-3v3",
        copy: "M6 6h9v10H6z M3 12H2V2h9v1",
        delete: "M2 5h14M6 5V3h6v2M4 5l1 11h8l1-11M7 8v5m4-5v5",
        terrain: "m2 6 7-4 7 4-7 4z M2 9l7 4 7-4 M2 12l7 4 7-4",
        inputs: "M5.5 2.5c-3.5 3.5-3.5 9.5 0 13M12.5 2.5c3.5 3.5 3.5 9.5 0 13M6.8 7.4c.9-.6 1.6-.2 2 .9l.8 2.4c.4 1.1 1.1 1.5 2 .9M11.4 7.2l-4.6 4.6",
        issues: "m9 2 7.5 13H1.5z M9 6v4m0 2.5v.2",
        eye: "M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5S1.5 9 1.5 9z M11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
        pen: "m3 15 2-8 7-4 3 3-4 7z M3 15l5-5m2-2-1 2-2-1 1-2z",
        rect: "M2.5 4h13v10h-13z", circle: "M15.5 9a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0z",
        sector: "M3 15V3a12 12 0 0 1 12 12z", strip: "M2 12c6 0 4-8 14-8M2 15c9 0 7-8 14-8",
        nodeCorner: "M2 14 9 5l7 9M7.5 3.5h3v3h-3z",
        nodeAuto: "M2 14C6 14 5 5 9 5s3 9 7 9M10.4 5a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z",
        nodeManual: "M2 14 16 4M7.5 7.5h3v3h-3z M3.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z M17.5 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
        segmentLine: "M3 13 15 5",
        segmentCurve: "M2 13C7 13 8 4 16 5",
        segmentArc: "M2 13a9 9 0 0 1 14-8",
        tangent: "M2 13h6a8 8 0 0 0 8-8",
        undo: "M7 4L3 8l4 4M4 8h7c6 0 6 8 0 8",
        redo: "M11 4l4 4-4 4m3-4H7c-6 0-6 8 0 8",
        open: "M2 5h5l2 2h7v2M2 5v10h13l2-6H5l-2 6",
        new: "M3 2h8l4 4v10H3zM11 2v4h4M6 10h6m-3-3v6",
        save: "M3 3h10l3 3v10H3zM6 3v5h7V3M6 16v-5h7v5",
        minus: "M3 9h12",
        plus: "M3 9h12M9 3v12",
        fit: "M2 7V3h4m6 0h4v4m0 5v4h-4m-6 0H2v-4"
    };
    export type IconName = keyof typeof icons;
</script>

<script lang="ts">
    const id = $props.id();
    let { name, builtin = false }: { name: IconName; builtin?: boolean } = $props();
    let subtype = $derived(name === "textMark" || name === "scaleMark");
</script>