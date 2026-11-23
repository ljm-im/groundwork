<TopBar {editor} />
<Workspace {editor} />
<Dialogs {editor} />

<style>
    :global {
        :root {
            color-scheme: light;
            --ink: #233d37;
            --muted: #657570;
            --line: #d9dfd7;
            --paper: #f9faf6;
            --panel: #fffefa;
            --teal: #226659;
            --light: #e6eee6;
            --red: #a34839;
            font: 14px/1.5 "Inter", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
            color: var(--ink);
            background: var(--paper);
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
        }
        button, input, select, textarea {
            font: inherit;
            color: inherit;
        }
        button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            cursor: pointer;
            border: 1px solid var(--line);
            border-radius: 5px;
            background: var(--panel);
            min-height: 32px;
            padding: 4px 10px;
        }
        button:hover {
            background: #edf2eb;
            border-color: #9db5a8;
        }
        button:disabled {
            opacity: .4;
            cursor: default;
        }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
            outline: 2px solid #298b81;
            outline-offset: 2px;
        }
        button.primary {
            background: var(--teal);
            color: white;
            border-color: var(--teal);
        }
        button.primary:hover {
            background: #195247;
        }
        button.icon {
            padding: 5px;
            width: 32px;
        }
        button.flat {
            border-color: transparent;
            background: transparent;
        }
        button.flat:hover {
            background: var(--light);
        }
        svg.icon {
            width: 16px;
            height: 16px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.65;
            stroke-linecap: round;
            stroke-linejoin: round;
            flex: none;
        }
        .mono, output, .stat dd {
            font-family: "IBM Plex Mono", Consolas, "Microsoft YaHei UI", monospace;
            font-variant-numeric: tabular-nums;
        }
        .divider {
            height: 18px;
            width: 1px;
            background: var(--line);
            margin: 0 5px;
        }
        main {
            height: calc(100dvh - 63px);
            min-height: 600px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 324px;
        }
        .stage {
            display: grid;
            grid-template-rows: minmax(340px, 1fr) 164px;
            min-width: 0;
            min-height: 0;
        }
        h2, h3, p, dl {
            margin: 0;
        }
        h2 {
            font-size: 18px;
            letter-spacing: .025em;
        }
        h3 {
            font-size: 13px;
            font-weight: 650;
        }
        .sub {
            color: var(--muted);
            font-size: 12px;
            line-height: 1.7;
            margin-top: 4px;
        }
        .part {
            border-top: 1px solid var(--line);
            margin-top: 17px;
            padding-top: 14px;
        }
        .part-title, .row-between {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 7px;
        }
        .part-title {
            margin-bottom: 8px;
        }
        .number {
            font: 11px Consolas, monospace;
            color: var(--muted);
        }
        .route-row, .object-row, .issue-row {
            width: 100%;
            border: 0;
            border-radius: 0;
            border-bottom: 1px solid #e9ede5;
            background: transparent;
            justify-content: flex-start;
            text-align: left;
            min-height: 42px;
            padding: 7px 2px;
            gap: 9px;
        }
        .route-row .road-symbol {
            width: 20px;
            flex: none;
            text-align: center;
            font-size: 16px;
            font-weight: bold;
            color: #69927c;
        }
        .road-symbol.stair {
            color: #a17a4f;
        }
        .route-row .length, .object-row small {
            margin-left: auto;
            white-space: nowrap;
            color: var(--muted);
            font-size: 11px;
        }
        .route-row .type {
            font-size: 11px;
            color: var(--muted);
        }
        .chev {
            color: #809287;
            font-size: 16px;
        }
        .search {
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 4px;
            background: #fcfcf8;
            height: 30px;
            padding: 3px 8px;
            margin-bottom: 4px;
            font-size: 12px;
        }
        .badge {
            display: inline-block;
            font-size: 11px;
            border-radius: 4px;
            padding: 2px 6px;
            background: var(--light);
            color: #466354;
        }
        .route-dot {
            width: 6px;
            height: 6px;
            background: #b84d41;
            border-radius: 50%;
        }
        .issue-row {
            align-items: flex-start;
            line-height: 1.6;
            font-size: 12px;
        }
        .issue-row b, .issue-row small {
            display: block;
        }
        .issue-row small {
            color: var(--muted);
            font-size: 11px;
        }
        .diamond {
            flex: none;
            width: 7px;
            height: 7px;
            margin: 6px 4px;
            transform: rotate(45deg);
            background: #b84d41;
            border: 1px solid #b84d41;
        }
        .diamond.notice {
            background: #fff4e4;
        }
        .back {
            margin: 0 0 10px -4px;
            padding: 1px 5px;
            font-size: 12px;
            min-height: 24px;
        }
        .stat-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            background: #f2f5ed;
            border: 1px solid #dce3d6;
            border-radius: 6px;
            padding: 9px 12px;
            gap: 10px 8px;
            margin-top: 14px;
        }
        .stat dt {
            font-size: 11px;
            color: #68796f;
        }
        .stat dd {
            margin: 1px 0 0;
            font-size: 15px;
            color: #29483c;
        }
        .field, .toggle, .slider {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 37px;
            font-size: 12px;
        }
        .field {
            justify-content: space-between;
        }
        .field input, .field select {
            width: 107px;
            border: 1px solid var(--line);
            background: white;
            border-radius: 4px;
            height: 28px;
            padding: 3px 6px;
        }
        .field input.wide {
            width: 150px;
        }
        .slider {
            display: grid;
            grid-template-columns: minmax(100px, 1fr) minmax(65px, 1fr) 38px;
        }
        .slider input {
            width: 100%;
            accent-color: var(--teal);
        }
        .slider output {
            text-align: right;
            font-size: 11px;
        }
        .toggle input {
            accent-color: var(--teal);
            margin-left: auto;
            width: 16px;
            height: 16px;
        }
        .danger {
            color: var(--red);
        }
        details {
            margin-top: 10px;
        }
        summary {
            cursor: pointer;
            color: #4f655a;
            font-size: 12px;
            padding: 5px 0;
        }
        kbd {
            border: 1px solid #cdd7cb;
            background: #f1f4ec;
            border-radius: 3px;
            padding: 0 4px;
            font: 11px/1.5 Consolas, sans-serif;
        }
        @media (max-width:900px) {
            main {
                grid-template-columns: minmax(0, 1fr) 278px;
            }
            .stage {
                grid-template-rows: minmax(315px, 1fr) 150px;
            }
        }
        @media (max-width:680px) {
            main {
                display: flex;
                flex-direction: column;
                height: auto;
                min-height: 0;
            }
            .stage {
                grid-template-rows: max(365px, 54dvh) 132px;
            }
        }
        .issue-row.is-selected {
            background: #fbe8d8;
            box-shadow: inset 3px 0 #b7442a;
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import TopBar from "./TopBar.svelte";
    import Workspace from "./Workspace.svelte";
    import Dialogs from "./Dialogs.svelte";

    const editor = new session.Editor();
</script>